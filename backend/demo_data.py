import random
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

import inventory
import models
import security

DEMO_COMPANY_NAME = "Demo Retail Co."
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo1234"
DEMO_MANAGER_USERNAME = "demo_manager"
DEMO_CASHIER_USERNAME = "demo_cashier"
DEMO_STAFF_PASSWORD = "demo1234"

_RNG_SEED = 42

HQ_PRODUCTS = [
    ("001", "Bottled Water 500ml", "Beverages", 0.30, 0.75, 40),
    ("002", "Cola Can 330ml", "Beverages", 0.40, 1.00, 40),
    ("003", "Potato Chips 150g", "Snacks", 0.80, 1.80, 20),
    ("004", "Chocolate Bar", "Snacks", 0.50, 1.20, 25),
    ("005", "White Bread Loaf", "Groceries", 1.00, 2.20, 15),
    ("006", "Milk 1L", "Groceries", 0.90, 1.60, 20),
    ("007", "Eggs (Dozen)", "Groceries", 1.80, 3.00, 15),
    ("008", "Rice 5kg Bag", "Groceries", 4.50, 7.50, 10),
    ("009", "Dish Soap 500ml", "Household", 1.20, 2.50, 10),
    ("010", "AA Batteries (4pk)", "Electronics", 1.50, 3.50, 8),
    ("011", "USB Cable", "Electronics", 1.00, 4.00, 8),
    ("012", "Phone Charger", "Electronics", 3.00, 8.00, 6),
]

RIVERSIDE_PRODUCTS = [
    ("001", "Bottled Water 500ml", "Beverages", 0.32, 0.80, 30),
    ("002", "Orange Juice 1L", "Beverages", 1.10, 2.20, 15),
    ("003", "Tortilla Chips 200g", "Snacks", 0.90, 2.00, 20),
    ("004", "Granola Bar", "Snacks", 0.45, 1.10, 25),
    ("005", "Sourdough Loaf", "Groceries", 1.50, 3.00, 10),
    ("006", "Cheddar Cheese 250g", "Groceries", 2.20, 4.00, 12),
    ("007", "Free-range Eggs (Dozen)", "Groceries", 2.20, 3.80, 10),
    ("008", "Pasta 500g", "Groceries", 0.80, 1.80, 20),
]

AIRPORT_PRODUCTS = [
    ("001", "Bottled Water 500ml", "Beverages", 0.50, 2.50, 15),
    ("002", "Energy Drink 250ml", "Beverages", 0.90, 3.50, 12),
    ("003", "Trail Mix Pack", "Snacks", 1.20, 4.00, 10),
    ("004", "Neck Pillow", "Travel", 3.00, 12.00, 5),
    ("005", "Earplugs Set", "Travel", 0.80, 3.00, 10),
    ("006", "Phone Charger Cable", "Electronics", 2.00, 9.00, 5),
]


def ensure_demo_company(db: Session) -> tuple[models.Company, models.User]:
    """Get (or create) the demo company and reset it to a pristine, richly seeded
    state. Called at startup and on every /auth/demo-login, so a demo visitor —
    who has full admin power inside the sandbox — can never leave it messy for
    the next person."""
    company = db.query(models.Company).filter(models.Company.is_demo.is_(True)).first()
    if company is None:
        company = models.Company(name=DEMO_COMPANY_NAME, is_active=True, is_demo=True)
        db.add(company)
        db.flush()
    else:
        company.is_active = True

    admin = _upsert_user(db, company, DEMO_USERNAME, "Demo Admin", "admin", DEMO_PASSWORD)
    manager = _upsert_user(db, company, DEMO_MANAGER_USERNAME, "Demo Manager", "manager", DEMO_STAFF_PASSWORD)
    cashier = _upsert_user(db, company, DEMO_CASHIER_USERNAME, "Demo Cashier", "cashier", DEMO_STAFF_PASSWORD)
    db.flush()

    _reset_demo_data(db, company, admin, manager, cashier)
    db.commit()
    db.refresh(admin)
    return company, admin


def _upsert_user(db, company, username, full_name, role, password) -> models.User:
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        user = models.User(username=username)
        db.add(user)
    user.company_id = company.id
    user.full_name = full_name
    user.role = role
    user.is_active = True
    user.is_platform_admin = False
    user.hashed_password = security.hash_password(password)
    db.flush()
    return user


