(function () {
  const session = requireAuth();
  if (!session) return;
  const receiptBrand = session.companyName || "T-Tech Connect";

  const msgBox = document.getElementById("msg-box");
  const params = new URLSearchParams(window.location.search);
  const saleId = params.get("sale_id");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
  }

  if (!saleId) {
    showMsg("No sale specified", "error");
    return;
  }

  document.getElementById("print-btn").addEventListener("click", () => window.print());

  api
    .get(`/sales/${saleId}`)
    .then((sale) => {
      const rows = sale.items
        .map(
          (it) => `
        <tr>
          <td>${it.product ? escapeHtml(it.product.name) : "Product #" + it.product_id}</td>
          <td style="text-align:right;">${it.quantity}</td>
          <td style="text-align:right;">${fmtMoney(it.unit_price)}</td>
          <td style="text-align:right;">${fmtMoney(it.subtotal)}</td>
        </tr>`
        )
        .join("");

      const voidedBanner = sale.is_voided
        ? `<div style="text-align:center;font-weight:700;color:var(--danger);border:2px solid var(--danger);border-radius:6px;padding:6px;margin-bottom:10px;">
            VOIDED${sale.voided_by_name ? ` — by ${escapeHtml(sale.voided_by_name)}` : ""}${sale.void_reason ? `: ${escapeHtml(sale.void_reason)}` : ""}
          </div>`
        : "";

      document.getElementById("receipt").innerHTML = `
        <h2>${escapeHtml(receiptBrand)}</h2>
        <div class="receipt-sub">Sales Receipt</div>
        ${voidedBanner}
        <div class="receipt-meta"><span>Invoice</span><span>${escapeHtml(sale.invoice_no) || "#" + sale.id}</span></div>
        <div class="receipt-meta"><span>Date</span><span>${fmtDate(sale.created_at)}</span></div>
        <div class="receipt-meta"><span>Cashier</span><span>${escapeHtml(sale.cashier_name) || "-"}</span></div>
        <div class="receipt-meta"><span>Customer</span><span>${escapeHtml(sale.customer_name) || "Walk-in"}</span></div>
        <div class="receipt-meta"><span>Payment</span><span>${escapeHtml(sale.payment_method)}</span></div>
        <hr />
        <table style="width:100%;">
          <thead><tr><th>Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <hr />
        <div class="receipt-total"><span>Total</span><span>${fmtMoney(sale.total_amount)}</span></div>
      `;
    })
    .catch((err) => showMsg(err.message, "error"));
})();
