from datetime import datetime, date

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    Date,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


# Modules that can be individually enabled/disabled per branch by the administration
# branch. Products/Inventory are always-on core functionality and not in this list.
TOGGLE_MODULES = ["sales", "purchases", "expenses", "reports"]

# UI theme a user can pick for themselves, saved to their account (see auth.py's
# PUT /auth/me/theme). Kept as an allowlist so an arbitrary string can never end
# up in the theme column.
VALID_THEMES = ["dark-engineering", "warm-minimal", "high-contrast"]


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    name = Column(String, nullable=False)
    code = Column(String, index=True, nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    address = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class BranchModule(Base):
    __tablename__ = "branch_modules"
    __table_args__ = (UniqueConstraint("branch_id", "module", name="uq_branch_module"),)

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    module = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)

    branch = relationship("Branch")


class UserBranch(Base):
    __tablename__ = "user_branches"
    __table_args__ = (UniqueConstraint("user_id", "branch_id", name="uq_user_branch"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)

    user = relationship("User")
    branch = relationship("Branch")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False, default="cashier")  # admin, manager, cashier
    is_active = Column(Boolean, default=True)
    is_platform_admin = Column(Boolean, nullable=False, default=False)
    failed_login_attempts = Column(Integer, nullable=True, default=0)
    locked_until = Column(DateTime, nullable=True)
    theme = Column(String, nullable=True, default="dark-engineering")
    created_at = Column(DateTime, default=datetime.utcnow)


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    sku = Column(String, index=True, nullable=False)
    barcode = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    unit = Column(String, nullable=True, default="pcs")
    cost_price = Column(Float, nullable=False, default=0)
    sell_price = Column(Float, nullable=False, default=0)
    quantity_on_hand = Column(Float, nullable=False, default=0)
    reorder_level = Column(Float, nullable=False, default=0)
    parent_product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    variant_attributes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Purchase(Base):
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    invoice_no = Column(String, nullable=True)
    total_amount = Column(Float, nullable=False, default=0)
    recorded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_voided = Column(Boolean, nullable=False, default=False)
    voided_at = Column(DateTime, nullable=True)
    voided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    void_reason = Column(String, nullable=True)

    items = relationship(
        "PurchaseItem", back_populates="purchase", cascade="all, delete-orphan"
    )
    recorded_by = relationship("User", foreign_keys=[recorded_by_id])
    voided_by = relationship("User", foreign_keys=[voided_by_id])

    @property
    def voided_by_name(self):
        return self.voided_by.full_name if self.voided_by else None


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False)
    subtotal = Column(Float, nullable=False)

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    invoice_no = Column(String, nullable=True)
    cashier_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    customer_name = Column(String, nullable=True)
    payment_method = Column(String, nullable=False, default="cash")
    total_amount = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_voided = Column(Boolean, nullable=False, default=False)
    voided_at = Column(DateTime, nullable=True)
    voided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    void_reason = Column(String, nullable=True)

    items = relationship(
        "SaleItem", back_populates="sale", cascade="all, delete-orphan"
    )
    cashier = relationship("User", foreign_keys=[cashier_id])
    voided_by = relationship("User", foreign_keys=[voided_by_id])

    @property
    def cashier_name(self):
        return self.cashier.full_name if self.cashier else None

    @property
    def voided_by_name(self):
        return self.voided_by.full_name if self.voided_by else None


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False)
    cost_price_at_sale = Column(Float, nullable=False, default=0)
    subtotal = Column(Float, nullable=False)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    category = Column(String, nullable=False)
    description = Column(String, nullable=True)
    amount = Column(Float, nullable=False)
    expense_date = Column(Date, nullable=False, default=date.today)
    recorded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    recorded_by = relationship("User")


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    movement_type = Column(String, nullable=False)  # purchase, sale, adjustment
    quantity_delta = Column(Float, nullable=False)  # positive = stock in, negative = stock out
    balance_after = Column(Float, nullable=False)
    reference_type = Column(String, nullable=True)  # purchase, sale, manual
    reference_id = Column(Integer, nullable=True)
    note = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")
    created_by = relationship("User")

    @property
    def created_by_name(self):
        return self.created_by.full_name if self.created_by else None


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=False)
    role = Column(String, nullable=True)
    action = Column(String, nullable=False)  # create, update, delete, login, login_failed
    entity_type = Column(String, nullable=False)  # product, supplier, expense, user, purchase, sale, auth
    entity_id = Column(Integer, nullable=True)
    summary = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
