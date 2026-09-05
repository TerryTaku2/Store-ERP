import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from database import Base, engine, SessionLocal, run_auto_migrations
import demo_data
import models
import provisioning
from routers import auth, users, products, purchases, sales, expenses, reports, dashboard, audit, inventory, branches, companies

Base.metadata.create_all(bind=engine)
run_auto_migrations()


BRANCH_SCOPED_TABLES = ["products", "purchases", "sales", "expenses", "inventory_movements"]
COMPANY_SCOPED_TABLES = BRANCH_SCOPED_TABLES + ["audit_logs"]


def seed_default_company():
    """Every branch/user/business row must belong to a Company. On a brand-new
    install this creates the first company + admin together; on an existing
    install (upgrading from the single-company version) it creates one
    "Default Company" and backfills all pre-existing rows onto it, so nothing
    that already worked stops working."""
    db = SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            provisioning.provision_company(db, "Default Company", "admin", "Administrator", "admin123")
            db.commit()
            admin = db.query(models.User).filter(models.User.username == "admin").first()
            admin.is_platform_admin = True
            db.commit()
            print("=" * 60)
            print("Seeded default company 'Default Company' and admin user -> username: admin  password: admin123")
            print("This account is also a platform admin and can create further companies.")
            print("Please log in and change this password immediately.")
            print("=" * 60)
            return

        company = db.query(models.Company).order_by(models.Company.id).first()
        if company is None:
            company = models.Company(name="Default Company", is_active=True)
            db.add(company)
            db.flush()
            print(f"Seeded default company -> {company.name}")

        db.execute(text('UPDATE "users" SET company_id = :cid WHERE company_id IS NULL'), {"cid": company.id})
        db.execute(text('UPDATE "branches" SET company_id = :cid WHERE company_id IS NULL'), {"cid": company.id})
        for table in COMPANY_SCOPED_TABLES:
            db.execute(text(f'UPDATE "{table}" SET company_id = :cid WHERE company_id IS NULL'), {"cid": company.id})
        db.commit()

        hq = db.query(models.Branch).filter(
            models.Branch.is_admin.is_(True), models.Branch.company_id == company.id
        ).first()
        if hq is None:
            hq = models.Branch(name="Head Office", code="HQ", is_admin=True, is_active=True, company_id=company.id)
            db.add(hq)
            db.flush()
            for module in models.TOGGLE_MODULES:
                db.add(models.BranchModule(branch_id=hq.id, module=module, enabled=True))
            for admin_user in db.query(models.User).filter(
                models.User.role == "admin", models.User.company_id == company.id
            ):
                db.add(models.UserBranch(user_id=admin_user.id, branch_id=hq.id))
            db.commit()
            print(f"Seeded administration branch -> {hq.name} ({hq.code})")

        # Backfill any pre-existing branch-scoped rows onto the administration branch.
        for table in BRANCH_SCOPED_TABLES:
            db.execute(
                text(f'UPDATE "{table}" SET branch_id = :hq_id WHERE branch_id IS NULL'),
                {"hq_id": hq.id},
            )
        db.commit()

        # Bootstrap a platform admin if none exists yet, so companies can be provisioned.
        if db.query(models.User).filter(models.User.is_platform_admin.is_(True)).first() is None:
            bootstrap = db.query(models.User).filter(models.User.role == "admin").order_by(models.User.id).first()
            if bootstrap:
                bootstrap.is_platform_admin = True
                db.commit()
                print(f"Promoted '{bootstrap.username}' to platform admin (can create new companies).")
    finally:
        db.close()


def seed_demo_company():
    db = SessionLocal()
    try:
        db.execute(text('UPDATE "companies" SET is_demo = 0 WHERE is_demo IS NULL'))
        db.commit()
        existed = db.query(models.Company).filter(models.Company.is_demo.is_(True)).first() is not None
        demo_data.ensure_demo_company(db)
        if not existed:
            print(f"Seeded demo company -> username: {demo_data.DEMO_USERNAME}  password: {demo_data.DEMO_PASSWORD}")
    finally:
        db.close()


seed_default_company()
seed_demo_company()

app = FastAPI(title="T-Tech Connect")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(branches.router)
app.include_router(companies.router)
app.include_router(products.router)
app.include_router(purchases.router)
app.include_router(sales.router)
app.include_router(expenses.router)
app.include_router(reports.router)
app.include_router(dashboard.router)
app.include_router(audit.router)
app.include_router(inventory.router)

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
