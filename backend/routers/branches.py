from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(
    prefix="/api/branches",
    tags=["branches"],
    dependencies=[Depends(security.require_role("admin")), Depends(security.require_admin_branch)],
)


@router.get("", response_model=list[schemas.BranchOut])
def list_branches(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    return (
        db.query(models.Branch)
        .filter(models.Branch.company_id == current_user.company_id)
        .order_by(models.Branch.id)
        .all()
    )


@router.post("", response_model=schemas.BranchOut, status_code=status.HTTP_201_CREATED)
def create_branch(
    payload: schemas.BranchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    if db.query(models.Branch).filter(
        models.Branch.code == payload.code, models.Branch.company_id == current_user.company_id
    ).first():
        raise HTTPException(status_code=400, detail="A branch with this code already exists")

    data = payload.model_dump(exclude={"initial_modules"})
    branch = models.Branch(**data, is_admin=False, company_id=current_user.company_id)
    db.add(branch)
    db.flush()

    for module in models.TOGGLE_MODULES:
        db.add(
            models.BranchModule(
                branch_id=branch.id, module=module, enabled=module in payload.initial_modules
            )
        )

    audit.log(
        db, "create", "branch", branch.id,
        summary=f"Created branch '{branch.name}' ({branch.code})", user=current_user,
    )
    db.commit()
    db.refresh(branch)
    return branch


@router.put("/{branch_id}", response_model=schemas.BranchOut)
def update_branch(
    branch_id: int,
    payload: schemas.BranchUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    if branch.is_admin and payload.is_active is False:
        raise HTTPException(status_code=400, detail="The administration branch can't be disabled")

    changes = []
    for key, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(branch, key)
        if old != value:
            changes.append(f"{key}: {old} -> {value}")
            setattr(branch, key, value)

    if changes:
        audit.log(
            db, "update", "branch", branch.id,
            summary=f"Updated branch '{branch.name}': " + "; ".join(changes), user=current_user,
        )
    db.commit()
    db.refresh(branch)
    return branch


@router.get("/{branch_id}/modules", response_model=list[schemas.BranchModuleOut])
def list_branch_modules(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return db.query(models.BranchModule).filter(models.BranchModule.branch_id == branch_id).all()


@router.put("/{branch_id}/modules", response_model=list[schemas.BranchModuleOut])
def update_branch_modules(
    branch_id: int,
    payload: schemas.BranchModulesUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    invalid = [m for m in payload.modules if m not in models.TOGGLE_MODULES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown module(s): {', '.join(invalid)}")

    rows = {
        bm.module: bm
        for bm in db.query(models.BranchModule).filter(models.BranchModule.branch_id == branch_id)
    }
    changes = []
    for module, enabled in payload.modules.items():
        row = rows.get(module)
        if row is None:
            row = models.BranchModule(branch_id=branch_id, module=module, enabled=enabled)
            db.add(row)
            changes.append(f"{module}: {enabled}")
        elif row.enabled != enabled:
            changes.append(f"{module}: {row.enabled} -> {enabled}")
            row.enabled = enabled

    if changes:
        audit.log(
            db, "update", "branch_modules", branch.id,
            summary=f"Updated module access for '{branch.name}': " + "; ".join(changes), user=current_user,
        )
    db.commit()
    return db.query(models.BranchModule).filter(models.BranchModule.branch_id == branch_id).all()


@router.get("/{branch_id}/users", response_model=list[schemas.UserOut])
def list_branch_users(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return (
        db.query(models.User)
        .join(models.UserBranch, models.UserBranch.user_id == models.User.id)
        .filter(models.UserBranch.branch_id == branch_id)
        .all()
    )


@router.post("/{branch_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def grant_branch_access(
    branch_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    user = db.query(models.User).filter(
        models.User.id == user_id, models.User.company_id == current_user.company_id
    ).first()
    if not branch or not user:
        raise HTTPException(status_code=404, detail="Branch or user not found")

    existing = (
        db.query(models.UserBranch)
        .filter(models.UserBranch.branch_id == branch_id, models.UserBranch.user_id == user_id)
        .first()
    )
    if existing:
        return None

    db.add(models.UserBranch(branch_id=branch_id, user_id=user_id))
    audit.log(
        db, "update", "branch_users", branch.id,
        summary=f"Granted '{user.username}' access to branch '{branch.name}'", user=current_user,
    )
    db.commit()
    return None


@router.delete("/{branch_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_branch_access(
    branch_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == current_user.company_id
    ).first()
    user = db.query(models.User).filter(
        models.User.id == user_id, models.User.company_id == current_user.company_id
    ).first()
    if not branch or not user:
        raise HTTPException(status_code=404, detail="Branch or user not found")

    link = (
        db.query(models.UserBranch)
        .filter(models.UserBranch.branch_id == branch_id, models.UserBranch.user_id == user_id)
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="User does not have access to this branch")

    grant_count = db.query(models.UserBranch).filter(models.UserBranch.user_id == user_id).count()
    if grant_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot revoke a user's last remaining branch")

    db.delete(link)
    audit.log(
        db, "update", "branch_users", branch.id,
        summary=f"Revoked '{user.username}' access to branch '{branch.name}'", user=current_user,
    )
    db.commit()
    return None
