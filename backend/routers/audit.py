from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
import security

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])


@router.get("", response_model=list[schemas.AuditLogOut])
def list_audit_logs(
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(200, le=1000),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.require_role("admin")),
    active_branch: models.Branch = Depends(security.get_active_branch),
):
    query = db.query(models.AuditLog).filter(models.AuditLog.company_id == current_user.company_id)
    branch_filter = branch_id if active_branch.is_admin else active_branch.id
    if branch_filter is not None:
        query = query.filter(models.AuditLog.branch_id == branch_filter)
    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(models.AuditLog.action == action)
    if user_id:
        query = query.filter(models.AuditLog.user_id == user_id)
    if start_date:
        query = query.filter(
            models.AuditLog.created_at >= datetime.combine(start_date, datetime.min.time())
        )
    if end_date:
        query = query.filter(
            models.AuditLog.created_at
            < datetime.combine(end_date, datetime.min.time()) + timedelta(days=1)
        )
    return query.order_by(models.AuditLog.created_at.desc()).limit(limit).all()