def _reset_demo_data(db, company, admin, manager, cashier):
    old_branch_ids = [
        row[0] for row in db.query(models.Branch.id).filter(models.Branch.company_id == company.id).all()
    ]
    if old_branch_ids:
        sale_ids = [r[0] for r in db.query(models.Sale.id).filter(models.Sale.branch_id.in_(old_branch_ids)).all()]
        purchase_ids = [
            r[0] for r in db.query(models.Purchase.id).filter(models.Purchase.branch_id.in_(old_branch_ids)).all()
        ]
        db.query(models.SaleItem).filter(models.SaleItem.sale_id.in_(sale_ids)).delete(synchronize_session=False)
        db.query(models.PurchaseItem).filter(
            models.PurchaseItem.purchase_id.in_(purchase_ids)
        ).delete(synchronize_session=False)
        db.query(models.Sale).filter(models.Sale.branch_id.in_(old_branch_ids)).delete(synchronize_session=False)
        db.query(models.Purchase).filter(models.Purchase.branch_id.in_(old_branch_ids)).delete(synchronize_session=False)
        db.query(models.InventoryMovement).filter(
            models.InventoryMovement.branch_id.in_(old_branch_ids)
        ).delete(synchronize_session=False)
        db.query(models.Expense).filter(models.Expense.branch_id.in_(old_branch_ids)).delete(synchronize_session=False)
        db.query(models.Product).filter(models.Product.branch_id.in_(old_branch_ids)).delete(synchronize_session=False)
        db.query(models.UserBranch).filter(
            models.UserBranch.branch_id.in_(old_branch_ids)
        ).delete(synchronize_session=False)
        db.query(models.BranchModule).filter(
            models.BranchModule.branch_id.in_(old_branch_ids)
        ).delete(synchronize_session=False)
        db.query(models.Branch).filter(models.Branch.company_id == company.id).delete(synchronize_session=False)
    db.query(models.AuditLog).filter(models.AuditLog.company_id == company.id).delete(synchronize_session=False)
    db.flush()

    rng = random.Random(_RNG_SEED)
    today = date.today()

    hq = _create_branch(db, company, "Head Office", "HQ", True, models.TOGGLE_MODULES)
    riverside = _create_branch(db, company, "Riverside Branch", "RIV", False, ["sales", "purchases", "reports"])
    airport = _create_branch(db, company, "Airport Kiosk", "AIR", False, ["sales", "reports"])
    db.flush()

    # HQ access implies visibility into every branch; give the manager and
    # cashier a smaller, more realistic slice to demonstrate that too.
    db.add(models.UserBranch(user_id=admin.id, branch_id=hq.id))
    db.add(models.UserBranch(user_id=manager.id, branch_id=hq.id))
    db.add(models.UserBranch(user_id=manager.id, branch_id=riverside.id))
    db.add(models.UserBranch(user_id=cashier.id, branch_id=riverside.id))
    db.add(models.UserBranch(user_id=cashier.id, branch_id=airport.id))
    db.flush()

    _seed_branch(
        db, rng, today, company, hq, cashiers=[admin, manager], products=HQ_PRODUCTS,
        with_purchases=True, with_expenses=True, sale_count=40,
    )
    _seed_branch(
        db, rng, today, company, riverside, cashiers=[manager, cashier], products=RIVERSIDE_PRODUCTS,
        with_purchases=True, with_expenses=False, sale_count=30,
    )
    _seed_branch(
        db, rng, today, company, airport, cashiers=[cashier], products=AIRPORT_PRODUCTS,
        with_purchases=False, with_expenses=False, sale_count=20,
    )


def _create_branch(db, company, name, code, is_admin, enabled_modules) -> models.Branch:
    branch = models.Branch(name=name, code=code, is_admin=is_admin, is_active=True, company_id=company.id)
    db.add(branch)
    db.flush()
    for module in models.TOGGLE_MODULES:
        db.add(models.BranchModule(branch_id=branch.id, module=module, enabled=module in enabled_modules))
    return branch


