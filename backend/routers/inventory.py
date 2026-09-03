from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
import audit
import inventory
import models
import schemas
import security

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/movements", response_model=list[schemas.InventoryMovementOut])
def list_movements(
    product_id: Optional[int] = Query(None),
    movement_type: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    query = db.query(models.InventoryMovement).options(
        joinedload(models.InventoryMovement.product),
        joinedload(models.InventoryMovement.created_by),
    ).filter(models.InventoryMovement.branch_id == active_branch.id)
    if product_id is not None:
        query = query.filter(models.InventoryMovement.product_id == product_id)
    if movement_type:
        query = query.filter(models.InventoryMovement.movement_type == movement_type)
    if start_date is not None:
        start_dt = datetime.combine(start_date, datetime.min.time())
        query = query.filter(models.InventoryMovement.created_at >= start_dt)
    if end_date is not None:
        end_dt = datetime.combine(end_date, datetime.min.time()) + timedelta(days=1)
        query = query.filter(models.InventoryMovement.created_at < end_dt)
    return (
        query.order_by(models.InventoryMovement.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/adjustments", response_model=schemas.InventoryMovementOut, status_code=201)
def create_adjustment(
    payload: schemas.StockAdjustmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if payload.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="Quantity change cannot be zero")
    product = db.query(models.Product).filter(
        models.Product.id == payload.product_id, models.Product.branch_id == active_branch.id
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    new_qty = product.quantity_on_hand + payload.quantity_delta
    if new_qty < 0:
        raise HTTPException(
            status_code=400,
            detail=f"Adjustment would take '{product.name}' below zero "
            f"(on hand {product.quantity_on_hand}, change {payload.quantity_delta})",
        )

    product.quantity_on_hand = new_qty
    inventory.record_movement(
        db, product, "adjustment", payload.quantity_delta,
        reference_type="manual", note=payload.note, user=current_user,
    )
    audit.log(
        db, "adjust", "product", product.id,
        summary=f"Stock adjustment for '{product.name}': {payload.quantity_delta:+g} "
        f"({payload.note or 'no reason given'}) → balance {new_qty:g}",
        user=current_user,
    )
    db.commit()

    movement = (
        db.query(models.InventoryMovement)
        .filter(models.InventoryMovement.product_id == product.id)
        .order_by(models.InventoryMovement.id.desc())
        .first()
    )
    return movement
