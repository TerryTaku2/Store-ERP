from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./store.db"

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
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing_cols = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_cols:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))

        # products.sku used to be globally unique; it's now unique per-branch instead.
        # Drop the old global unique index left over from before branches existed, and
        # add the new composite one (safe to run every startup; sku was already unique
        # so this never conflicts with existing data).
        if inspector.has_table("products"):
            for idx in inspector.get_indexes("products"):
                if idx["name"] == "ix_products_sku" and idx.get("unique"):
                    conn.execute(text('DROP INDEX IF EXISTS "ix_products_sku"'))
            conn.execute(
                text('CREATE UNIQUE INDEX IF NOT EXISTS "uq_products_branch_sku" ON "products" ("branch_id", "sku")')
            )

        # branches.code used to be globally unique (single-company); it's now unique
        # per-company instead, so every company can have its own "HQ" branch code.
        if inspector.has_table("branches"):
            for idx in inspector.get_indexes("branches"):
                if idx["name"] == "ix_branches_code" and idx.get("unique"):
                    conn.execute(text('DROP INDEX IF EXISTS "ix_branches_code"'))
            conn.execute(
                text('CREATE UNIQUE INDEX IF NOT EXISTS "uq_branches_company_code" ON "branches" ("company_id", "code")')
            )
