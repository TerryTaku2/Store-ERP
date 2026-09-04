from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
import models
import security

router = APIRouter(
    prefix="/api/reports", tags=["reports"],
    dependencies=[Depends(security.require_module("reports"))],
)


def _default_range(start_date: Optional[date], end_date: Optional[date]):
    today = date.today()
    if start_date is None:
        start_date = today.replace(day=1)
    if end_date is None:
        end_date = today
    return start_date, end_date


def _range_bounds(start_date: date, end_date: date):
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.min.time()) + timedelta(days=1)
    return start_dt, end_dt


def _resolve_branch_filter(active_branch: models.Branch, branch_id: Optional[int]) -> Optional[int]:
    """Non-HQ users are always scoped to their own branch. HQ users get an
    aggregate ("all branches") view unless they ask to drill into one branch_id."""
    if not active_branch.is_admin:
        return active_branch.id
    return branch_id


@router.get("/profit-loss")
def profit_loss(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    start_date, end_date = _default_range(start_date, end_date)
    result = _profit_loss(
        db, start_date, end_date, current_user.company_id, _resolve_branch_filter(active_branch, branch_id)
    )
    result["start_date"] = start_date
    result["end_date"] = end_date
    return result


@router.get("/cash-flow")
def cash_flow(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    start_date, end_date = _default_range(start_date, end_date)
    start_dt, end_dt = _range_bounds(start_date, end_date)
    branch_filter = _resolve_branch_filter(active_branch, branch_id)

    cash_in_q = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
    )
    expenses_out_q = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
        models.Expense.company_id == current_user.company_id,
        models.Expense.expense_date >= start_date, models.Expense.expense_date <= end_date,
    )
    purchases_out_q = db.query(func.coalesce(func.sum(models.Purchase.total_amount), 0.0)).filter(
        models.Purchase.company_id == current_user.company_id,
        models.Purchase.is_voided.is_(False),
        models.Purchase.created_at >= start_dt, models.Purchase.created_at < end_dt,
    )
    if branch_filter is not None:
        cash_in_q = cash_in_q.filter(models.Sale.branch_id == branch_filter)
        expenses_out_q = expenses_out_q.filter(models.Expense.branch_id == branch_filter)
        purchases_out_q = purchases_out_q.filter(models.Purchase.branch_id == branch_filter)

    cash_in = cash_in_q.scalar()
    expenses_out = expenses_out_q.scalar()
    purchases_out = purchases_out_q.scalar()
    cash_out = expenses_out + purchases_out

    return {
        "start_date": start_date,
        "end_date": end_date,
        "cash_in": cash_in,
        "cash_out": cash_out,
        "expenses_out": expenses_out,
        "purchases_out": purchases_out,
        "net_cash_flow": cash_in - cash_out,
    }


@router.get("/inventory-valuation")
def inventory_valuation(
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    branch_filter = _resolve_branch_filter(active_branch, branch_id)
    query = db.query(models.Product).filter(
        models.Product.company_id == current_user.company_id
    ).order_by(models.Product.name)
    if branch_filter is not None:
        query = query.filter(models.Product.branch_id == branch_filter)
    products = query.all()
    items = [
        {
            "id": p.id,
            "sku": p.sku,
            "name": p.name,
            "quantity_on_hand": p.quantity_on_hand,
            "cost_price": p.cost_price,
            "value": p.quantity_on_hand * p.cost_price,
        }
        for p in products
    ]
    total_value = sum(i["value"] for i in items)
    return {"items": items, "total_value": total_value}


def _profit_loss(
    db: Session, start_date: date, end_date: date, company_id: Optional[int], branch_id: Optional[int] = None
):
    start_dt, end_dt = _range_bounds(start_date, end_date)

    revenue_q = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
    )
    cogs_q = (
        db.query(func.coalesce(func.sum(models.SaleItem.quantity * models.SaleItem.cost_price_at_sale), 0.0))
        .join(models.Sale, models.SaleItem.sale_id == models.Sale.id)
        .filter(
            models.Sale.company_id == company_id,
            models.Sale.is_voided.is_(False),
            models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
        )
    )
    expenses_q = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
        models.Expense.company_id == company_id,
        models.Expense.expense_date >= start_date, models.Expense.expense_date <= end_date,
    )
    count_q = db.query(func.count(models.Sale.id)).filter(
        models.Sale.company_id == company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
    )
    if branch_id is not None:
        revenue_q = revenue_q.filter(models.Sale.branch_id == branch_id)
        cogs_q = cogs_q.filter(models.Sale.branch_id == branch_id)
        expenses_q = expenses_q.filter(models.Expense.branch_id == branch_id)
        count_q = count_q.filter(models.Sale.branch_id == branch_id)

    revenue = revenue_q.scalar()
    cogs = cogs_q.scalar()
    expenses = expenses_q.scalar()
    transaction_count = count_q.scalar()
    gross_profit = revenue - cogs
    net_profit = gross_profit - expenses
    return {
        "revenue": revenue,
        "cogs": cogs,
        "gross_profit": gross_profit,
        "expenses": expenses,
        "net_profit": net_profit,
        "transaction_count": transaction_count,
        "avg_sale_value": (revenue / transaction_count) if transaction_count else 0.0,
    }


