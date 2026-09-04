from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return (
        db.query(models.Purchase)
        .options(joinedload(models.Purchase.items).joinedload(models.PurchaseItem.product))
        .filter(models.Purchase.branch_id == active_branch.id)
        .order_by(models.Purchase.created_at.desc(), models.Purchase.id.desc())
        .offset(offset).limit(limit)
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


@router.post("/{purchase_id}/void", response_model=schemas.PurchaseOut)
def void_purchase(
    purchase_id: int,
    payload: schemas.VoidRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    purchase = db.query(models.Purchase).options(
        joinedload(models.Purchase.items)
    ).filter(models.Purchase.id == purchase_id, models.Purchase.branch_id == active_branch.id).first()
    if not purchase:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.is_voided:
        raise HTTPException(status_code=400, detail="Purchase is already voided")

    # A void reverses the stock this purchase brought in. If some of that stock
    # has already been sold/adjusted out, reversing would take it negative —
    # block rather than silently corrupting inventory.
    products = {}
    for item in purchase.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if product is None:
            continue
        already = products.get(product.id, (product, 0.0))[1]
        products[product.id] = (product, already + item.quantity)
    for product, qty in products.values():
        if product.quantity_on_hand - qty < 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot void: '{product.name}' only has {product.quantity_on_hand} in stock, "
                f"but this purchase brought in {qty} — some has already been sold or adjusted out.",
            )

    for item in purchase.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if product:
            product.quantity_on_hand -= item.quantity
            inventory.record_movement(
                db, product, "adjustment", -item.quantity,
                reference_type="purchase_void", reference_id=purchase.id,
                note=f"Reversal of voided purchase #{purchase.id}", user=current_user,
            )

    purchase.is_voided = True
    purchase.voided_at = datetime.utcnow()
    purchase.voided_by_id = current_user.id
    purchase.void_reason = payload.reason

    audit.log(
        db, "void", "purchase", purchase.id,
        summary=f"Voided purchase #{purchase.id} (was {purchase.total_amount:.2f})"
        + (f" — reason: {payload.reason}" if payload.reason else ""),
        user=current_user,
    )
    db.commit()
    db.refresh(purchase)
    return purchase
