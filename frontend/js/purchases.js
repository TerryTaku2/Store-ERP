(function () {
  const session = requireRole("admin", "manager");
  if (!session) return;
  renderSidebar("/purchases.html");

  let products = [];
  let cart = [];

  const msgBox = document.getElementById("msg-box");
  const productSelect = document.getElementById("line-product");
  const costInput = document.getElementById("line-cost");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  async function loadProducts() {
    products = await api.get("/products");
    productSelect.innerHTML = products
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.sku)})</option>`)
      .join("");
    if (products.length > 0) costInput.value = products[0].cost_price;
  }

  productSelect.addEventListener("change", () => {
    const p = products.find((x) => x.id === Number(productSelect.value));
    if (p) costInput.value = p.cost_price;
  });

  async function addByBarcode(code) {
    if (!code) return;
    try {
      const product = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      cart.push({ product_id: product.id, name: product.name, quantity: 1, unit_cost: product.cost_price });
      renderCart();
      showMsg(`Added '${escapeHtml(product.name)}' to cart`, "success");
    } catch (err) {
      showMsg(err.message, "error");
    }
  }

  const barcodeInput = document.getElementById("barcode-input");
  barcodeInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = barcodeInput.value.trim();
    barcodeInput.value = "";
    addByBarcode(code);
  });

  document.getElementById("camera-scan-btn").addEventListener("click", () => {
    openCameraScanner((code) => addByBarcode(code));
  });

  function renderCart() {
    const body = document.getElementById("cart-body");
    body.innerHTML = "";
    let total = 0;
    cart.forEach((line, idx) => {
      const subtotal = line.quantity * line.unit_cost;
      total += subtotal;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(line.name)}</td>
        <td>${line.quantity}</td>
        <td>${fmtMoney(line.unit_cost)}</td>
        <td>${fmtMoney(subtotal)}</td>
        <td><button data-remove="${idx}" class="danger">Remove</button></td>
      `;
      body.appendChild(tr);
    });
    document.getElementById("cart-total").textContent = fmtMoney(total);

    body.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", () => {
        cart.splice(Number(btn.dataset.remove), 1);
        renderCart();
      })
    );
  }

  document.getElementById("add-line-btn").addEventListener("click", () => {
    const productId = Number(productSelect.value);
    const product = products.find((p) => p.id === productId);
    const qty = Number(document.getElementById("line-qty").value);
    const cost = Number(costInput.value);

    if (!product) return showMsg("Select a product", "error");
    if (!qty || qty <= 0) return showMsg("Enter a valid quantity", "error");

    cart.push({ product_id: productId, name: product.name, quantity: qty, unit_cost: cost });
    renderCart();
  });

  document.getElementById("submit-purchase-btn").addEventListener("click", async () => {
    if (cart.length === 0) return showMsg("Add at least one item to the purchase", "error");
    try {
      await api.post("/purchases", {
        invoice_no: document.getElementById("purchase-invoice").value || null,
        items: cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity, unit_cost: c.unit_cost })),
      });
      showMsg("Purchase recorded", "success");
      cart = [];
      renderCart();
      document.getElementById("purchase-invoice").value = "";
      await Promise.all([loadProducts(), loadPurchases()]);
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  let lastPurchases = [];
  let purchasesOffset = 0;
  let hasMorePurchases = false;
  const PURCHASES_PAGE_SIZE = 50;

  function renderPurchasesTable() {
    const body = document.getElementById("purchases-body");
    body.innerHTML = "";
    document.getElementById("load-more-purchases-btn").classList.toggle("hidden", !hasMorePurchases);
    if (lastPurchases.length === 0) {
      body.innerHTML = '<tr><td colspan="6">No purchases yet</td></tr>';
      return;
    }
    lastPurchases.forEach((p) => {
      const itemsSummary = p.items.map((i) => `${escapeHtml(i.product?.name) || "?"} x${i.quantity}`).join(", ");
      const tr = document.createElement("tr");
      if (p.is_voided) tr.style.opacity = "0.55";
      tr.innerHTML = `
        <td>${escapeHtml(p.invoice_no) || "#" + p.id}</td>
        <td>${itemsSummary}</td>
        <td>${fmtMoney(p.total_amount)}</td>
        <td>${fmtDate(p.created_at)}</td>
        <td>${p.is_voided ? '<span class="badge voided">Voided</span>' : '<span class="badge active">Completed</span>'}</td>
        <td class="actions-cell">
          ${!p.is_voided ? `<button data-void="${p.id}" class="danger">Void</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-void]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("Void this purchase — reason (optional), Cancel to abort:");
        if (reason === null) return;
        try {
          await api.post(`/purchases/${btn.dataset.void}/void`, { reason: reason || null });
          showMsg("Purchase voided", "success");
          await Promise.all([loadProducts(), loadPurchases()]);
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  async function loadPurchases() {
    const page = await api.get(`/purchases?limit=${PURCHASES_PAGE_SIZE}&offset=0`);
    lastPurchases = page;
    purchasesOffset = page.length;
    hasMorePurchases = page.length === PURCHASES_PAGE_SIZE;
    renderPurchasesTable();
  }

  async function loadMorePurchases() {
    const page = await api.get(`/purchases?limit=${PURCHASES_PAGE_SIZE}&offset=${purchasesOffset}`);
    lastPurchases = lastPurchases.concat(page);
    purchasesOffset += page.length;
    hasMorePurchases = page.length === PURCHASES_PAGE_SIZE;
    renderPurchasesTable();
  }

  document.getElementById("load-more-purchases-btn").addEventListener("click", () => {
    loadMorePurchases().catch((err) => showMsg(err.message, "error"));
  });

  async function fetchAllPurchases() {
    let all = [];
    let off = 0;
    while (true) {
      const page = await api.get(`/purchases?limit=200&offset=${off}`);
      all = all.concat(page);
      if (page.length < 200) break;
      off += page.length;
    }
    return all;
  }

  document.getElementById("export-purchases-btn").addEventListener("click", async () => {
    try {
      const all = await fetchAllPurchases();
      exportCSV(
        "purchases.csv",
        [
          { key: "id", label: "Purchase #" },
          { key: "invoice_no", label: "Invoice" },
          { key: "items_summary", label: "Items" },
          { key: "total_amount", label: "Total" },
          { key: "created_at", label: "Date" },
        ],
        all.map((p) => ({
          ...p,
          items_summary: p.items.map((i) => `${i.product?.name || "?"} x${i.quantity}`).join("; "),
        }))
      );
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  (async () => {
    try {
      await Promise.all([loadProducts(), loadPurchases()]);
    } catch (err) {
      showMsg(err.message, "error");
    }
  })();
})();
