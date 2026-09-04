(function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/inventory.html");

  const canEdit = session.role === "admin" || session.role === "manager";
  let products = [];

  const formPanel = document.getElementById("product-form-panel");
  const form = document.getElementById("product-form");
  const formTitle = document.getElementById("form-title");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const msgBox = document.getElementById("msg-box");
  const parentSelect = document.getElementById("parent_product_id");

  const adjustmentPanel = document.getElementById("adjustment-panel");
  const adjProductSelect = document.getElementById("adj-product");
  const mvProductFilter = document.getElementById("mv-filter-product");

  if (!canEdit) {
    formPanel.classList.add("hidden");
    adjustmentPanel.classList.add("hidden");
  }

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function populateParentSelect(excludeId) {
    parentSelect.innerHTML =
      '<option value="">— standalone product —</option>' +
      products
        .filter((p) => p.id !== excludeId)
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.sku)})</option>`)
        .join("");
  }

  function resetForm() {
    form.reset();
    document.getElementById("product-id").value = "";
    document.getElementById("unit").value = "pcs";
    formTitle.textContent = "Add Product";
    document.getElementById("sku").disabled = false;
    document.getElementById("quantity_on_hand").disabled = false;
    populateParentSelect(null);
    cancelBtn.classList.add("hidden");
  }

  function fillForm(p) {
    document.getElementById("product-id").value = p.id;
    document.getElementById("sku").value = p.sku;
    document.getElementById("sku").disabled = true;
    document.getElementById("barcode").value = p.barcode || "";
    document.getElementById("name").value = p.name;
    document.getElementById("category").value = p.category || "";
    document.getElementById("unit").value = p.unit || "pcs";
    document.getElementById("cost_price").value = p.cost_price;
    document.getElementById("sell_price").value = p.sell_price;
    document.getElementById("quantity_on_hand").value = p.quantity_on_hand;
    document.getElementById("quantity_on_hand").disabled = true;
    document.getElementById("reorder_level").value = p.reorder_level;
    populateParentSelect(p.id);
    parentSelect.value = p.parent_product_id || "";
    document.getElementById("variant_attributes").value = p.variant_attributes || "";
    formTitle.textContent = `Edit Product: ${p.name}`;
    cancelBtn.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function productLabel(p) {
    if (!p.parent_product_id) return escapeHtml(p.name);
    const parent = products.find((x) => x.id === p.parent_product_id);
    const parentName = parent ? parent.name : `#${p.parent_product_id}`;
    return `${escapeHtml(p.name)}<br><span style="color:var(--text-muted);font-size:0.78rem;">Variant of ${escapeHtml(parentName)}${p.variant_attributes ? " — " + escapeHtml(p.variant_attributes) : ""}</span>`;
  }

  function populateProductFilters() {
    const options = products
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.sku)})</option>`)
      .join("");
    if (canEdit) adjProductSelect.innerHTML = options;
    mvProductFilter.innerHTML = '<option value="">All products</option>' + options;
  }

  async function loadProducts() {
    products = await api.get("/products");
    if (canEdit && document.getElementById("product-id").value === "") {
      populateParentSelect(null);
    }
    populateProductFilters();
    const body = document.getElementById("products-body");
    body.innerHTML = "";
    if (products.length === 0) {
      body.innerHTML = '<tr><td colspan="9">No products yet</td></tr>';
      return;
    }
    products.forEach((p) => {
      const lowStock = p.quantity_on_hand <= p.reorder_level;
      const tr = document.createElement("tr");
      if (lowStock) tr.className = "low-stock";
      tr.innerHTML = `
        <td>${escapeHtml(p.sku)}</td>
        <td>${escapeHtml(p.barcode) || "-"}</td>
        <td>${productLabel(p)}</td>
        <td>${escapeHtml(p.category) || "-"}</td>
        <td>${fmtMoney(p.cost_price)}</td>
        <td>${fmtMoney(p.sell_price)}</td>
        <td>${p.quantity_on_hand} ${escapeHtml(p.unit)}${lowStock ? " ⚠" : ""}</td>
        <td>${p.reorder_level}</td>
        <td class="actions-cell">
          ${canEdit ? `<button data-edit="${p.id}" class="secondary">Edit</button>
          <button data-delete="${p.id}" class="danger">Delete</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = products.find((x) => x.id === Number(btn.dataset.edit));
        if (p) fillForm(p);
      })
    );
    body.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this product?")) return;
        try {
          await api.del(`/products/${btn.dataset.delete}`);
          showMsg("Product deleted", "success");
          loadProducts();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  if (canEdit) {
    cancelBtn.addEventListener("click", resetForm);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("product-id").value;
      const parentValue = parentSelect.value ? Number(parentSelect.value) : null;

      try {
        if (id) {
          await api.put(`/products/${id}`, {
            name: document.getElementById("name").value,
            barcode: document.getElementById("barcode").value || null,
            category: document.getElementById("category").value,
            unit: document.getElementById("unit").value,
            cost_price: Number(document.getElementById("cost_price").value),
            sell_price: Number(document.getElementById("sell_price").value),
            reorder_level: Number(document.getElementById("reorder_level").value),
            parent_product_id: parentValue,
            variant_attributes: document.getElementById("variant_attributes").value || null,
          });
          showMsg("Product updated", "success");
        } else {
          await api.post("/products", {
            sku: document.getElementById("sku").value,
            barcode: document.getElementById("barcode").value || null,
            name: document.getElementById("name").value,
            category: document.getElementById("category").value,
            unit: document.getElementById("unit").value,
            cost_price: Number(document.getElementById("cost_price").value),
            sell_price: Number(document.getElementById("sell_price").value),
            quantity_on_hand: Number(document.getElementById("quantity_on_hand").value),
            reorder_level: Number(document.getElementById("reorder_level").value),
            parent_product_id: parentValue,
            variant_attributes: document.getElementById("variant_attributes").value || null,
          });
          showMsg("Product created", "success");
        }
        resetForm();
        loadProducts();
      } catch (err) {
        showMsg(err.message, "error");
      }
    });
  }

  let lastMovements = [];

  function movementRefLabel(m) {
    if (!m.reference_type) return "-";
    if (m.reference_type === "manual") return "manual";
    return `${m.reference_type} #${m.reference_id}`;
  }

  async function loadMovements() {
    const productId = document.getElementById("mv-filter-product").value;
    const type = document.getElementById("mv-filter-type").value;
    const start = document.getElementById("mv-start-date").value;
    const end = document.getElementById("mv-end-date").value;
    const params = new URLSearchParams();
    if (productId) params.set("product_id", productId);
    if (type) params.set("movement_type", type);
    if (start) params.set("start_date", start);
    if (end) params.set("end_date", end);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const movements = await api.get(`/inventory/movements${qs}`);
    lastMovements = movements;
    const body = document.getElementById("movements-body");
    body.innerHTML = "";
    if (movements.length === 0) {
      body.innerHTML = '<tr><td colspan="8">No stock movements found</td></tr>';
      return;
    }
    movements.forEach((m) => {
      const tr = document.createElement("tr");
      const sign = m.quantity_delta > 0 ? "+" : "";
      tr.innerHTML = `
        <td>${fmtDate(m.created_at)}</td>
        <td>${m.product ? `${escapeHtml(m.product.name)} (${escapeHtml(m.product.sku)})` : `#${m.product_id}`}</td>
        <td>${escapeHtml(m.movement_type)}</td>
        <td>${sign}${m.quantity_delta}</td>
        <td>${m.balance_after}</td>
        <td>${escapeHtml(movementRefLabel(m))}</td>
        <td>${escapeHtml(m.note) || "-"}</td>
        <td>${escapeHtml(m.created_by_name) || "-"}</td>
      `;
      body.appendChild(tr);
    });
  }

  document.getElementById("mv-filter-btn").addEventListener("click", () => {
    loadMovements().catch((err) => showMsg(err.message, "error"));
  });

  document.getElementById("export-movements-btn").addEventListener("click", () => {
    exportCSV(
      "stock-movements.csv",
      [
        { key: "created_at", label: "Date" },
        { key: "movement_type", label: "Type" },
        { key: "quantity_delta", label: "Change" },
        { key: "balance_after", label: "Balance After" },
        { key: "note", label: "Note" },
      ],
      lastMovements.map((m) => ({
        created_at: fmtDate(m.created_at),
        movement_type: m.movement_type,
        quantity_delta: m.quantity_delta,
        balance_after: m.balance_after,
        note: m.note || "",
      }))
    );
  });

  if (canEdit) {
    document.getElementById("adjustment-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.post("/inventory/adjustments", {
          product_id: Number(adjProductSelect.value),
          quantity_delta: Number(document.getElementById("adj-quantity").value),
          note: document.getElementById("adj-note").value || null,
        });
        showMsg("Stock adjustment recorded", "success");
        document.getElementById("adjustment-form").reset();
        loadProducts();
        loadMovements();
      } catch (err) {
        showMsg(err.message, "error");
      }
    });
  }

  document.getElementById("export-products-btn").addEventListener("click", () => {
    exportCSV(
      "products.csv",
      [
        { key: "sku", label: "SKU" },
        { key: "barcode", label: "Barcode" },
        { key: "name", label: "Name" },
        { key: "category", label: "Category" },
        { key: "unit", label: "Unit" },
        { key: "cost_price", label: "Cost Price" },
        { key: "sell_price", label: "Sell Price" },
        { key: "quantity_on_hand", label: "Qty on Hand" },
        { key: "reorder_level", label: "Reorder Level" },
        { key: "variant_attributes", label: "Variant Attributes" },
      ],
      products
    );
  });

  loadProducts().catch((err) => showMsg(err.message, "error"));
  loadMovements().catch((err) => showMsg(err.message, "error"));
})();
