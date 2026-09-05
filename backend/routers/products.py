from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("", response_model=list[schemas.ProductOut])
def list_products(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return (
        db.query(models.Product)
        .filter(models.Product.branch_id == active_branch.id)
        .order_by(models.Product.name)
        .all()
    )


@router.get("/barcode/{barcode}", response_model=schemas.ProductOut)
def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    product = db.query(models.Product).filter(
        models.Product.barcode == barcode, models.Product.branch_id == active_branch.id
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="No product found for that barcode")
    return product


@router.post("", response_model=schemas.ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if payload.barcode and db.query(models.Product).filter(
        models.Product.barcode == payload.barcode, models.Product.branch_id == active_branch.id
    ).first():
        raise HTTPException(status_code=400, detail="Barcode already exists")
    if payload.parent_product_id is not None:
        if not db.query(models.Product).filter(
            models.Product.id == payload.parent_product_id, models.Product.branch_id == active_branch.id
        ).first():
            raise HTTPException(status_code=404, detail="Parent product not found")
    product = models.Product(**payload.model_dump(), branch_id=active_branch.id, company_id=active_branch.company_id)
    db.add(product)
    db.flush()
    audit.log(
        db, "create", "product", product.id,
        summary=f"Created product '{product.name}'",
        user=current_user,
    )
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=schemas.ProductOut)
def update_product(
    product_id: int,
    payload: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    product = db.query(models.Product).filter(
        models.Product.id == product_id, models.Product.branch_id == active_branch.id
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if payload.barcode:
        clash = db.query(models.Product).filter(
            models.Product.barcode == payload.barcode,
            models.Product.branch_id == active_branch.id,
            models.Product.id != product_id,
        ).first()
        if clash:
            raise HTTPException(status_code=400, detail="Barcode already exists")
    if payload.parent_product_id is not None:
        if payload.parent_product_id == product_id:
            raise HTTPException(status_code=400, detail="A product cannot be its own parent")
        if not db.query(models.Product).filter(
            models.Product.id == payload.parent_product_id, models.Product.branch_id == active_branch.id
        ).first():
            raise HTTPException(status_code=404, detail="Parent product not found")
    changes = []
    for key, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(product, key)
        if old != value:
            changes.append(f"{key}: {old} → {value}")
            setattr(product, key, value)
    if changes:
        audit.log(
            db, "update", "product", product.id,
            summary=f"Updated product '{product.name}': " + "; ".join(changes),
            user=current_user,
        )
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    product = db.query(models.Product).filter(
        models.Product.id == product_id, models.Product.branch_id == active_branch.id
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    audit.log(
        db, "delete", "product", product.id,
        summary=f"Deleted product '{product.name}'",
        user=current_user,
    )
    db.delete(product)
    db.commit()
    return None