def _seed_branch(db, rng, today, company, branch, cashiers, products, with_purchases, with_expenses, sale_count):
    product_rows = []
    for suffix, name, category, cost, sell, reorder in products:
        p = models.Product(
            company_id=company.id, branch_id=branch.id,
            sku=f"{branch.code}-{suffix}", name=name, category=category, unit="pcs",
            cost_price=cost, sell_price=sell, quantity_on_hand=0, reorder_level=reorder,
        )
        db.add(p)
        product_rows.append(p)
    db.flush()

    opening_dt = datetime.combine(today - timedelta(days=28), datetime.min.time())
    if with_purchases:
        for p in product_rows:
            qty = rng.randint(int(p.reorder_level * 2), int(p.reorder_level * 4) + 10)
            purchase = models.Purchase(
                company_id=company.id, branch_id=branch.id,
                invoice_no=f"INV-{branch.code}-{p.id}",
                recorded_by_id=cashiers[0].id, total_amount=qty * p.cost_price, created_at=opening_dt,
            )
            db.add(purchase)
            db.flush()
            db.add(models.PurchaseItem(
                purchase_id=purchase.id, product_id=p.id, quantity=qty,
                unit_cost=p.cost_price, subtotal=qty * p.cost_price,
            ))
            p.quantity_on_hand += qty
            inventory.record_movement(
                db, p, "purchase", qty, reference_type="purchase", reference_id=purchase.id, user=cashiers[0],
            )
    else:
        for p in product_rows:
            qty = rng.randint(int(p.reorder_level * 2), int(p.reorder_level * 4) + 10)
            p.quantity_on_hand += qty
            inventory.record_movement(
                db, p, "adjustment", qty, reference_type="manual", note="Opening stock", user=cashiers[0],
            )
    db.flush()

    # Deliberately leave one product just under its reorder level so the
    # low-stock alert on the dashboard has something to show.
    if product_rows:
        low = product_rows[-1]
        target = max(0.0, low.reorder_level - 2)
        delta = target - low.quantity_on_hand
        low.quantity_on_hand = target
        inventory.record_movement(
            db, low, "adjustment", delta, reference_type="manual", note="Demo: simulate low stock", user=cashiers[0],
        )
    db.flush()

    for i in range(sale_count):
        days_ago = rng.randint(0, 27)
        sale_dt = datetime.combine(today - timedelta(days=days_ago), datetime.min.time()) + timedelta(
            hours=rng.randint(8, 20), minutes=rng.randint(0, 59)
        )
        cashier = rng.choice(cashiers)
        chosen = rng.sample(product_rows, min(rng.randint(1, 3), len(product_rows)))

        sale = models.Sale(
            company_id=company.id, branch_id=branch.id,
            invoice_no=f"{branch.code}-{1000 + i}", cashier_id=cashier.id,
            payment_method=rng.choice(["cash", "card", "mobile"]),
            total_amount=0, created_at=sale_dt,
        )
        db.add(sale)
        db.flush()

        total = 0.0
        for p in chosen:
            qty = rng.randint(1, 4)
            if p.quantity_on_hand < qty:
                continue
            subtotal = qty * p.sell_price
            db.add(models.SaleItem(
                sale_id=sale.id, product_id=p.id, quantity=qty, unit_price=p.sell_price,
                cost_price_at_sale=p.cost_price, subtotal=subtotal,
            ))
            p.quantity_on_hand -= qty
            inventory.record_movement(db, p, "sale", -qty, reference_type="sale", reference_id=sale.id, user=cashier)
            total += subtotal
        if total == 0:
            db.delete(sale)
        else:
            sale.total_amount = total
    db.flush()

    if with_expenses:
        # Day offsets are kept small (<=9 days) so at least a few always fall within
        # the current calendar month for the dashboard's month-to-date figures,
        # regardless of what day of the month "today" happens to be.
        expense_specs = [
            ("Rent", "Monthly branch rent", 1200, 9),
            ("Utilities", "Electricity & water", 220, 7),
            ("Salaries", "Part-time staff wages", 900, 4),
            ("Marketing", "Local flyers & social ads", 150, 2),
            ("Maintenance", "Equipment servicing", 80, 0),
        ]
        for category, desc, amount, days_ago in expense_specs:
            db.add(models.Expense(
                company_id=company.id, branch_id=branch.id, category=category, description=desc,
                amount=amount, expense_date=today - timedelta(days=days_ago), recorded_by_id=cashiers[0].id,
            ))
    db.flush()
