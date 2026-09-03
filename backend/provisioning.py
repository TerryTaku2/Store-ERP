from sqlalchemy.orm import Session

import models
import security


def provision_company(
    db: Session,
    name: str,
    admin_username: str,
    admin_full_name: str,
    admin_password: str,
    branch_name: str = "Head Office",
    branch_code: str = "HQ",
) -> models.Company:
    """Create a new Company with an admin (is_admin=True, all modules enabled) branch
    and its first company-admin user. Used both by the startup seeder and by the
    platform-admin /api/companies endpoint, so a new company is always set up the
    same way."""
    if db.query(models.User).filter(models.User.username == admin_username).first():
        raise ValueError(f"Username '{admin_username}' is already taken")

    company = models.Company(name=name, is_active=True)
    db.add(company)
    db.flush()

    branch = models.Branch(
        name=branch_name, code=branch_code, is_admin=True, is_active=True, company_id=company.id
    )
    db.add(branch)
    db.flush()
    for module in models.TOGGLE_MODULES:
        db.add(models.BranchModule(branch_id=branch.id, module=module, enabled=True))

    admin = models.User(
        username=admin_username,
        full_name=admin_full_name,
        role="admin",
        is_active=True,
        company_id=company.id,
        hashed_password=security.hash_password(admin_password),
    )
    db.add(admin)
    db.flush()
    db.add(models.UserBranch(user_id=admin.id, branch_id=branch.id))

    return company
