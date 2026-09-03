(function () {
  const session = requireRole("admin", "manager");
  if (!session) return;
  renderSidebar("/reports.html");

  const msgBox = document.getElementById("msg-box");
  let chart = null;
  let lastInventory = [];

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  function monthStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }

  document.getElementById("start-date").value = monthStart();
  document.getElementById("end-date").value = today();

  if (session.isAdminBranch && session.branches.length > 1) {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML =
      `<label>Branch</label><select id="branch-filter"><option value="">All Branches</option>` +
      session.branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join("") +
      `</select>`;
    document.getElementById("start-date").closest(".form-row").insertBefore(
      field,
      document.getElementById("run-btn").closest(".field")
    );
    field.querySelector("select").addEventListener("change", () => {
      runReports().catch((err) => showMsg(err.message, "error"));
    });
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });

  function setCardTone(el, value) {
    el.classList.remove("good", "bad");
    el.classList.add(value >= 0 ? "good" : "bad");
  }

  function statRow(label, value, opts = {}) {
    const cls = opts.bold ? ' style="font-weight:700;"' : "";
    return `<tr><td${cls}>${label}</td><td${cls} style="text-align:right;">${fmtMoney(value)}</td></tr>`;
  }

  function changePill(pct) {
    if (pct === null || pct === undefined) return "";
    const cls = pct >= 0 ? "up" : "down";
    const sign = pct >= 0 ? "▲" : "▼";
    return `<span class="change-pill ${cls}">${sign} ${Math.abs(pct).toFixed(1)}% vs previous period</span>`;
  }

  function renderIncomeStatement(pl) {
    document.getElementById("fs-period-label").textContent = `${pl.start_date} to ${pl.end_date}`;
    document.getElementById("income-statement-body").innerHTML = [
      statRow("Revenue", pl.revenue),
      statRow("Cost of Goods Sold", -pl.cogs),
      statRow("Gross Profit", pl.gross_profit, { bold: true }),
      statRow("Operating Expenses", -pl.expenses),
      statRow("Net Profit", pl.net_profit, { bold: true }),
    ].join("");
  }

  function renderBalanceSheet(bs) {
    document.getElementById("fs-as-of-label").textContent = `as of ${bs.as_of_date}`;
    document.getElementById("balance-sheet-body").innerHTML = [
      statRow("Cash Position", bs.cash_position),
      statRow("Inventory Value", bs.inventory_value),
      statRow("Total Assets", bs.total_assets, { bold: true }),
      statRow("Total Liabilities", bs.total_liabilities),
      statRow("Total Equity", bs.total_equity, { bold: true }),
    ].join("");
  }

  function renderPerformance(perf) {
    document.getElementById("perf-revenue").innerHTML =
      fmtMoney(perf.current.revenue) + changePill(perf.change_pct.revenue);
    document.getElementById("perf-net-profit").innerHTML =
      fmtMoney(perf.current.net_profit) + changePill(perf.change_pct.net_profit);
    document.getElementById("perf-transactions").innerHTML =
      perf.current.transaction_count + changePill(perf.change_pct.transaction_count);
    document.getElementById("perf-avg-sale").innerHTML =
      fmtMoney(perf.current.avg_sale_value) + changePill(perf.change_pct.avg_sale_value);
    document.getElementById("perf-compare-label").textContent =
      `Compared to previous period: ${perf.previous_period.start_date} to ${perf.previous_period.end_date}`;

    const body = document.getElementById("by-cashier-body");
    body.innerHTML = "";
    if (perf.by_cashier.length === 0) {
      body.innerHTML = '<tr><td colspan="3">No sales in this period</td></tr>';
    }
    perf.by_cashier.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${c.cashier}</td><td>${c.transaction_count}</td><td>${fmtMoney(c.revenue)}</td>`;
      body.appendChild(tr);
    });
  }

  function renderTopProducts(tp) {
    const demandedBody = document.getElementById("most-demanded-body");
    demandedBody.innerHTML = "";
    if (tp.most_demanded.length === 0) {
      demandedBody.innerHTML = '<tr><td colspan="5">No sales in this period</td></tr>';
    }
    tp.most_demanded.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.sku}</td><td>${p.name}</td><td>${p.quantity_sold}</td><td>${fmtMoney(p.revenue)}</td><td>${fmtMoney(p.profit)}</td>`;
      demandedBody.appendChild(tr);
    });

    const profitableBody = document.getElementById("most-profitable-body");
    profitableBody.innerHTML = "";
    if (tp.most_profitable.length === 0) {
      profitableBody.innerHTML = '<tr><td colspan="6">No sales in this period</td></tr>';
    }
    tp.most_profitable.forEach((p) => {
      const tr = document.createElement("tr");
      const margin = p.margin_pct === null || p.margin_pct === undefined ? "-" : `${p.margin_pct.toFixed(1)}%`;
      tr.innerHTML = `<td>${p.sku}</td><td>${p.name}</td><td>${p.quantity_sold}</td><td>${fmtMoney(p.revenue)}</td><td>${fmtMoney(p.profit)}</td><td>${margin}</td>`;
      profitableBody.appendChild(tr);
    });
  }

  async function runReports() {
    const start = document.getElementById("start-date").value;
    const end = document.getElementById("end-date").value;
    const branchFilter = document.getElementById("branch-filter");
    const branchQs = branchFilter && branchFilter.value ? `&branch_id=${branchFilter.value}` : "";
    const qs = `?start_date=${start}&end_date=${end}${branchQs}`;
    document.getElementById("print-range-label").textContent = `Report period: ${start} to ${end}`;

    const [pl, cf, inv, summary, fs, perf, tp] = await Promise.all([
      api.get(`/reports/profit-loss${qs}`),
      api.get(`/reports/cash-flow${qs}`),
      api.get(`/reports/inventory-valuation${branchQs ? "?" + branchQs.slice(1) : ""}`),
      api.get(`/reports/sales-summary${qs}`),
      api.get(`/reports/financial-statement${qs}`),
      api.get(`/reports/store-performance${qs}`),
      api.get(`/reports/top-products${qs}`),
    ]);

    document.getElementById("kpi-revenue").textContent = fmtMoney(pl.revenue);
    document.getElementById("kpi-cogs").textContent = fmtMoney(pl.cogs);
    document.getElementById("kpi-gross").textContent = fmtMoney(pl.gross_profit);
    document.getElementById("kpi-expenses").textContent = fmtMoney(pl.expenses);
    document.getElementById("kpi-net").textContent = fmtMoney(pl.net_profit);
    setCardTone(document.getElementById("kpi-net-card"), pl.net_profit);

    document.getElementById("kpi-cash-in").textContent = fmtMoney(cf.cash_in);
    document.getElementById("kpi-cash-out").textContent = fmtMoney(cf.cash_out);
    document.getElementById("kpi-net-cash").textContent = fmtMoney(cf.net_cash_flow);
    setCardTone(document.getElementById("kpi-net-cash-card"), cf.net_cash_flow);

    lastInventory = inv.items;
    document.getElementById("inv-total").textContent = `Total: ${fmtMoney(inv.total_value)}`;
    const invBody = document.getElementById("inventory-body");
    invBody.innerHTML = "";
    if (inv.items.length === 0) {
      invBody.innerHTML = '<tr><td colspan="5">No products yet</td></tr>';
    }
    inv.items.forEach((i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i.sku}</td><td>${i.name}</td><td>${i.quantity_on_hand}</td><td>${fmtMoney(i.cost_price)}</td><td>${fmtMoney(i.value)}</td>`;
      invBody.appendChild(tr);
    });

    const ctx = document.getElementById("sales-chart");
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: summary.days,
        datasets: [{ label: "Daily Sales", data: summary.totals, backgroundColor: "#2563eb" }],
      },
      options: { responsive: true, plugins: { legend: { display: false } } },
    });

    renderIncomeStatement(fs.income_statement);
    renderBalanceSheet(fs.balance_sheet);
    renderPerformance(perf);
    renderTopProducts(tp);
  }

  document.getElementById("run-btn").addEventListener("click", () => {
    runReports().catch((err) => showMsg(err.message, "error"));
  });

  document.getElementById("print-report-btn").addEventListener("click", () => window.print());

  document.getElementById("export-inventory-value-btn").addEventListener("click", () => {
    exportCSV(
      "inventory-valuation.csv",
      [
        { key: "sku", label: "SKU" },
        { key: "name", label: "Product" },
        { key: "quantity_on_hand", label: "Qty on Hand" },
        { key: "cost_price", label: "Cost Price" },
        { key: "value", label: "Value" },
      ],
      lastInventory
    );
  });

  runReports().catch((err) => showMsg(err.message, "error"));
})();
