import os
from datetime import datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

# Defaults to a file next to this module for local dev. In production, point
# this at a file inside a mounted persistent disk (e.g. Render Disks) via the
# DATABASE_PATH env var — container filesystems are otherwise ephemeral and
# store.db resets on every redeploy. See README.md's Deployment section.
DATABASE_PATH = os.path.abspath(os.environ.get("DATABASE_PATH", "./store.db"))
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_auto_migrations():
    """Add any model columns missing from existing tables (SQLite ALTER TABLE ADD COLUMN).

    create_all() only creates missing tables, not missing columns on tables that
    already exist, so this keeps an existing store.db in sync as the models evolve.
    """
    with engine.begin() as conn:
        # Bound to conn (not engine): inspect(engine) would check out a
        # *separate* pooled connection for every reflection call, and SQLite's
        # rollback-journal isolation hides this transaction's uncommitted
        # ALTER/CREATE/DROP statements from any other connection. Binding to
        # conn makes every has_table()/get_columns() call below see this
        # function's own writes immediately (e.g. a column ADD'd earlier in
        # this same run), instead of the schema as it looked before this call
        # started — a real prior bug: a guard checking a just-added column
        # would see it as still missing and skip logic it should have run.
        inspector = inspect(conn)
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing_cols = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name not in existing_cols:
                    col_type = column.type.compile(engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
                # ADD COLUMN leaves existing rows NULL regardless of the model's
                # default, and that can linger across restarts once it's happened
                # (the column now "exists" so this loop skips it) — so backfill
                # unconditionally for any non-nullable column with a plain scalar
                # default. Harmless no-op once no NULLs remain.
                if not column.nullable and column.default is not None and getattr(column.default, "is_scalar", False):
                    conn.execute(
                        text(f'UPDATE "{table.name}" SET "{column.name}" = :default WHERE "{column.name}" IS NULL'),
                        {"default": column.default.arg},
                    )

        # products.sku was removed; drop the leftover column and its indexes from
        # existing databases (no-op on a fresh one that never had the column).
        if inspector.has_table("products"):
            product_cols = {col["name"] for col in inspector.get_columns("products")}
            if "sku" in product_cols:
                for idx in inspector.get_indexes("products"):
                    if "sku" in idx["column_names"]:
                        conn.execute(text(f'DROP INDEX IF EXISTS "{idx["name"]}"'))
                conn.execute(text('ALTER TABLE "products" DROP COLUMN "sku"'))

        # branches.code used to be globally unique (single-company); it's now unique
        # per-company instead, so every company can have its own "HQ" branch code.
        if inspector.has_table("branches"):
            for idx in inspector.get_indexes("branches"):
                if idx["name"] == "ix_branches_code" and idx.get("unique"):
                    conn.execute(text('DROP INDEX IF EXISTS "ix_branches_code"'))
            conn.execute(
                text('CREATE UNIQUE INDEX IF NOT EXISTS "uq_branches_company_code" ON "branches" ("company_id", "code")')
            )

        # HR/payroll data (base_salary) used to live directly on User, and
        # payslip_items.user_id pointed at users.id. Employee is now that record
        # instead (see models.py), so backfill one Employee per existing User that
        # doesn't have one yet, carrying over base_salary + their first branch,
        # link the User to it, and remap that user's historical payslip_items rows
        # onto the new employee. Runs once per user — a user that already has an
        # employee_id is skipped, so this is a no-op on every later startup.
        user_cols = {c["name"] for c in inspector.get_columns("users")} if inspector.has_table("users") else set()
        payslip_cols = (
            {c["name"] for c in inspector.get_columns("payslip_items")}
            if inspector.has_table("payslip_items") else set()
        )
        if "employee_id" in user_cols and "base_salary" in user_cols and inspector.has_table("employees"):
            unmigrated = conn.execute(
                text('SELECT id, company_id, full_name, base_salary, is_active FROM "users" WHERE "employee_id" IS NULL')
            ).fetchall()
            for row in unmigrated:
                branch_row = conn.execute(
                    text('SELECT branch_id FROM "user_branches" WHERE user_id = :uid ORDER BY id LIMIT 1'),
                    {"uid": row.id},
                ).first()
                result = conn.execute(
                    text(
                        'INSERT INTO "employees" (company_id, branch_id, full_name, base_salary, is_active, created_at) '
                        'VALUES (:company_id, :branch_id, :full_name, :base_salary, :is_active, :created_at)'
                    ),
                    {
                        "company_id": row.company_id,
                        "branch_id": branch_row[0] if branch_row else None,
                        "full_name": row.full_name,
                        "base_salary": row.base_salary,
                        "is_active": row.is_active,
                        "created_at": datetime.utcnow(),
                    },
                )
                employee_id = result.lastrowid
                conn.execute(
                    text('UPDATE "users" SET "employee_id" = :eid WHERE "id" = :uid'),
                    {"eid": employee_id, "uid": row.id},
                )
                if "user_id" in payslip_cols:
                    conn.execute(
                        text('UPDATE "payslip_items" SET "employee_id" = :eid WHERE "user_id" = :uid'),
                        {"eid": employee_id, "uid": row.id},
                    )

            # users.base_salary is superseded by employees.base_salary (carried
            # over above) — drop the leftover column. Not part of any index/FK,
            # so a plain DROP COLUMN (unlike payslip_items.user_id) is enough.
            if "base_salary" in user_cols:
                conn.execute(text('ALTER TABLE "users" DROP COLUMN "base_salary"'))

        # A payslip_items row can reference a user_id that no longer exists (the
        # user was deleted after being paid) — the per-user loop above only
        # matches on live users, so those rows are still unmatched. Rather than
        # lose that payroll history, park each one on a single per-company
        # "Former Staff" placeholder employee instead. This runs unconditionally
        # (not only while the User->Employee migration guard above is active):
        # once users.base_salary is dropped, that guard is permanently False on
        # every later startup, but a payslip_items row can still end up with a
        # NULL employee_id from an earlier partial migration — and the NOT NULL
        # rebuild below needs every row fixed up regardless of when it appeared.
        if inspector.has_table("employees") and "employee_id" in payslip_cols:
            # LEFT JOIN, not JOIN: a payslip_items row can also be doubly
            # orphaned — its payroll_run_id pointing at a payroll_runs row that
            # no longer exists (deleted outside the ORM's cascade). An inner
            # join would silently drop those rows here, leaving their
            # employee_id NULL forever and crashing the NOT NULL rebuild below.
            # The placeholder lookup already handles company_id being NULL for
            # exactly this case.
            orphaned = conn.execute(
                text(
                    'SELECT pi.id, pr.company_id FROM "payslip_items" pi '
                    'LEFT JOIN "payroll_runs" pr ON pr.id = pi.payroll_run_id '
                    'WHERE pi."employee_id" IS NULL'
                )
            ).fetchall()
            placeholder_by_company = {}
            for item_id, company_id in orphaned:
                if company_id not in placeholder_by_company:
                    existing = conn.execute(
                        text(
                            'SELECT id FROM "employees" WHERE full_name = \'Former Staff\' '
                            'AND (company_id = :company_id OR (:company_id IS NULL AND company_id IS NULL))'
                        ),
                        {"company_id": company_id},
                    ).first()
                    if existing:
                        placeholder_by_company[company_id] = existing[0]
                    else:
                        result = conn.execute(
                            text(
                                'INSERT INTO "employees" (company_id, full_name, base_salary, is_active, created_at) '
                                'VALUES (:company_id, \'Former Staff\', 0, 0, :created_at)'
                            ),
                            {"company_id": company_id, "created_at": datetime.utcnow()},
                        )
                        placeholder_by_company[company_id] = result.lastrowid
                conn.execute(
                    text('UPDATE "payslip_items" SET "employee_id" = :eid WHERE "id" = :item_id'),
                    {"eid": placeholder_by_company[company_id], "item_id": item_id},
                )

        # payslip_items.user_id is superseded by employee_id (backfilled above) —
        # drop the old NOT NULL column so new rows (which only set employee_id)
        # can insert at all. SQLite can't DROP COLUMN a column that's part of a
        # foreign key, so rebuild the table instead (same approach as the sku/
        # users rebuilds elsewhere in this file). No-op once already dropped.
        if inspector.has_table("payslip_items"):
            if "user_id" in payslip_cols:
                payslip_table = Base.metadata.tables["payslip_items"]
                col_names = ", ".join(f'"{c.name}"' for c in payslip_table.columns)
                # Renaming the table doesn't rename its indexes — they'd collide by
                # name with the ones the new table below creates for itself.
                for idx in inspector.get_indexes("payslip_items"):
                    conn.execute(text(f'DROP INDEX IF EXISTS "{idx["name"]}"'))
                conn.execute(text('ALTER TABLE "payslip_items" RENAME TO "payslip_items_old"'))
                payslip_table.create(conn)
                conn.execute(text(f'INSERT INTO "payslip_items" ({col_names}) SELECT {col_names} FROM "payslip_items_old"'))
                conn.execute(text('DROP TABLE "payslip_items_old"'))
