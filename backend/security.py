import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database import get_db
import models

# In production, set SECRET_KEY as a real environment variable (e.g. in Render's
# dashboard) — anyone who knows this value can forge login tokens.
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None or not user.is_active:
        raise credentials_exception
    if user.company_id is not None:
        company = db.query(models.Company).filter(models.Company.id == user.company_id).first()
        if company is None or not company.is_active:
            raise credentials_exception

    user.active_branch_id = payload.get("branch_id")
    return user


def require_role(*roles: str):
    def dependency(current_user: models.User = Depends(get_current_user)) -> models.User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return dependency


def get_active_branch(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> models.Branch:
    branch_id = getattr(current_user, "active_branch_id", None)
    branch = db.query(models.Branch).filter(models.Branch.id == branch_id).first() if branch_id else None
    if (
        branch is None
        or not branch.is_active
        or branch.company_id != current_user.company_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active branch selected. Please log in again.",
        )
    return branch


def require_platform_admin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )
    return current_user


def require_admin_branch(
    active_branch: models.Branch = Depends(get_active_branch),
) -> models.Branch:
    if not active_branch.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the administration branch can perform this action",
        )
    return active_branch


def require_module(*modules: str):
    def dependency(
        db: Session = Depends(get_db),
        active_branch: models.Branch = Depends(get_active_branch),
    ) -> models.Branch:
        if active_branch.is_admin:
            return active_branch
        enabled = {
            bm.module
            for bm in db.query(models.BranchModule).filter(
                models.BranchModule.branch_id == active_branch.id,
                models.BranchModule.module.in_(modules),
                models.BranchModule.enabled.is_(True),
            )
        }
        missing = [m for m in modules if m not in enabled]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This branch does not have access to: {', '.join(missing)}",
            )
        return active_branch

    return dependency


def user_accessible_branches(db: Session, user: models.User) -> list["models.Branch"]:
    has_admin_access = (
        db.query(models.UserBranch)
        .join(models.Branch, models.Branch.id == models.UserBranch.branch_id)
        .filter(
            models.UserBranch.user_id == user.id,
            models.Branch.is_admin.is_(True),
            models.Branch.company_id == user.company_id,
        )
        .first()
        is not None
    )
    if has_admin_access:
        return (
            db.query(models.Branch)
            .filter(models.Branch.is_active.is_(True), models.Branch.company_id == user.company_id)
            .order_by(models.Branch.id)
            .all()
        )
    return (
        db.query(models.Branch)
        .join(models.UserBranch, models.UserBranch.branch_id == models.Branch.id)
        .filter(
            models.UserBranch.user_id == user.id,
            models.Branch.is_active.is_(True),
            models.Branch.company_id == user.company_id,
        )
        .order_by(models.Branch.id)
        .all()
    )
