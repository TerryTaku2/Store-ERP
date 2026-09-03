import models


def log(db, action, entity_type, entity_id=None, summary="", user=None, username=None, role=None, branch_id=None):
    db.add(
        models.AuditLog(
            company_id=user.company_id if user else None,
            branch_id=branch_id if branch_id is not None else getattr(user, "active_branch_id", None),
            user_id=user.id if user else None,
            username=username or (user.username if user else "system"),
            role=role or (user.role if user else None),
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
        )
    )
