import base64
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(prefix="/api/company-profile", tags=["company-profile"])

# Keep logos small: they ride along in every login response and sidebar render.
MAX_LOGO_BYTES = 600_000
LOGO_DATA_URI_RE = re.compile(r"^data:image/(png|jpeg|jpg|webp|gif);base64,(?P<data>.+)$")


def _validate_logo(logo: str) -> None:
    match = LOGO_DATA_URI_RE.match(logo)
    if not match:
        raise HTTPException(status_code=400, detail="Logo must be a PNG, JPEG, WEBP or GIF image")
    try:
        decoded_size = len(base64.b64decode(match.group("data"), validate=True))
    except (base64.binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Logo image data is corrupted")
    if decoded_size > MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="Logo image is too large (max 600KB)")


@router.get("", response_model=schemas.CompanyOut)
def get_my_company_profile(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    if current_user.company_id is None:
        raise HTTPException(status_code=404, detail="No business profile for this account")
    company = db.query(models.Company).filter(models.Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.put("", response_model=schemas.CompanyOut)
def update_my_company_profile(
    payload: schemas.CompanyProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    if current_user.company_id is None:
        raise HTTPException(status_code=404, detail="No business profile for this account")
    company = db.query(models.Company).filter(models.Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and not (data["name"] and data["name"].strip()):
        raise HTTPException(status_code=400, detail="Business name cannot be empty")
    if data.get("logo"):
        _validate_logo(data["logo"])

    changes = []
    for key, value in data.items():
        old = getattr(company, key)
        if old != value:
            changes.append("logo updated" if key == "logo" else f"{key}: {old} -> {value}")
            setattr(company, key, value.strip() if key == "name" else value)

    if changes:
        audit.log(
            db, "update", "company", company.id,
            summary=f"Updated business profile: " + "; ".join(changes),
            user=current_user,
        )
    db.commit()
    db.refresh(company)
    return company
