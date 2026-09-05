(function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/sales.html");

  document.getElementById("pos-subtitle").textContent =
    `${session.branchName || "Branch"} · ${session.fullName || session.username}`;

  let products = [];
  let cart = []; // { product_id, name, quantity, unit_price }
  let activeCategory = "__all__";
  let searchTerm = "";
  let paymentMethod = "cash";

  const SWATCH_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#d946ef", "#6366f1", "#0ea5e9", "#f43f5e", "#10b981"];
  const categoryColor = new Map();

  const TENDER_OPTIONS = [
    { value: "cash", label: "Cash" },
    { value: "card", label: "Card" },
    { value: "mobile_money", label: "Mobile Money" },
    { value: "credit", label: "Credit" },
  ];

  const msgBox = document.getElementById("msg-box");
  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function categoryOf(p) {
    return p.category && p.category.trim() ? p.category.trim() : "Uncategorized";
  }

  function swatchFor(category) {
    if (!categoryColor.has(category)) {
      categoryColor.set(category, SWATCH_COLORS[categoryColor.size % SWATCH_COLORS.length]);
    }
    return categoryColor.get(category);
  }

  function initialsOf(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  // ---------- Category pills ----------

  function renderCategoryPills() {
    const categories = Array.from(new Set(products.map(categoryOf))).sort((a, b) => a.localeCompare(b));
    const items = [{ key: "__all__", label: "All" }].concat(categories.map((c) => ({ key: c, label: c })));
    document.getElementById("category-pills").innerHTML = items
      .map((item) => `<button type="button" class="pos-pill ${activeCategory === item.key ? "active" : ""}" data-cat="${escapeHtml(item.key)}">${escapeHtml(item.label)}</button>`)
      .join("");
    document.querySelectorAll("[data-cat]").forEach((btn) =>
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.cat;
        renderCategoryPills();
        renderTileGrid();
      })
    );
  }

  // ---------- Product tile grid ----------

  function renderTileGrid() {
    const term = searchTerm.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (activeCategory !== "__all__" && categoryOf(p) !== activeCategory) return false;
      if (!term) return true;
      return [p.name, p.barcode].some((f) => f && f.toLowerCase().includes(term));
    });

    const grid = document.getElementById("tile-grid");
    if (filtered.length === 0) {
      grid.innerHTML = `<div class="card-sub" style="padding:20px;">No products match</div>`;
      return;
    }

    grid.innerHTML = filtered
      .map((p) => {
        const line = cart.find((c) => c.product_id === p.id);
        const outOfStock = p.quantity_on_hand <= 0;
        return `
          <button type="button" class="tile" data-add="${p.id}" ${outOfStock ? "disabled" : ""}>
            ${line ? `<span class="tile-qty-badge">×${line.quantity}</span>` : ""}
            <span class="swatch" style="background:${swatchFor(categoryOf(p))};">${escapeHtml(initialsOf(p.name))}</span>
            <span class="tile-name">${escapeHtml(p.name)}</span>
            <span class="tile-price">${outOfStock ? "Out of stock" : fmtMoney(p.sell_price)}</span>
          </button>`;
      })
      .join("");

    grid.querySelectorAll("[data-add]").forEach((btn) =>
      btn.addEventListener("click", () => addToCart(Number(btn.dataset.add)))
    );
  }

  async function loadProducts() {
    products = await api.get("/products");
    renderCategoryPills();
    renderTileGrid();
  }

  // ---------- Cart ----------

  function addToCart(productId, qtyDelta = 1) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const existing = cart.find((c) => c.product_id === productId);
    if (existing) {
      existing.quantity += qtyDelta;
    } else {
      cart.push({ product_id: productId, name: product.name, quantity: qtyDelta, unit_price: product.sell_price });
    }
    renderCart();
    renderTileGrid();
  }

  async function addByBarcode(code) {
    if (!code) return;
    try {
      const product = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      addToCart(product.id);
      showMsg(`Added '${escapeHtml(product.name)}' to cart`, "success");
    } catch (err) {
      showMsg(err.message, "error");
    }
  }

  const barcodeInput = document.getElementById("barcode-input");
  barcodeInput.addEventListener("input", () => {
    searchTerm = barcodeInput.value;
    renderTileGrid();
  });
  barcodeInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = barcodeInput.value.trim();
    barcodeInput.value = "";
    searchTerm = "";
    addByBarcode(code);
  });

  document.getElementById("camera-scan-btn").addEventListener("click", () => {
    openCameraScanner((code) => addByBarcode(code));
  });

  function changeQty(idx, delta) {
    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) cart.splice(idx, 1);
    renderCart();
    renderTileGrid();
  }

  function removeLine(idx) {
    cart.splice(idx, 1);
    renderCart();
    renderTileGrid();
  }

  function activatePriceEdit(btn) {
    const idx = Number(btn.dataset.priceIdx);
    const line = cart[idx];
    const wrap = btn.parentElement;
    const input = document.createElement("input");
    input.className = "cell-edit";
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.value = line.unit_price;
    input.style.width = "64px";
    wrap.innerHTML = "";
    wrap.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      const value = Number(input.value);
      if (!isNaN(value) && value >= 0) line.unit_price = value;
      renderCart();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { settled = true; renderCart(); }
    });
    input.addEventListener("blur", commit);
  }

  function renderCart() {
    const container = document.getElementById("cart-items");
    if (cart.length === 0) {
      container.innerHTML = `<div class="card-sub" style="padding:16px 0;">Tap a product to add it to the sale</div>`;
    } else {
      container.innerHTML = cart
        .map((line, idx) => {
          const product = products.find((p) => p.id === line.product_id);
          const cat = product ? categoryOf(product) : "";
          const subtotal = line.quantity * line.unit_price;
          return `
            <div class="cart-line">
              <span class="swatch" style="background:${swatchFor(cat)};width:34px;height:34px;font-size:11px;">${escapeHtml(initialsOf(line.name))}</span>
              <div class="cart-line-info">
                <div class="cart-line-name">${escapeHtml(line.name)}</div>
                <div class="cart-line-price"><button type="button" class="cell-edit-btn" data-price-idx="${idx}" style="padding:0;border:none;color:var(--text-muted);font-size:11.5px;">${fmtMoney(line.unit_price)} each</button></div>
              </div>
              <div class="stepper">
                <button type="button" data-qty-down="${idx}">−</button>
                <span>${line.quantity}</span>
                <button type="button" data-qty-up="${idx}">+</button>
              </div>
              <div class="cart-line-sub">${fmtMoney(subtotal)}</div>
              <button type="button" class="cart-line-remove" data-remove="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>`;
        })
        .join("");
    }

    const total = cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
    document.getElementById("cart-total").textContent = fmtMoney(total);

    container.querySelectorAll("[data-qty-down]").forEach((btn) => btn.addEventListener("click", () => changeQty(Number(btn.dataset.qtyDown), -1)));
    container.querySelectorAll("[data-qty-up]").forEach((btn) => btn.addEventListener("click", () => changeQty(Number(btn.dataset.qtyUp), 1)));
    container.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", () => removeLine(Number(btn.dataset.remove))));
    container.querySelectorAll(".cell-edit-btn").forEach((btn) => btn.addEventListener("click", () => activatePriceEdit(btn)));
  }

  // ---------- Tender selection ----------

  function renderTenderRow() {
    document.getElementById("tender-row").innerHTML = TENDER_OPTIONS
      .map(
        (opt) => `
        <button type="button" class="tender-btn ${paymentMethod === opt.value ? "selected" : ""}" data-tender="${opt.value}">${escapeHtml(opt.label)}</button>`
      )
      .join("");
    document.querySelectorAll("[data-tender]").forEach((btn) =>
      btn.addEventListener("click", () => {
        paymentMethod = btn.dataset.tender;
        renderTenderRow();
      })
    );
  }
  renderTenderRow();

  document.getElementById("submit-sale-btn").addEventListener("click", async () => {
    if (cart.length === 0) return showMsg("Add at least one item to the sale", "error");
    try {
      const sale = await api.post("/sales", {
        customer_name: document.getElementById("customer_name").value || null,
        payment_method: paymentMethod,
        items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, unit_price: c.unit_price })),
      });
      showMsg("Sale completed", "success");
      document.getElementById("last-sale-box").innerHTML =
        `<p><a href="/receipt.html?sale_id=${sale.id}" target="_blank">View / Print Receipt for Sale #${sale.id}</a></p>`;
      cart = [];
      renderCart();
      document.getElementById("customer_name").value = "";
      await Promise.all([loadProducts(), loadSales()]);
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  // ---------- Recent sales table (unchanged behavior) ----------

  let lastSales = [];
  let salesOffset = 0;
  let hasMoreSales = false;
  const SALES_PAGE_SIZE = 50;

  const canVoid = session.role === "admin" || session.role === "manager";

  function renderSalesTable() {
    const body = document.getElementById("sales-body");
    body.innerHTML = "";
    document.getElementById("load-more-sales-btn").classList.toggle("hidden", !hasMoreSales);
    if (lastSales.length === 0) {
      body.innerHTML = '<tr><td colspan="7">No sales yet</td></tr>';
      return;
    }
    lastSales.forEach((s) => {
      const tr = document.createElement("tr");
      if (s.is_voided) tr.style.opacity = "0.55";
      tr.innerHTML = `
        <td>${escapeHtml(s.invoice_no) || "#" + s.id}</td>
        <td>${escapeHtml(s.customer_name) || "-"}</td>
        <td>${escapeHtml(s.payment_method)}</td>
        <td>${fmtMoney(s.total_amount)}</td>
        <td>${fmtDate(s.created_at)}</td>
        <td>${s.is_voided ? '<span class="badge voided">Voided</span>' : '<span class="badge active">Completed</span>'}</td>
        <td class="actions-cell">
          <a href="/receipt.html?sale_id=${s.id}" target="_blank">Receipt</a>
          ${canVoid && !s.is_voided ? `<button data-void="${s.id}" class="danger">Void</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-void]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("Void this sale — reason (optional), Cancel to abort:");
        if (reason === null) return;
        try {
          await api.post(`/sales/${btn.dataset.void}/void`, { reason: reason || null });
          showMsg("Sale voided", "success");
          await Promise.all([loadProducts(), loadSales()]);
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  async function loadSales() {
    const page = await api.get(`/sales?limit=${SALES_PAGE_SIZE}&offset=0`);
    lastSales = page;
    salesOffset = page.length;
    hasMoreSales = page.length === SALES_PAGE_SIZE;
    renderSalesTable();
  }

  async function loadMoreSales() {
    const page = await api.get(`/sales?limit=${SALES_PAGE_SIZE}&offset=${salesOffset}`);
    lastSales = lastSales.concat(page);
    salesOffset += page.length;
    hasMoreSales = page.length === SALES_PAGE_SIZE;
    renderSalesTable();
  }

  document.getElementById("load-more-sales-btn").addEventListener("click", () => {
    loadMoreSales().catch((err) => showMsg(err.message, "error"));
  });

  async function fetchAllSales() {
    let all = [];
    let off = 0;
    while (true) {
      const page = await api.get(`/sales?limit=200&offset=${off}`);
      all = all.concat(page);
      if (page.length < 200) break;
      off += page.length;
    }
    return all;
  }

  document.getElementById("export-sales-btn").addEventListener("click", async () => {
    try {
      const all = await fetchAllSales();
      exportCSV(
        "sales.csv",
        [
          { key: "id", label: "Invoice #" },
          { key: "customer_name", label: "Customer" },
          { key: "payment_method", label: "Payment Method" },
          { key: "total_amount", label: "Total" },
          { key: "created_at", label: "Date" },
        ],
        all
      );
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  renderCart();
  Promise.all([loadProducts(), loadSales()]).catch((err) => showMsg(err.message, "error"));
})();
