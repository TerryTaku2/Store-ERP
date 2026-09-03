(function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/sales.html");

  let products = [];
  let cart = [];

  const msgBox = document.getElementById("msg-box");
  const productSelect = document.getElementById("line-product");
  const priceInput = document.getElementById("line-price");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  async function loadProducts() {
    products = await api.get("/products");
    productSelect.innerHTML = products
      .map((p) => `<option value="${p.id}">${p.name} (${p.sku}) — ${p.quantity_on_hand} in stock</option>`)
      .join("");
    if (products.length > 0) {
      priceInput.value = products[0].sell_price;
    }
  }

  productSelect.addEventListener("change", () => {
    const p = products.find((x) => x.id === Number(productSelect.value));
    if (p) priceInput.value = p.sell_price;
  });

  async function addByBarcode(code) {
    if (!code) return;
    try {
      const product = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      cart.push({ product_id: product.id, name: product.name, quantity: 1, unit_price: product.sell_price });
      renderCart();
      showMsg(`Added '${product.name}' to cart`, "success");
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
      const subtotal = line.quantity * line.unit_price;
      total += subtotal;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${line.name}</td>
        <td>${line.quantity}</td>
        <td>${fmtMoney(line.unit_price)}</td>
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
    const price = Number(priceInput.value);

    if (!product) return showMsg("Select a product", "error");
    if (!qty || qty <= 0) return showMsg("Enter a valid quantity", "error");

    cart.push({ product_id: productId, name: product.name, quantity: qty, unit_price: price });
    renderCart();
  });

  document.getElementById("submit-sale-btn").addEventListener("click", async () => {
    if (cart.length === 0) return showMsg("Add at least one item to the sale", "error");
    try {
      const sale = await api.post("/sales", {
        customer_name: document.getElementById("customer_name").value || null,
        payment_method: document.getElementById("payment_method").value,
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

  let lastSales = [];

  async function loadSales() {
    lastSales = await api.get("/sales");
    const body = document.getElementById("sales-body");
    body.innerHTML = "";
    if (lastSales.length === 0) {
      body.innerHTML = '<tr><td colspan="6">No sales yet</td></tr>';
      return;
    }
    lastSales.forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.invoice_no || "#" + s.id}</td>
        <td>${s.customer_name || "-"}</td>
        <td>${s.payment_method}</td>
        <td>${fmtMoney(s.total_amount)}</td>
        <td>${fmtDate(s.created_at)}</td>
        <td><a href="/receipt.html?sale_id=${s.id}" target="_blank">Receipt</a></td>
      `;
      body.appendChild(tr);
    });
  }

  document.getElementById("export-sales-btn").addEventListener("click", () => {
    exportCSV(
      "sales.csv",
      [
        { key: "id", label: "Invoice #" },
        { key: "customer_name", label: "Customer" },
        { key: "payment_method", label: "Payment Method" },
        { key: "total_amount", label: "Total" },
        { key: "created_at", label: "Date" },
      ],
      lastSales
    );
  });

  Promise.all([loadProducts(), loadSales()]).catch((err) => showMsg(err.message, "error"));
})();
