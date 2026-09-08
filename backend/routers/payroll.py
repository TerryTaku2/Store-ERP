from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(
    prefix="/api/payroll", tags=["payroll"],
    dependencies=[Depends(security.require_module("payroll"))],
)


def _with_items(query):
    return query.options(joinedload(models.PayrollRun.items).joinedload(models.PayslipItem.user))


@router.get("", response_model=list[schemas.PayrollRunOut])
def list_payroll_runs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return (
        _with_items(db.query(models.PayrollRun))
        .filter(models.PayrollRun.branch_id == active_branch.id)
        .order_by(models.PayrollRun.period_start.desc(), models.PayrollRun.id.desc())
        .all()
    )


@router.post("", response_model=schemas.PayrollRunOut, status_code=status.HTTP_201_CREATED)
def create_payroll_run(
    payload: schemas.PayrollRunCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    if payload.period_start > payload.period_end:
        raise HTTPException(status_code=400, detail="Period start must be on or before period end")

    existing_draft = db.query(models.PayrollRun).filter(
        models.PayrollRun.branch_id == active_branch.id, models.PayrollRun.status == "draft"
    ).first()
    if existing_draft:
        raise HTTPException(
            status_code=400,
            detail="A draft payroll run already exists for this branch — finalize or discard it first",
        )

    employees = (
        db.query(models.User)
        .join(models.UserBranch, models.UserBranch.user_id == models.User.id)
        .filter(
            models.UserBranch.branch_id == active_branch.id,
            models.User.is_active.is_(True),
        )
        .order_by(models.User.full_name)
        .all()
    )
    if not employees:
        raise HTTPException(status_code=400, detail="No active employees are assigned to this branch")

    run = models.PayrollRun(
        company_id=active_branch.company_id,
        branch_id=active_branch.id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        status="draft",
        created_by_id=current_user.id,
    )
    db.add(run)
    db.flush()

    total = 0.0
    for employee in employees:
        net_pay = employee.base_salary
        total += net_pay
        db.add(models.PayslipItem(
            payroll_run_id=run.id, user_id=employee.id,
            base_salary=employee.base_salary, bonus=0, deductions=0, net_pay=net_pay,
        ))
    run.total_amount = total

    audit.log(
        db, "create", "payroll_run", run.id,
        summary=f"Started payroll run for {payload.period_start}–{payload.period_end} ({len(employees)} employee(s))",
        user=current_user,
    )
    db.commit()
    return _with_items(db.query(models.PayrollRun)).filter(models.PayrollRun.id == run.id).first()


def _get_run(db: Session, run_id: int, branch_id: int) -> models.PayrollRun:
    run = _with_items(db.query(models.PayrollRun)).filter(
        models.PayrollRun.id == run_id, models.PayrollRun.branch_id == branch_id
    ).first()
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    return run


@router.get("/{run_id}", response_model=schemas.PayrollRunOut)
def get_payroll_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    return _get_run(db, run_id, active_branch.id)


@router.put("/{run_id}/items/{item_id}", response_model=schemas.PayrollRunOut)
def update_payslip_item(
    run_id: int,
    item_id: int,
    payload: schemas.PayslipItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    run = _get_run(db, run_id, active_branch.id)
    if run.status != "draft":
        raise HTTPException(status_code=400, detail="Only a draft payroll run can be adjusted")
    item = next((i for i in run.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Payslip item not found")

    if payload.bonus is not None:
        item.bonus = payload.bonus
    if payload.deductions is not None:
        item.deductions = payload.deductions
    item.net_pay = item.base_salary + item.bonus - item.deductions
    run.total_amount = sum(i.net_pay for i in run.items)

    db.commit()
    return _get_run(db, run_id, active_branch.id)


@router.post("/{run_id}/finalize", response_model=schemas.PayrollRunOut)
def finalize_payroll_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    run = _get_run(db, run_id, active_branch.id)
    if run.status != "draft":
        raise HTTPException(status_code=400, detail="This payroll run has already been finalized or voided")

    expense = models.Expense(
        company_id=active_branch.company_id,
        branch_id=active_branch.id,
        category="Payroll",
        description=f"Payroll for {run.period_start} to {run.period_end} ({len(run.items)} employee(s))",
        amount=run.total_amount,
        expense_date=run.period_end,
        recorded_by_id=current_user.id,
    )
    db.add(expense)
    db.flush()

    run.status = "finalized"
    run.finalized_at = datetime.utcnow()
    run.finalized_by_id = current_user.id
    run.expense_id = expense.id

    audit.log(
        db, "update", "payroll_run", run.id,
        summary=f"Finalized payroll run for {run.period_start}–{run.period_end} — {run.total_amount:.2f}",
        user=current_user,
    )
    db.commit()
    return _get_run(db, run_id, active_branch.id)


@router.post("/{run_id}/void", response_model=schemas.PayrollRunOut)
def void_payroll_run(
    run_id: int,
    payload: schemas.VoidPayrollRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    run = _get_run(db, run_id, active_branch.id)
    if run.status != "finalized":
        raise HTTPException(status_code=400, detail="Only a finalized payroll run can be voided")

    if run.expense_id:
        expense = db.query(models.Expense).filter(models.Expense.id == run.expense_id).first()
        if expense:
            db.delete(expense)
    run.expense_id = None
    run.status = "voided"
    run.voided_at = datetime.utcnow()
    run.voided_by_id = current_user.id
    run.void_reason = payload.reason

    audit.log(
        db, "void", "payroll_run", run.id,
        summary=f"Voided payroll run for {run.period_start}–{run.period_end} (was {run.total_amount:.2f})"
        + (f" — reason: {payload.reason}" if payload.reason else ""),
        user=current_user,
    )
    db.commit()
    return _get_run(db, run_id, active_branch.id)


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payroll_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin", "manager")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    run = _get_run(db, run_id, active_branch.id)
    if run.status != "draft":
        raise HTTPException(status_code=400, detail="Only a draft payroll run can be discarded")

    audit.log(
        db, "delete", "payroll_run", run.id,
        summary=f"Discarded draft payroll run for {run.period_start}–{run.period_end}",
        user=current_user,
    )
    db.delete(run)
    db.commit()
    return None
