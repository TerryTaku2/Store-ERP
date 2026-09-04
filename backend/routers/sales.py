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
    prefix="/api/sales", tags=["sales"],
    dependencies=[Depends(security.require_module("sales"))],
)


@router.get("", response_model=list[schemas.SaleOut])
def list_sales(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    query = db.query(models.Sale).options(
        joinedload(models.Sale.items).joinedload(models.SaleItem.product),
        joinedload(models.Sale.cashier),
    ).filter(models.Sale.branch_id == active_branch.id)
    if current_user.role == "cashier":
        query = query.filter(models.Sale.cashier_id == current_user.id)
    return query.order_by(
        models.Sale.created_at.desc(), models.Sale.id.desc()
    ).offset(offset).limit(limit).all()


@router.get("/{sale_id}", response_model=schemas.SaleOut)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    query = db.query(models.Sale).options(
        joinedload(models.Sale.items).joinedload(models.SaleItem.product),
        joinedload(models.Sale.cashier),
    ).filter(models.Sale.id == sale_id, models.Sale.branch_id == active_branch.id)
    if current_user.role == "cashier":
        query = query.filter(models.Sale.cashier_id == current_user.id)
    sale = query.first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.post("", response_model=schemas.SaleOut, status_code=status.HTTP_201_CREATED)
def create_sale(
    payload: schemas.SaleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Sale must have at least one item")

    # Pre-validate stock availability before touching anything.
    products_by_id = {}
    for item in payload.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        product = db.query(models.Product).filter(
            models.Product.id == item.product_id, models.Product.branch_id == active_branch.id
        ).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        already_requested = products_by_id.get(product.id, (product, 0))[1]
        total_requested = already_requested + item.quantity
        if total_requested > product.quantity_on_hand:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for '{product.name}': "
                f"available {product.quantity_on_hand}, requested {total_requested}",
            )
        products_by_id[product.id] = (product, total_requested)

    sale = models.Sale(
        branch_id=active_branch.id,
        company_id=active_branch.company_id,
        invoice_no=payload.invoice_no,
        cashier_id=current_user.id,
        customer_name=payload.customer_name,
        payment_method=payload.payment_method,
        total_amount=0,
    )
    db.add(sale)
    db.flush()

    total = 0.0
    for item in payload.items:
        product = products_by_id[item.product_id][0]
        subtotal = item.quantity * item.unit_price
        sale_item = models.SaleItem(
            sale_id=sale.id,
            product_id=product.id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            cost_price_at_sale=product.cost_price,
            subtotal=subtotal,
        )
        db.add(sale_item)
        product.quantity_on_hand -= item.quantity
        inventory.record_movement(
            db, product, "sale", -item.quantity,
            reference_type="sale", reference_id=sale.id, user=current_user,
        )
        total += subtotal

    sale.total_amount = total
    audit.log(
        db, "create", "sale", sale.id,
        summary=f"Recorded sale #{sale.id} — {len(payload.items)} item(s), total {total:.2f}",
        user=current_user,
    )
    db.commit()
    db.refresh(sale)
    return sale


@router.post("/{sale_id}/void", response_model=schemas.SaleOut)
def void_sale(
    sale_id: int,
    payload: schemas.VoidRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    sale = db.query(models.Sale).options(
        joinedload(models.Sale.items)
    ).filter(models.Sale.id == sale_id, models.Sale.branch_id == active_branch.id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if sale.is_voided:
        raise HTTPException(status_code=400, detail="Sale is already voided")

    # Reverse the stock this sale took out — restores exactly what was sold.
    for item in sale.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if product:
            product.quantity_on_hand += item.quantity
            inventory.record_movement(
                db, product, "adjustment", item.quantity,
                reference_type="sale_void", reference_id=sale.id,
                note=f"Reversal of voided sale #{sale.id}", user=current_user,
            )

    sale.is_voided = True
    sale.voided_at = datetime.utcnow()
    sale.voided_by_id = current_user.id
    sale.void_reason = payload.reason

    audit.log(
        db, "void", "sale", sale.id,
        summary=f"Voided sale #{sale.id} (was {sale.total_amount:.2f})"
        + (f" — reason: {payload.reason}" if payload.reason else ""),
        user=current_user,
    )
    db.commit()
    db.refresh(sale)
    return sale
