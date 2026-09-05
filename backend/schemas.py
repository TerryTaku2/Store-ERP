from datetime import datetime, date
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


# ---------- Companies ----------

class CompanyCreate(BaseModel):
    name: str
    admin_username: str
    admin_full_name: str
    admin_password: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    is_active: bool
    is_demo: bool = False
    created_at: datetime


# ---------- Branches ----------

class BranchBase(BaseModel):
    name: str
    code: str
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool = True


class BranchCreate(BranchBase):
    initial_modules: List[str] = []


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class BranchOut(BranchBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_admin: bool
    created_at: datetime


class BranchModuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    module: str
    enabled: bool


class BranchModulesUpdate(BaseModel):
    modules: dict[str, bool]


class BranchSwitch(BaseModel):
    branch_id: int


# ---------- Auth / Users ----------

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str
    username: str
    company_name: Optional[str] = None
    theme: str = "dark-engineering"
    branch_id: Optional[int] = None
    branch_name: Optional[str] = None
    is_admin_branch: bool = False
    branches: List[BranchOut] = []
    is_platform_admin: bool = False
    is_demo: bool = False


class UserBase(BaseModel):
    username: str
    full_name: str
    role: str = "cashier"
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ThemeUpdate(BaseModel):
    theme: str


# ---------- Products ----------

class ProductBase(BaseModel):
    barcode: Optional[str] = None
    name: str
    category: Optional[str] = None
    unit: Optional[str] = "pcs"
    cost_price: float = 0
    sell_price: float = 0
    reorder_level: float = 0
    parent_product_id: Optional[int] = None
    variant_attributes: Optional[str] = None


class ProductCreate(ProductBase):
    quantity_on_hand: float = 0


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    cost_price: Optional[float] = None
    sell_price: Optional[float] = None
    reorder_level: Optional[float] = None
    quantity_on_hand: Optional[float] = None
    parent_product_id: Optional[int] = None
    variant_attributes: Optional[str] = None


class ProductOut(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    quantity_on_hand: float
    created_at: datetime


class ProductLookupOut(BaseModel):
    match: str  # "branch" | "company" | "none"
    product: Optional[ProductOut] = None


# ---------- Purchases ----------

class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_cost: float


class PurchaseCreate(BaseModel):
    invoice_no: Optional[str] = None
    items: List[PurchaseItemCreate]


class PurchaseItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: float
    unit_cost: float
    subtotal: float
    product: Optional[ProductOut] = None


class PurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    invoice_no: Optional[str]
    total_amount: float
    created_at: datetime
    is_voided: bool = False
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    voided_by_name: Optional[str] = None
    items: List[PurchaseItemOut] = []


class VoidRequest(BaseModel):
    reason: Optional[str] = None


# ---------- Sales ----------

class SaleItemCreate(BaseModel):
    product_id: int
    quantity: float
    unit_price: float


class SaleCreate(BaseModel):
    customer_name: Optional[str] = None
    payment_method: str = "cash"
    invoice_no: Optional[str] = None
    items: List[SaleItemCreate]


class SaleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: float
    unit_price: float
    cost_price_at_sale: float
    subtotal: float
    product: Optional[ProductOut] = None


class SaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    invoice_no: Optional[str]
    customer_name: Optional[str]
    payment_method: str
    total_amount: float
    created_at: datetime
    cashier_name: Optional[str] = None
    is_voided: bool = False
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    voided_by_name: Optional[str] = None
    items: List[SaleItemOut] = []


# ---------- Inventory movements ----------

class StockAdjustmentCreate(BaseModel):
    product_id: int
    quantity_delta: float
    note: Optional[str] = None


class InventoryMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    product_id: int
    movement_type: str
    quantity_delta: float
    balance_after: float
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    note: Optional[str] = None
    created_by_id: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    product: Optional[ProductOut] = None


# ---------- Expenses ----------

class ExpenseBase(BaseModel):
    category: str
    description: Optional[str] = None
    amount: float
    expense_date: date = date.today()


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    expense_date: Optional[date] = None


class ExpenseOut(ExpenseBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    created_at: datetime


# ---------- Audit Log ----------

class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    branch_id: Optional[int] = None
    user_id: Optional[int]
    username: str
    role: Optional[str]
    action: str
    entity_type: str
    entity_id: Optional[int]
    summary: str
    created_at: datetime
