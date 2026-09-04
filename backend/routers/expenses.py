from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(
    prefix="/api/expenses", tags=["expenses"],
    dependencies=[Depends(security.require_module("expenses"))],
)


@router.get("", response_model=list[schemas.ExpenseOut])
def list_expenses(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return (
        db.query(models.Expense)
        .filter(models.Expense.branch_id == active_branch.id)
        .order_by(models.Expense.expense_date.desc(), models.Expense.id.desc())
        .offset(offset).limit(limit)
        .all()
    )


@router.post("", response_model=schemas.ExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: schemas.ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    expense = models.Expense(
        **payload.model_dump(),
        recorded_by_id=current_user.id,
        branch_id=active_branch.id,
        company_id=active_branch.company_id,
    )
    db.add(expense)
    db.flush()
    audit.log(
        db, "create", "expense", expense.id,
        summary=f"Recorded expense '{expense.category}' — {expense.amount:.2f} ({expense.expense_date})",
        user=current_user,
    )
    db.commit()
    db.refresh(expense)
    return expense


@router.put("/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(
    expense_id: int,
    payload: schemas.ExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    expense = db.query(models.Expense).filter(
        models.Expense.id == expense_id, models.Expense.branch_id == active_branch.id
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    changes = []
    for key, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(expense, key)
        if old != value:
            changes.append(f"{key}: {old} → {value}")
            setattr(expense, key, value)
    if changes:
        audit.log(
            db, "update", "expense", expense.id,
            summary=f"Updated expense '{expense.category}': " + "; ".join(changes),
            user=current_user,
        )
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    expense = db.query(models.Expense).filter(
        models.Expense.id == expense_id, models.Expense.branch_id == active_branch.id
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    audit.log(
        db, "delete", "expense", expense.id,
        summary=f"Deleted expense '{expense.category}' — {expense.amount:.2f} ({expense.expense_date})",
        user=current_user,
    )
    db.delete(expense)
    db.commit()
    return None