@router.get("/financial-statement")
def financial_statement(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    """Income statement for the period, plus a simple balance sheet as of end_date.

    The balance sheet is an approximation: this system does not track loans,
    payables, or capital contributions, so liabilities are assumed zero and
    equity is simply total assets (cash position + inventory value).
    """
    start_date, end_date = _default_range(start_date, end_date)
    branch_filter = _resolve_branch_filter(active_branch, branch_id)
    income_statement = _profit_loss(db, start_date, end_date, current_user.company_id, branch_filter)
    income_statement["start_date"] = start_date
    income_statement["end_date"] = end_date

    _, as_of_dt = _range_bounds(end_date, end_date)

    lifetime_sales_q = db.query(func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False), models.Sale.created_at < as_of_dt,
    )
    lifetime_purchases_q = db.query(func.coalesce(func.sum(models.Purchase.total_amount), 0.0)).filter(
        models.Purchase.company_id == current_user.company_id,
        models.Purchase.is_voided.is_(False), models.Purchase.created_at < as_of_dt,
    )
    lifetime_expenses_q = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
        models.Expense.company_id == current_user.company_id, models.Expense.expense_date <= end_date
    )
    products_q = db.query(models.Product).filter(models.Product.company_id == current_user.company_id)
    if branch_filter is not None:
        lifetime_sales_q = lifetime_sales_q.filter(models.Sale.branch_id == branch_filter)
        lifetime_purchases_q = lifetime_purchases_q.filter(models.Purchase.branch_id == branch_filter)
        lifetime_expenses_q = lifetime_expenses_q.filter(models.Expense.branch_id == branch_filter)
        products_q = products_q.filter(models.Product.branch_id == branch_filter)

    lifetime_sales = lifetime_sales_q.scalar()
    lifetime_purchases = lifetime_purchases_q.scalar()
    lifetime_expenses = lifetime_expenses_q.scalar()
    cash_position = lifetime_sales - lifetime_purchases - lifetime_expenses

    products = products_q.all()
    inventory_value = sum(p.quantity_on_hand * p.cost_price for p in products)

    total_assets = cash_position + inventory_value
    balance_sheet = {
        "as_of_date": end_date,
        "cash_position": cash_position,
        "inventory_value": inventory_value,
        "total_assets": total_assets,
        "total_liabilities": 0.0,
        "total_equity": total_assets,
    }

    return {"income_statement": income_statement, "balance_sheet": balance_sheet}


