from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
import models
import security

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def dashboard_summary(
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    branch_filter = branch_id if active_branch.is_admin else active_branch.id

    today = date.today()
    today_start = datetime.combine(today, datetime.min.time())
    today_end = today_start + timedelta(days=1)

    month_start = today.replace(day=1)
    month_start_dt = datetime.combine(month_start, datetime.min.time())

    today_sales_q = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= today_start, models.Sale.created_at < today_end,
    )
    month_revenue_q = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= month_start_dt,
    )
    month_cogs_q = (
        db.query(func.coalesce(func.sum(models.SaleItem.quantity * models.SaleItem.cost_price_at_sale), 0.0))
        .join(models.Sale, models.SaleItem.sale_id == models.Sale.id)
        .filter(
            models.Sale.company_id == current_user.company_id,
            models.Sale.is_voided.is_(False),
            models.Sale.created_at >= month_start_dt,
        )
    )
    month_expenses_q = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
        models.Expense.company_id == current_user.company_id,
        models.Expense.expense_date >= month_start,
    )
    low_stock_q = db.query(func.count(models.Product.id)).filter(
        models.Product.company_id == current_user.company_id,
        models.Product.quantity_on_hand <= models.Product.reorder_level,
    )
    recent_sales_q = db.query(models.Sale).options(joinedload(models.Sale.cashier)).filter(
        models.Sale.company_id == current_user.company_id, models.Sale.is_voided.is_(False)
    )
    today_payment_breakdown_q = db.query(
        models.Sale.payment_method, func.coalesce(func.sum(models.Sale.total_amount), 0.0)
    ).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= today_start, models.Sale.created_at < today_end,
    )

    if branch_filter is not None:
        today_sales_q = today_sales_q.filter(models.Sale.branch_id == branch_filter)
        month_revenue_q = month_revenue_q.filter(models.Sale.branch_id == branch_filter)
        month_cogs_q = month_cogs_q.filter(models.Sale.branch_id == branch_filter)
        month_expenses_q = month_expenses_q.filter(models.Expense.branch_id == branch_filter)
        low_stock_q = low_stock_q.filter(models.Product.branch_id == branch_filter)
        recent_sales_q = recent_sales_q.filter(models.Sale.branch_id == branch_filter)
        today_payment_breakdown_q = today_payment_breakdown_q.filter(models.Sale.branch_id == branch_filter)

    today_sales = today_sales_q.scalar()
    month_revenue = month_revenue_q.scalar()
    month_cogs = month_cogs_q.scalar()
    month_expenses = month_expenses_q.scalar()
    month_net_profit = (month_revenue - month_cogs) - month_expenses
    low_stock_count = low_stock_q.scalar()
    recent_sales = recent_sales_q.order_by(models.Sale.created_at.desc()).limit(5).all()
    today_payment_breakdown = {
        method: total
        for method, total in today_payment_breakdown_q.group_by(models.Sale.payment_method).all()
    }

    return {
        "today_sales": today_sales,
        "month_revenue": month_revenue,
        "month_expenses": month_expenses,
        "month_net_profit": month_net_profit,
        "low_stock_count": low_stock_count,
        "today_payment_breakdown": today_payment_breakdown,
        "recent_sales": [
            {
                "id": s.id,
                "invoice_no": s.invoice_no,
                "total_amount": s.total_amount,
                "created_at": s.created_at,
                "cashier": s.cashier.full_name if s.cashier else None,
            }
            for s in recent_sales
        ],
    }


@router.get("/sales-trend")
def sales_trend(
    branch_id: Optional[int] = Query(None),
    days: int = Query(14, le=90),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    """Daily sales totals for a trailing window, with zero-filled gaps so the
    chart doesn't skip days that had no sales at all."""
    branch_filter = branch_id if active_branch.is_admin else active_branch.id

    start_date = date.today() - timedelta(days=days - 1)
    start_dt = datetime.combine(start_date, datetime.min.time())

    query = db.query(
        func.date(models.Sale.created_at).label("day"),
        func.coalesce(func.sum(models.Sale.total_amount), 0.0),
    ).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= start_dt,
    )
    if branch_filter is not None:
        query = query.filter(models.Sale.branch_id == branch_filter)
    totals_by_day = {row[0]: row[1] for row in query.group_by(func.date(models.Sale.created_at)).all()}

    days_list = [(start_date + timedelta(days=i)).isoformat() for i in range(days)]
    return {"days": days_list, "totals": [totals_by_day.get(d, 0.0) for d in days_list]}


