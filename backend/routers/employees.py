from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from database import get_db
import audit
import models
import schemas
import security

router = APIRouter(
    prefix="/api/employees", tags=["employees"],
    dependencies=[Depends(security.require_admin_branch)],
)


def _with_branch(query):
    return query.options(joinedload(models.Employee.branch), joinedload(models.Employee.login_account))


@router.get("", response_model=list[schemas.EmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    return (
        _with_branch(db.query(models.Employee))
        .filter(models.Employee.company_id == current_user.company_id)
        .order_by(models.Employee.full_name)
        .all()
    )


def _get_branch(db: Session, company_id: int, branch_id: int) -> models.Branch:
    branch = db.query(models.Branch).filter(
        models.Branch.id == branch_id, models.Branch.company_id == company_id, models.Branch.is_active.is_(True),
    ).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch


@router.post("", response_model=schemas.EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: schemas.EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    branch = _get_branch(db, current_user.company_id, payload.branch_id)

    employee = models.Employee(
        company_id=current_user.company_id,
        branch_id=branch.id,
        full_name=payload.full_name,
        position=payload.position,
        phone=payload.phone,
        base_salary=payload.base_salary,
        is_active=payload.is_active,
    )
    db.add(employee)
    db.flush()
    audit.log(
        db, "create", "employee", employee.id,
        summary=f"Registered employee '{employee.full_name}' at branch '{branch.name}'",
        user=current_user,
    )
    db.commit()
    db.refresh(employee)
    return employee


@router.put("/{employee_id}", response_model=schemas.EmployeeOut)
def update_employee(
    employee_id: int,
    payload: schemas.EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    employee = db.query(models.Employee).filter(
        models.Employee.id == employee_id, models.Employee.company_id == current_user.company_id
    ).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    changes = []
    if payload.full_name is not None and payload.full_name != employee.full_name:
        changes.append(f"full_name: {employee.full_name} → {payload.full_name}")
        employee.full_name = payload.full_name
    if payload.position is not None and payload.position != employee.position:
        changes.append(f"position: {employee.position} → {payload.position}")
        employee.position = payload.position
    if payload.phone is not None and payload.phone != employee.phone:
        employee.phone = payload.phone
    if payload.base_salary is not None and payload.base_salary != employee.base_salary:
        changes.append(f"base_salary: {employee.base_salary} → {payload.base_salary}")
        employee.base_salary = payload.base_salary
    if payload.is_active is not None and payload.is_active != employee.is_active:
        changes.append(f"is_active: {employee.is_active} → {payload.is_active}")
        employee.is_active = payload.is_active
    if payload.branch_id is not None and payload.branch_id != employee.branch_id:
        branch = _get_branch(db, current_user.company_id, payload.branch_id)
        changes.append(f"branch: {employee.branch_id} → {branch.id}")
        employee.branch_id = branch.id

    if changes:
        audit.log(
            db, "update", "employee", employee.id,
            summary=f"Updated employee '{employee.full_name}': " + "; ".join(changes),
            user=current_user,
        )

    db.commit()
    db.refresh(employee)
    return employee


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
):
    employee = db.query(models.Employee).filter(
        models.Employee.id == employee_id, models.Employee.company_id == current_user.company_id
    ).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.has_login:
        raise HTTPException(
            status_code=400,
            detail="This employee has a system login — delete that user account first",
        )

    audit.log(
        db, "delete", "employee", employee.id,
        summary=f"Deleted employee '{employee.full_name}'",
        user=current_user,
    )
    db.delete(employee)
    db.commit()
    return None
