from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import provisioning
import schemas
import security

router = APIRouter(
    prefix="/api/companies", tags=["companies"],
    dependencies=[Depends(security.require_platform_admin)],
)


@router.get("", response_model=list[schemas.CompanyOut])
def list_companies(db: Session = Depends(get_db)):
    return db.query(models.Company).order_by(models.Company.id).all()


@router.post("", response_model=schemas.CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(
    payload: schemas.CompanyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_platform_admin),
):
    try:
        company = provisioning.provision_company(
            db, payload.name, payload.admin_username, payload.admin_full_name, payload.admin_password
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    audit.log(
        db, "create", "company", company.id,
        summary=f"Created company '{company.name}' with admin '{payload.admin_username}'",
        user=current_user,
    )
    db.commit()
    db.refresh(company)
    return company


@router.put("/{company_id}", response_model=schemas.CompanyOut)
def update_company(
    company_id: int,
    payload: schemas.CompanyUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_platform_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    changes = []
    for key, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(company, key)
        if old != value:
            changes.append(f"{key}: {old} -> {value}")
            setattr(company, key, value)

    if changes:
        audit.log(
            db, "update", "company", company.id,
            summary=f"Updated company '{company.name}': " + "; ".join(changes),
            user=current_user,
        )
    db.commit()
    db.refresh(company)
    return company
