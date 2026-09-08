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