@router.get("/expense-breakdown")
def expense_breakdown(
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    """Month-to-date expenses grouped by category."""
    branch_filter = branch_id if active_branch.is_admin else active_branch.id
    month_start = date.today().replace(day=1)

    query = db.query(
        models.Expense.category, func.coalesce(func.sum(models.Expense.amount), 0.0)
    ).filter(
        models.Expense.company_id == current_user.company_id,
        models.Expense.expense_date >= month_start,
    )
    if branch_filter is not None:
        query = query.filter(models.Expense.branch_id == branch_filter)
    rows = query.group_by(models.Expense.category).order_by(func.sum(models.Expense.amount).desc()).all()

    return {"categories": [r[0] for r in rows], "totals": [r[1] for r in rows]}


@router.get("/branches-overview")
def branches_overview(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.require_admin_branch),
):
    """One row per branch with the numbers an owner checks at a glance — so they
    can immediately spot which shop is low on stock, slow on sales, or bleeding
    money — without switching into each branch one at a time."""
    today = date.today()
    today_start = datetime.combine(today, datetime.min.time())
    today_end = today_start + timedelta(days=1)
    month_start = today.replace(day=1)
    month_start_dt = datetime.combine(month_start, datetime.min.time())

    branches = (
        db.query(models.Branch)
        .filter(models.Branch.company_id == current_user.company_id, models.Branch.is_active.is_(True))
        .order_by(models.Branch.id)
        .all()
    )

    rows = []
    for b in branches:
        today_sales = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
            models.Sale.branch_id == b.id, models.Sale.is_voided.is_(False),
            models.Sale.created_at >= today_start, models.Sale.created_at < today_end,
        ).scalar()
        month_revenue = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
            models.Sale.branch_id == b.id, models.Sale.is_voided.is_(False),
            models.Sale.created_at >= month_start_dt,
        ).scalar()
        month_cogs = (
            db.query(func.coalesce(func.sum(models.SaleItem.quantity * models.SaleItem.cost_price_at_sale), 0.0))
            .join(models.Sale, models.SaleItem.sale_id == models.Sale.id)
            .filter(
                models.Sale.branch_id == b.id, models.Sale.is_voided.is_(False),
                models.Sale.created_at >= month_start_dt,
            )
            .scalar()
        )
        month_expenses = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
            models.Expense.branch_id == b.id, models.Expense.expense_date >= month_start
        ).scalar()
        low_stock_products = (
            db.query(models.Product)
            .filter(models.Product.branch_id == b.id, models.Product.quantity_on_hand <= models.Product.reorder_level)
            .order_by((models.Product.reorder_level - models.Product.quantity_on_hand).desc())
            .all()
        )
        stock_value = db.query(
            func.coalesce(func.sum(models.Product.quantity_on_hand * models.Product.cost_price), 0.0)
        ).filter(models.Product.branch_id == b.id).scalar()

        month_net_profit = (month_revenue - month_cogs) - month_expenses
        rows.append({
            "branch_id": b.id,
            "branch_name": b.name,
            "is_admin": b.is_admin,
            "today_sales": today_sales,
            "month_revenue": month_revenue,
            "month_expenses": month_expenses,
            "month_net_profit": month_net_profit,
            "low_stock_count": len(low_stock_products),
            "low_stock_items": [
                {
                    "product_id": p.id, "name": p.name,
                    "quantity_on_hand": p.quantity_on_hand, "reorder_level": p.reorder_level,
                }
                for p in low_stock_products[:5]
            ],
            "stock_value": stock_value,
            "needs_attention": len(low_stock_products) > 0 or month_net_profit < 0,
        })

    # Branches that need a look come first; within that, the most stock-outs first.
    rows.sort(key=lambda r: (not r["needs_attention"], -r["low_stock_count"], r["branch_id"]))

    return rows
