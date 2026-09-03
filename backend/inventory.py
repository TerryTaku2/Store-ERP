import models


def record_movement(
    db, product, movement_type, quantity_delta,
    reference_type=None, reference_id=None, note=None, user=None,
):
    """Log a stock movement. Call after product.quantity_on_hand has already
    been updated by quantity_delta, so balance_after reflects the new total."""
    db.add(
        models.InventoryMovement(
            company_id=product.company_id,
            branch_id=product.branch_id,
            product_id=product.id,
            movement_type=movement_type,
            quantity_delta=quantity_delta,
            balance_after=product.quantity_on_hand,
            reference_type=reference_type,
            reference_id=reference_id,
            note=note,
            created_by_id=user.id if user else None,
        )
    )