@router.get("/store-performance")
def store_performance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    start_date, end_date = _default_range(start_date, end_date)
    branch_filter = _resolve_branch_filter(active_branch, branch_id)
    period_days = (end_date - start_date).days + 1
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - timedelta(days=period_days - 1)

    current = _profit_loss(db, start_date, end_date, current_user.company_id, branch_filter)
    previous = _profit_loss(db, prev_start, prev_end, current_user.company_id, branch_filter)

    def pct_change(curr, prev):
        if prev == 0:
            return None
        return ((curr - prev) / abs(prev)) * 100

    start_dt, end_dt = _range_bounds(start_date, end_date)
    by_cashier_q = (
        db.query(
            models.User.full_name,
            func.count(models.Sale.id),
            func.coalesce(func.sum(models.Sale.total_amount), 0.0),
        )
        .join(models.Sale, models.Sale.cashier_id == models.User.id)
        .filter(
            models.Sale.company_id == current_user.company_id,
            models.Sale.is_voided.is_(False),
            models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
        )
    )
    if branch_filter is not None:
        by_cashier_q = by_cashier_q.filter(models.Sale.branch_id == branch_filter)
    by_cashier_rows = (
        by_cashier_q.group_by(models.User.full_name)
        .order_by(func.coalesce(func.sum(models.Sale.total_amount), 0.0).desc())
        .all()
    )
    by_cashier = [
        {"cashier": name, "transaction_count": count, "revenue": revenue}
        for name, count, revenue in by_cashier_rows
    ]

    return {
        "start_date": start_date,
        "end_date": end_date,
        "current": current,
        "previous": previous,
        "previous_period": {"start_date": prev_start, "end_date": prev_end},
        "change_pct": {
            "revenue": pct_change(current["revenue"], previous["revenue"]),
            "net_profit": pct_change(current["net_profit"], previous["net_profit"]),
            "transaction_count": pct_change(current["transaction_count"], previous["transaction_count"]),
            "avg_sale_value": pct_change(current["avg_sale_value"], previous["avg_sale_value"]),
        },
        "by_cashier": by_cashier,
    }


@router.get("/top-products")
def top_products(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(10, le=50),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    start_date, end_date = _default_range(start_date, end_date)
    start_dt, end_dt = _range_bounds(start_date, end_date)
    branch_filter = _resolve_branch_filter(active_branch, branch_id)

    profit_expr = func.sum(
        models.SaleItem.subtotal
        - (models.SaleItem.quantity * models.SaleItem.cost_price_at_sale)
    )
    qty_expr = func.sum(models.SaleItem.quantity)
    revenue_expr = func.sum(models.SaleItem.subtotal)

    query = (
        db.query(
            models.Product.id,
            models.Product.sku,
            models.Product.name,
            qty_expr,
            revenue_expr,
            profit_expr,
        )
        .join(models.SaleItem, models.SaleItem.product_id == models.Product.id)
        .join(models.Sale, models.SaleItem.sale_id == models.Sale.id)
        .filter(
            models.Sale.company_id == current_user.company_id,
            models.Sale.is_voided.is_(False),
            models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
        )
    )
    if branch_filter is not None:
        query = query.filter(models.Sale.branch_id == branch_filter)
    rows = query.group_by(models.Product.id, models.Product.sku, models.Product.name).all()

    items = [
        {
            "product_id": pid,
            "sku": sku,
            "name": name,
            "quantity_sold": qty or 0.0,
            "revenue": revenue or 0.0,
            "profit": profit or 0.0,
            "margin_pct": ((profit / revenue) * 100) if revenue else None,
        }
        for pid, sku, name, qty, revenue, profit in rows
    ]

    return {
        "start_date": start_date,
        "end_date": end_date,
        "most_demanded": sorted(items, key=lambda i: i["quantity_sold"], reverse=True)[:limit],
        "most_profitable": sorted(items, key=lambda i: i["profit"], reverse=True)[:limit],
    }


@router.get("/sales-summary")
def sales_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    branch_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    start_date, end_date = _default_range(start_date, end_date)
    start_dt, end_dt = _range_bounds(start_date, end_date)
    branch_filter = _resolve_branch_filter(active_branch, branch_id)

    day_col = func.date(models.Sale.created_at)
    query = db.query(day_col.label("day"), func.coalesce(func.sum(models.Sale.total_amount), 0.0)).filter(
        models.Sale.company_id == current_user.company_id,
        models.Sale.is_voided.is_(False),
        models.Sale.created_at >= start_dt, models.Sale.created_at < end_dt,
    )
    if branch_filter is not None:
        query = query.filter(models.Sale.branch_id == branch_filter)
    rows = query.group_by(day_col).order_by(day_col).all()
    return {"start_date": start_date, "end_date": end_date, "days": [r[0] for r in rows], "totals": [r[1] for r in rows]}
