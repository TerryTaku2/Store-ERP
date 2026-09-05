(function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/inventory.html");

  const canEdit = session.role === "admin" || session.role === "manager";
  let products = [];
  let activeCategory = "__all__";
  let activeStatus = "__all__";
  const selectedIds = new Set();

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
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join("");
  }

  function resetForm() {
    form.reset();
    document.getElementById("product-id").value = "";
    document.getElementById("unit").value = "pcs";
    formTitle.textContent = "Add Product";
    document.getElementById("quantity_on_hand").disabled = false;
    populateParentSelect(null);
    cancelBtn.classList.add("hidden");
  }

  function fillForm(p) {
    document.getElementById("product-id").value = p.id;
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
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join("");
    if (canEdit) adjProductSelect.innerHTML = options;
    mvProductFilter.innerHTML = '<option value="">All products</option>' + options;
  }

  function matchesSearch(p, term) {
    if (!term) return true;
    return [p.name, p.barcode, p.category].some(
      (field) => field && field.toLowerCase().includes(term)
    );
  }

  function categoryOf(p) {
    return p.category && p.category.trim() ? p.category.trim() : "Uncategorized";
  }

  function matchesFilters(p) {
    if (activeCategory !== "__all__" && categoryOf(p) !== activeCategory) return false;
    if (activeStatus !== "__all__" && stockSeverity(p.quantity_on_hand, p.reorder_level) !== activeStatus) return false;
    return true;
  }

  // ---------- Left filter panel: categories + stock status ----------

  function renderFilterLists() {
    const categoryCounts = new Map();
    const statusCounts = { healthy: 0, warn: 0, critical: 0 };
    products.forEach((p) => {
      const cat = categoryOf(p);
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      statusCounts[stockSeverity(p.quantity_on_hand, p.reorder_level)]++;
    });

    const categoryList = document.getElementById("category-filter-list");
    const categoryItems = [{ key: "__all__", label: "All Products", count: products.length }].concat(
      Array.from(categoryCounts.keys())
        .sort((a, b) => a.localeCompare(b))
        .map((cat) => ({ key: cat, label: cat, count: categoryCounts.get(cat) }))
    );
    categoryList.innerHTML = categoryItems
      .map(
        (item) => `
          <button type="button" class="filter-item ${activeCategory === item.key ? "active" : ""}" data-category="${escapeHtml(item.key)}">
            ${escapeHtml(item.label)}<span class="count">${item.count}</span>
          </button>`
      )
      .join("");
    categoryList.querySelectorAll("[data-category]").forEach((btn) =>
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.category;
        renderFilterLists();
        renderProductsTable();
      })
    );

    const statusList = document.getElementById("status-filter-list");
    const statusItems = [
      { key: "__all__", label: "All Products", count: products.length },
      { key: "healthy", label: "Healthy", count: statusCounts.healthy },
      { key: "warn", label: "Low Stock", count: statusCounts.warn },
      { key: "critical", label: "Critical", count: statusCounts.critical },
    ];
    statusList.innerHTML = statusItems
      .map(
        (item) => `
          <button type="button" class="filter-item ${activeStatus === item.key ? "active" : ""}" data-status="${item.key}">
            ${escapeHtml(item.label)}<span class="count">${item.count}</span>
          </button>`
      )
      .join("");
    statusList.querySelectorAll("[data-status]").forEach((btn) =>
      btn.addEventListener("click", () => {
        activeStatus = btn.dataset.status;
        renderFilterLists();
        renderProductsTable();
      })
    );
  }

  // ---------- Inline cell editing (sell price / cost price / reorder level) ----------
  // Quantity on hand is intentionally never inline-editable here — the app
  // requires stock changes to go through Adjust Stock so every change leaves
  // an audited inventory movement record (see fillForm, which disables it too).

  function money(n) {
    return Number(n).toFixed(2);
  }

  function renderEditableCell(product, field, formatter) {
    if (!canEdit) return formatter(product[field]);
    return `<button type="button" class="cell-edit-btn" data-field="${field}" data-id="${product.id}">${formatter(product[field])}</button>`;
  }

  async function saveInlineEdit(td, product, field, rawValue) {
    const value = Number(rawValue);
    if (isNaN(value) || value < 0) {
      showMsg("Enter a valid non-negative number", "error");
      renderProductsTable();
      return;
    }
    if (value === product[field]) {
      renderProductsTable();
      return;
    }
    try {
      const payload = {};
      payload[field] = value;
      const updated = await api.put(`/products/${product.id}`, payload);
      const idx = products.findIndex((p) => p.id === product.id);
      if (idx !== -1) products[idx] = updated;
      showMsg("Product updated", "success");
    } catch (err) {
      showMsg(err.message, "error");
    }
    renderFilterLists();
    renderProductsTable();
  }

  function activateInlineEdit(btn) {
    const id = Number(btn.dataset.id);
    const field = btn.dataset.field;
    const product = products.find((p) => p.id === id);
    if (!product) return;
    const td = btn.closest("td");
    const input = document.createElement("input");
    input.className = "cell-edit";
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.value = product[field];
    td.innerHTML = "";
    td.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      saveInlineEdit(td, product, field, input.value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        settled = true;
        renderProductsTable();
      }
    });
    input.addEventListener("blur", commit);
  }

  // ---------- Selection + floating bulk-action bar ----------

  function renderBulkBar() {
    const bar = document.getElementById("bulk-action-bar");
    bar.classList.toggle("hidden", selectedIds.size === 0);
    document.getElementById("selection-count").textContent = selectedIds.size;
    document.getElementById("selection-text").textContent =
      `${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"} selected`;
  }

  function toggleSelection(id, checked) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    const row = document.querySelector(`tr[data-row-id="${id}"]`);
    if (row) row.classList.toggle("selected", checked);
    renderBulkBar();
  }

  document.getElementById("clear-selection-btn").addEventListener("click", () => {
    selectedIds.clear();
    renderProductsTable();
  });

  document.getElementById("select-all-products").addEventListener("change", (e) => {
    const term = document.getElementById("product-search").value.trim().toLowerCase();
    const visible = products.filter((p) => matchesSearch(p, term) && matchesFilters(p));
    visible.forEach((p) => (e.target.checked ? selectedIds.add(p.id) : selectedIds.delete(p.id)));
    renderProductsTable();
  });

  // ---------- Main products grid ----------

  function renderProductsTable() {
    const term = document.getElementById("product-search").value.trim().toLowerCase();
    const filtered = products.filter((p) => matchesSearch(p, term) && matchesFilters(p));

    document.getElementById("products-count-label").textContent = `${filtered.length} Product${filtered.length === 1 ? "" : "s"}`;

    const body = document.getElementById("products-body");
    body.innerHTML = "";
    if (products.length === 0) {
      body.innerHTML = '<tr><td colspan="10">No products yet</td></tr>';
      renderBulkBar();
      return;
    }
    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="9">No products match your filters</td></tr>';
      renderBulkBar();
      return;
    }

    filtered.forEach((p) => {
      const severity = stockSeverity(p.quantity_on_hand, p.reorder_level);
      const selected = selectedIds.has(p.id);
      const tr = document.createElement("tr");
      tr.dataset.rowId = p.id;
      if (selected) tr.classList.add("selected");
      tr.innerHTML = `
        <td><input type="checkbox" data-select="${p.id}" ${selected ? "checked" : ""} /></td>
        <td class="prod-name">${productLabel(p)}</td>
        <td><span class="cat-pill">${escapeHtml(categoryOf(p))}</span></td>
        <td>${escapeHtml(p.unit) || "-"}</td>
        <td>${renderEditableCell(p, "cost_price", money)}</td>
        <td>${renderEditableCell(p, "sell_price", money)}</td>
        <td><span class="qty-cell ${severity}">${p.quantity_on_hand}</span></td>
        <td>${renderEditableCell(p, "reorder_level", (v) => String(v))}</td>
        <td class="actions-cell">
          ${canEdit ? `<button data-edit="${p.id}" class="secondary">Edit</button>
          <button data-delete="${p.id}" class="danger">Delete</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-select]").forEach((cb) =>
      cb.addEventListener("change", () => toggleSelection(Number(cb.dataset.select), cb.checked))
    );
    body.querySelectorAll(".cell-edit-btn").forEach((btn) =>
      btn.addEventListener("click", () => activateInlineEdit(btn))
    );
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
          selectedIds.delete(Number(btn.dataset.delete));
          loadProducts();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );

    document.getElementById("select-all-products").checked =
      filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
    renderBulkBar();
  }

  async function loadProducts() {
    products = await api.get("/products");
    if (canEdit && document.getElementById("product-id").value === "") {
      populateParentSelect(null);
    }
    populateProductFilters();
    renderFilterLists();
    renderProductsTable();
  }

  document.getElementById("product-search").addEventListener("input", renderProductsTable);

  async function handleBarcodeScan(code) {
    if (!code) return;
    const barcodeInput = document.getElementById("barcode");
    barcodeInput.value = code;
    if (document.getElementById("product-id").value) return; // editing an existing product — just set the barcode

    try {
      const result = await api.get(`/products/lookup/${encodeURIComponent(code)}`);
      if (result.match === "branch") {
        fillForm(result.product);
        showMsg(`'${escapeHtml(result.product.name)}' already exists in this branch — editing it instead`, "success");
      } else if (result.match === "company") {
        const p = result.product;
        document.getElementById("name").value = p.name;
        document.getElementById("category").value = p.category || "";
        document.getElementById("unit").value = p.unit || "pcs";
        document.getElementById("cost_price").value = p.cost_price;
        document.getElementById("sell_price").value = p.sell_price;
        document.getElementById("reorder_level").value = p.reorder_level;
        showMsg(`Filled details from '${escapeHtml(p.name)}' in another branch — review before saving`, "success");
      } else {
        showMsg("New barcode — enter the product details", "success");
      }
    } catch (err) {
      showMsg(err.message, "error");
    }
  }

  if (canEdit) {
    cancelBtn.addEventListener("click", resetForm);

    document.getElementById("barcode").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      handleBarcodeScan(e.target.value.trim());
    });

    document.getElementById("scan-barcode-btn").addEventListener("click", () => {
      openCameraScanner((code) => handleBarcodeScan(code));
    });

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
        <td>${m.product ? escapeHtml(m.product.name) : `#${m.product_id}`}</td>
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

  const PRODUCT_CSV_COLUMNS = [
    { key: "barcode", label: "Barcode" },
    { key: "name", label: "Name" },
    { key: "category", label: "Category" },
    { key: "unit", label: "Unit" },
    { key: "cost_price", label: "Cost Price" },
    { key: "sell_price", label: "Sell Price" },
    { key: "quantity_on_hand", label: "Qty on Hand" },
    { key: "reorder_level", label: "Reorder Level" },
    { key: "variant_attributes", label: "Variant Attributes" },
  ];

  document.getElementById("export-products-btn").addEventListener("click", () => {
    exportCSV("products.csv", PRODUCT_CSV_COLUMNS, products);
  });

  // ---------- Bulk actions (Export / Print Labels / Bulk Edit) ----------

  document.getElementById("bulk-export-btn").addEventListener("click", () => {
    exportCSV("products-selected.csv", PRODUCT_CSV_COLUMNS, products.filter((p) => selectedIds.has(p.id)));
  });

  document.getElementById("print-labels-btn").addEventListener("click", () => {
    const selected = products.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return;
    document.getElementById("print-labels-sheet").innerHTML = selected
      .map(
        (p) => `
          <div class="label">
            <div class="label-name">${escapeHtml(p.name)}</div>
            ${p.barcode ? `<div class="label-barcode">${escapeHtml(p.barcode)}</div>` : ""}
            <div class="label-price">${fmtMoney(p.sell_price)}</div>
          </div>`
      )
      .join("");
    document.body.classList.add("printing-labels");
    window.print();
  });

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-labels");
  });

  const bulkEditModal = document.getElementById("bulk-edit-modal");
  document.getElementById("bulk-edit-btn").addEventListener("click", () => {
    document.getElementById("bulk-edit-count").textContent = `(${selectedIds.size} product${selectedIds.size === 1 ? "" : "s"})`;
    document.getElementById("bulk-edit-form").reset();
    bulkEditModal.classList.remove("hidden");
  });
  document.getElementById("bulk-edit-close").addEventListener("click", () => bulkEditModal.classList.add("hidden"));

  document.getElementById("bulk-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const category = document.getElementById("bulk-edit-category").value.trim();
    const reorderRaw = document.getElementById("bulk-edit-reorder").value;
    const payload = {};
    if (category) payload.category = category;
    if (reorderRaw !== "") payload.reorder_level = Number(reorderRaw);

    if (Object.keys(payload).length === 0) {
      showMsg("Enter at least one field to apply", "error");
      return;
    }

    const ids = Array.from(selectedIds);
    let failed = 0;
    for (const id of ids) {
      try {
        await api.put(`/products/${id}`, payload);
      } catch (err) {
        failed++;
      }
    }
    bulkEditModal.classList.add("hidden");
    showMsg(
      failed === 0 ? `Updated ${ids.length} product${ids.length === 1 ? "" : "s"}` : `Updated ${ids.length - failed} product(s), ${failed} failed`,
      failed === 0 ? "success" : "error"
    );
    loadProducts();
  });

  loadProducts().catch((err) => showMsg(err.message, "error"));
  loadMovements().catch((err) => showMsg(err.message, "error"));
})();
