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

  async function loadPurchases() {
    lastPurchases = await api.get("/purchases");
    const body = document.getElementById("purchases-body");
    body.innerHTML = "";
    if (lastPurchases.length === 0) {
      body.innerHTML = '<tr><td colspan="4">No purchases yet</td></tr>';
      return;
    }
    lastPurchases.forEach((p) => {
      const itemsSummary = p.items.map((i) => `${escapeHtml(i.product?.name) || "?"} x${i.quantity}`).join(", ");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(p.invoice_no) || "#" + p.id}</td>
        <td>${itemsSummary}</td>
        <td>${fmtMoney(p.total_amount)}</td>
        <td>${fmtDate(p.created_at)}</td>
      `;
      body.appendChild(tr);
    });
  }

  document.getElementById("export-purchases-btn").addEventListener("click", () => {
    exportCSV(
      "purchases.csv",
      [
        { key: "id", label: "Purchase #" },
        { key: "invoice_no", label: "Invoice" },
        { key: "items_summary", label: "Items" },
        { key: "total_amount", label: "Total" },
        { key: "created_at", label: "Date" },
      ],
      lastPurchases.map((p) => ({
        ...p,
        items_summary: p.items.map((i) => `${i.product?.name || "?"} x${i.quantity}`).join("; "),
      }))
    );
  });

  (async () => {
    try {
      await Promise.all([loadProducts(), loadPurchases()]);
    } catch (err) {
      showMsg(err.message, "error");
    }
  })();
})();
