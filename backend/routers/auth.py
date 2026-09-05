from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from database import get_db
import audit
import demo_data
import models
import schemas
import security

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _build_token(
    user: models.User,
    branches: list[models.Branch],
    branch: models.Branch | None,
    is_demo: bool = False,
    company: models.Company | None = None,
) -> schemas.Token:
    payload = {"sub": user.username, "role": user.role}
    if branch is not None:
        payload["branch_id"] = branch.id
    token = security.create_access_token(payload)
    return schemas.Token(
        access_token=token,
        role=user.role,
        full_name=user.full_name,
        username=user.username,
        company_name=company.name if company else None,
        branch_id=branch.id if branch else None,
        branch_name=branch.name if branch else None,
        is_admin_branch=branch.is_admin if branch else False,
        branches=branches,
        is_platform_admin=user.is_platform_admin,
        is_demo=is_demo,
    )


@router.post("/login", response_model=schemas.Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()

    if user and user.locked_until and user.locked_until > datetime.utcnow():
        minutes_left = max(1, int((user.locked_until - datetime.utcnow()).total_seconds() // 60) + 1)
        audit.log(
            db, "login_failed", "auth", user.id,
            summary=f"Login attempt for locked account '{user.username}'", user=user,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Too many failed attempts. Account locked — try again in {minutes_left} minute(s).",
        )

    if not user or not security.verify_password(form_data.password, user.hashed_password):
        if user:
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            locked = False
            if user.failed_login_attempts >= security.LOGIN_LOCKOUT_THRESHOLD:
                user.locked_until = datetime.utcnow() + timedelta(minutes=security.LOGIN_LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
                locked = True
            audit.log(
                db, "login_failed", "auth", user.id,
                summary=(
                    f"Failed login attempt for username '{form_data.username}'"
                    + (f" — account locked for {security.LOGIN_LOCKOUT_MINUTES} minutes" if locked else "")
                ),
                user=user,
            )
        else:
            audit.log(
                db, "login_failed", "auth",
                summary=f"Failed login attempt for username '{form_data.username}'",
                username=form_data.username,
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user.failed_login_attempts = 0
    user.locked_until = None

    if not user.is_active:
        audit.log(
            db,
            "login_failed",
            "auth",
            user.id,
            summary=f"Login attempt for inactive account '{user.username}'",
            user=user,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    is_demo = False
    company = None
    if user.company_id is not None:
        company = db.query(models.Company).filter(models.Company.id == user.company_id).first()
        is_demo = bool(company and company.is_demo)
        if company is None or not company.is_active:
            audit.log(
                db,
                "login_failed",
                "auth",
                user.id,
                summary=f"Login attempt for '{user.username}' whose company is disabled",
                user=user,
            )
            db.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This company's account is disabled")

    branches = security.user_accessible_branches(db, user)
    if not branches and not user.is_platform_admin:
        audit.log(
            db,
            "login_failed",
            "auth",
            user.id,
            summary=f"Login attempt for '{user.username}' with no branch access",
            user=user,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User has no branch access")

    active_branch = next((b for b in branches if b.is_admin), branches[0]) if branches else None

    audit.log(
        db, "login", "auth", user.id,
        summary=f"User '{user.username}' logged in", user=user,
        branch_id=active_branch.id if active_branch else None,
    )
    db.commit()

    return _build_token(user, branches, active_branch, is_demo, company)


@router.post("/switch-branch", response_model=schemas.Token)
def switch_branch(
    payload: schemas.BranchSwitch,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    branches = security.user_accessible_branches(db, current_user)
    branch = next((b for b in branches if b.id == payload.branch_id), None)
    if branch is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to that branch")

    audit.log(
        db, "switch_branch", "auth", current_user.id,
        summary=f"User '{current_user.username}' switched to branch '{branch.name}'",
        user=current_user, branch_id=branch.id,
    )
    db.commit()

    company = db.query(models.Company).filter(models.Company.id == current_user.company_id).first()
    return _build_token(current_user, branches, branch, bool(company and company.is_demo), company)


@router.post("/demo-login", response_model=schemas.Token)
def demo_login(db: Session = Depends(get_db)):
    """Public, no-credentials entry point: resets the demo company to a fresh,
    richly seeded state and logs straight in as its admin user. Anyone can use
    this to explore the whole system before creating a real account."""
    company, admin = demo_data.ensure_demo_company(db)
    branches = security.user_accessible_branches(db, admin)
    active_branch = next((b for b in branches if b.is_admin), branches[0]) if branches else None

    audit.log(
        db, "login", "auth", admin.id,
        summary="Demo visitor started a fresh demo session", user=admin,
        branch_id=active_branch.id if active_branch else None,
    )
    db.commit()

    return _build_token(admin, branches, active_branch, is_demo=True, company=company)


@router.get("/me", response_model=schemas.UserOut)
def read_me(current_user: models.User = Depends(security.get_current_user)):
    return current_user


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_own_password(
    payload: schemas.ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    if not security.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 6 characters")

    current_user.hashed_password = security.hash_password(payload.new_password)
    audit.log(
        db, "update", "user", current_user.id,
        summary=f"User '{current_user.username}' changed their own password",
        user=current_user,
    )
    db.commit()
    return None
