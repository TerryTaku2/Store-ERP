from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(
    prefix="/api/users", tags=["users"],
    dependencies=[Depends(security.require_admin_branch)],
)


@router.get("", response_model=list[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    return (
        db.query(models.User)
        .filter(models.User.company_id == current_user.company_id)
        .order_by(models.User.id)
        .all()
    )


@router.post("", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if payload.role not in ("admin", "manager", "cashier"):
        raise HTTPException(status_code=400, detail="Invalid role")

    user = models.User(
        username=payload.username,
        full_name=payload.full_name,
        role=payload.role,
        is_active=payload.is_active,
        company_id=current_user.company_id,
        hashed_password=security.hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    # New users need at least one branch to log in; grant the branch they were created
    # from (always HQ here) — additional branches can be granted via /api/branches.
    db.add(models.UserBranch(user_id=user.id, branch_id=active_branch.id))
    audit.log(
        db, "create", "user", user.id,
        summary=f"Created user '{user.username}' with role '{user.role}'",
        user=current_user,
    )
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    user = db.query(models.User).filter(
        models.User.id == user_id, models.User.company_id == current_user.company_id
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes = []
    if payload.full_name is not None and payload.full_name != user.full_name:
        changes.append(f"full_name: {user.full_name} → {payload.full_name}")
        user.full_name = payload.full_name
    if payload.role is not None:
        if payload.role not in ("admin", "manager", "cashier"):
            raise HTTPException(status_code=400, detail="Invalid role")
        if payload.role != user.role:
            changes.append(f"role: {user.role} → {payload.role}")
            user.role = payload.role
    if payload.is_active is not None and payload.is_active != user.is_active:
        changes.append(f"is_active: {user.is_active} → {payload.is_active}")
        user.is_active = payload.is_active
    if payload.password:
        user.hashed_password = security.hash_password(payload.password)
        changes.append("password: changed")
    if user.locked_until or user.failed_login_attempts:
        user.locked_until = None
        user.failed_login_attempts = 0
        changes.append("login lockout: cleared")

    if changes:
        audit.log(
            db, "update", "user", user.id,
            summary=f"Updated user '{user.username}': " + "; ".join(changes),
            user=current_user,
        )

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(models.User).filter(
        models.User.id == user_id, models.User.company_id == current_user.company_id
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    audit.log(
        db, "delete", "user", user.id,
        summary=f"Deleted user '{user.username}' (role '{user.role}')",
        user=current_user,
    )
    db.query(models.UserBranch).filter(models.UserBranch.user_id == user.id).delete()
    db.delete(user)
    db.commit()
    return None
