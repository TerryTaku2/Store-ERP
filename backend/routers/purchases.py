from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
import audit
import inventory
import models
import schemas
import security

router = APIRouter(
    prefix="/api/purchases", tags=["purchases"],
    dependencies=[Depends(security.require_module("purchases"))],
)


@router.get("", response_model=list[schemas.PurchaseOut])
def list_purchases(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return (
        db.query(models.Purchase)
        .options(joinedload(models.Purchase.items).joinedload(models.PurchaseItem.product))
        .filter(models.Purchase.branch_id == active_branch.id)
        .order_by(models.Purchase.created_at.desc())
        .all()
    )


@router.post("", response_model=schemas.PurchaseOut, status_code=status.HTTP_201_CREATED)
def create_purchase(
    payload: schemas.PurchaseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Purchase must have at least one item")

    purchase = models.Purchase(
        branch_id=active_branch.id,
        company_id=active_branch.company_id,
        invoice_no=payload.invoice_no,
        recorded_by_id=current_user.id,
        total_amount=0,
    )
    db.add(purchase)
    db.flush()

    total = 0.0
    for item in payload.items:
        product = db.query(models.Product).filter(
            models.Product.id == item.product_id, models.Product.branch_id == active_branch.id
        ).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")

        subtotal = item.quantity * item.unit_cost
        purchase_item = models.PurchaseItem(
            purchase_id=purchase.id,
            product_id=product.id,
            quantity=item.quantity,
            unit_cost=item.unit_cost,
            subtotal=subtotal,
        )
        db.add(purchase_item)

        product.quantity_on_hand += item.quantity
        product.cost_price = item.unit_cost
        inventory.record_movement(
            db, product, "purchase", item.quantity,
            reference_type="purchase", reference_id=purchase.id, user=current_user,
        )

        total += subtotal

    purchase.total_amount = total
    audit.log(
        db, "create", "purchase", purchase.id,
        summary=f"Recorded purchase #{purchase.id} — {len(payload.items)} item(s), total {total:.2f}",
        user=current_user,
    )
    db.commit()
    db.refresh(purchase)
    return purchase
