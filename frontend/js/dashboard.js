(async function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/dashboard.html");

  document.getElementById("dashboard-subtitle").textContent =
    `${session.branchName || "All Branches"} · ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;

  const header = document.querySelector(".main header");
  if (session.isAdminBranch && session.branches.length > 1) {
    const select = document.createElement("select");
    select.id = "branch-filter";
    select.style.width = "auto";
    select.innerHTML =
      `<option value="">All Branches</option>` +
      session.branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
    header.appendChild(select);
    select.addEventListener("change", () => {
      loadDashboard(select.value);
      loadSalesTrend(select.value);
      loadExpenseBreakdown(select.value);
    });
  }

  const CATEGORY_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#64748b"];

  let salesTrendChart = null;

  function renderSparkline(totals) {
    const svg = document.getElementById("sales-sparkline");
    if (!totals || totals.length < 2) {
      svg.innerHTML = "";
      return;
    }
    const w = 120, h = 40, pad = 3;
    const max = Math.max(...totals, 0.01);
    const min = Math.min(...totals, 0);
    const range = max - min || 1;
    const points = totals
      .map((v, i) => {
        const x = (i / (totals.length - 1)) * (w - pad * 2) + pad;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    svg.innerHTML = `<polyline points="${points}" fill="none" stroke="var(--success-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  function renderSalesChange(totals) {
    const pillEl = document.getElementById("kpi-sales-change");
    const subEl = document.getElementById("kpi-sales-sub");
    if (!totals || totals.length < 2) {
      pillEl.textContent = "";
      subEl.textContent = "";
      return;
    }
    const today = totals[totals.length - 1];
    const yesterday = totals[totals.length - 2];
    subEl.textContent = `vs. ${fmtMoney(yesterday)} yesterday`;
    if (yesterday <= 0) {
      pillEl.textContent = "";
      return;
    }
    const pct = ((today - yesterday) / yesterday) * 100;
    pillEl.className = `change-pill ${pct >= 0 ? "up" : "down"}`;
    pillEl.textContent = ` ${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
  }

  async function loadSalesTrend(branchId) {
    try {
      const query = branchId ? `?branch_id=${branchId}` : "";
      const data = await api.get(`/dashboard/sales-trend${query}`);
      renderSparkline(data.totals);
      renderSalesChange(data.totals);
      const ctx = document.getElementById("sales-trend-chart");
      if (salesTrendChart) salesTrendChart.destroy();
      salesTrendChart = new Chart(ctx, {
        type: "line",
        data: {
          labels: data.days,
          datasets: [{
            label: "Sales",
            data: data.totals,
            borderColor: "#2563eb",
            backgroundColor: "rgba(37,99,235,.15)",
            tension: 0.3,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.06)" } },
            y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.06)" } },
          },
        },
      });
    } catch (err) {
      // Non-fatal — the rest of the dashboard still works without this chart.
    }
  }

  let expenseChart = null;
  async function loadExpenseBreakdown(branchId) {
    try {
      const query = branchId ? `?branch_id=${branchId}` : "";
      const data = await api.get(`/dashboard/expense-breakdown${query}`);
      const canvas = document.getElementById("expense-breakdown-chart");
      const emptyMsg = document.getElementById("expense-breakdown-empty");
      if (expenseChart) expenseChart.destroy();

      if (data.categories.length === 0) {
        canvas.classList.add("hidden");
        emptyMsg.classList.remove("hidden");
        return;
      }
      canvas.classList.remove("hidden");
      emptyMsg.classList.add("hidden");
      expenseChart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: data.categories,
          datasets: [{ data: data.totals, backgroundColor: CATEGORY_COLORS }],
        },
        options: { responsive: true, plugins: { legend: { position: "bottom", labels: { color: "#94a3b8" } } } },
      });
    } catch (err) {
      // Non-fatal — the rest of the dashboard still works without this chart.
    }
  }

  let revenueByBranchChart = null;
  function renderRevenueByBranchChart(rows) {
    const panel = document.getElementById("revenue-by-branch-panel");
    if (!session.isAdminBranch || rows.length < 2) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const ctx = document.getElementById("revenue-by-branch-chart");
    if (revenueByBranchChart) revenueByBranchChart.destroy();
    revenueByBranchChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.branch_name),
        datasets: [{ label: "Month Revenue", data: rows.map((r) => r.month_revenue), backgroundColor: "#2563eb" }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.06)" } },
          y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.06)" } },
        },
      },
    });
  }

  let lastBranchesOverview = [];

  async function loadBranchesOverview() {
    if (!session.isAdminBranch) return;
    try {
      const rows = await api.get("/dashboard/branches-overview");
      lastBranchesOverview = rows;
      const panel = document.getElementById("branches-overview-panel");
      const body = document.getElementById("branches-overview-body");
      body.innerHTML = "";
      const attentionCount = rows.filter((r) => r.needs_attention).length;
      document.getElementById("branches-overview-title").textContent = attentionCount > 0
        ? `Branch Overview — ${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`
        : "Branch Overview — all branches look healthy";

      rows.forEach((r) => {
        const tr = document.createElement("tr");
        if (r.needs_attention) tr.classList.add("low-stock");
        const profitColor = r.month_net_profit >= 0 ? "var(--success)" : "var(--danger)";
        const lowStockDetail = r.low_stock_items.length
          ? `<div class="stock-alert-list">${r.low_stock_items
              .map((i) => `${escapeHtml(i.name)} (${i.quantity_on_hand}/${i.reorder_level})`)
              .join(", ")}${r.low_stock_count > r.low_stock_items.length ? ", …" : ""}</div>`
          : "";
        tr.innerHTML = `
          <td>${r.needs_attention ? "⚠️ " : ""}${escapeHtml(r.branch_name)}${r.is_admin ? ' <span class="badge admin">HQ</span>' : ""}</td>
          <td>${fmtMoney(r.today_sales)}</td>
          <td>${fmtMoney(r.month_revenue)}</td>
          <td>${fmtMoney(r.month_expenses)}</td>
          <td style="color:${profitColor};font-weight:600;">${fmtMoney(r.month_net_profit)}</td>
          <td>${fmtMoney(r.stock_value)}</td>
          <td>${r.low_stock_count > 0 ? `<strong>${r.low_stock_count}</strong>` : "0"}${lowStockDetail}</td>
        `;
        body.appendChild(tr);
      });
      panel.classList.toggle("hidden", rows.length === 0);
      renderRevenueByBranchChart(rows);
    } catch (err) {
      // Non-fatal — the rest of the dashboard still works without this panel.
    }
  }

  const PAYMENT_METHOD_LABELS = { cash: "Cash", card: "Card", mobile_money: "Mobile Money", mobile: "Mobile Money", credit: "Credit" };

  function renderPaymentBreakdown(breakdown) {
    const container = document.getElementById("payment-breakdown-rows");
    const methods = Object.keys(breakdown);
    if (methods.length === 0) {
      container.innerHTML = `<div class="card-sub" style="margin-top:10px;">No sales recorded yet today</div>`;
      return;
    }
    container.innerHTML = methods
      .sort((a, b) => breakdown[b] - breakdown[a])
      .map(
        (method) => `
          <div class="drawer-row">
            <span>${escapeHtml(PAYMENT_METHOD_LABELS[method] || (method.charAt(0).toUpperCase() + method.slice(1)))}</span>
            <span class="amt">${fmtMoney(breakdown[method])}</span>
          </div>`
      )
      .join("");
  }

  // Cashiers/managers can't call /audit-logs (admin-only), so their Recent
  // Activity card falls back to the sales they can already see. loadRecentActivity
  // overwrites this with the richer admin feed when that call succeeds.
  function renderRecentActivityFallback(recentSales) {
    const container = document.getElementById("activity-list");
    if (!recentSales || recentSales.length === 0) {
      container.innerHTML = `<div class="card-sub">No recent activity</div>`;
      return;
    }
    container.innerHTML = recentSales
      .map(
        (s) => `
          <div class="ac-row"><span class="ac-dot"></span>Sale ${escapeHtml(s.invoice_no) || "#" + s.id} recorded — ${fmtMoney(s.total_amount)}<span class="ac-time">${timeAgo(s.created_at)}</span></div>`
      )
      .join("");
  }

  async function loadRecentActivity() {
    if (session.role !== "admin") return;
    try {
      const logs = await api.get("/audit-logs?limit=6");
      const container = document.getElementById("activity-list");
      if (logs.length === 0) {
        container.innerHTML = `<div class="card-sub">No recent activity</div>`;
        return;
      }
      container.innerHTML = logs
        .map(
          (l) => `<div class="ac-row"><span class="ac-dot"></span>${escapeHtml(l.summary)}<span class="ac-time">${timeAgo(l.created_at)}</span></div>`
        )
        .join("");
    } catch (err) {
      // Non-fatal — the sales-based fallback rendered by loadDashboard still stands.
    }
  }

  async function loadLowStockAlerts() {
    const container = document.getElementById("lowstock-list");
    try {
      const products = await api.get("/products");
      const low = products
        .filter((p) => p.quantity_on_hand <= p.reorder_level)
        .sort((a, b) => (b.reorder_level - b.quantity_on_hand) - (a.reorder_level - a.quantity_on_hand))
        .slice(0, 8);
      if (low.length === 0) {
        container.innerHTML = `<div class="card-sub">All products are above their reorder level</div>`;
        return;
      }
      container.innerHTML = low
        .map((p) => {
          const severity = stockSeverity(p.quantity_on_hand, p.reorder_level);
          const badge = severity === "critical"
            ? (p.quantity_on_hand <= 0 ? '<span class="badge rose">Out of stock</span>' : '<span class="badge rose">Critical</span>')
            : '<span class="badge amber">Low</span>';
          return `
            <div class="ls-row">
              <div><div class="ls-name">${escapeHtml(p.name)}</div><div class="ls-qty">${p.quantity_on_hand} left · reorder at ${p.reorder_level}</div></div>
              ${badge}
            </div>`;
        })
        .join("");
    } catch (err) {
      container.innerHTML = `<div class="card-sub">Couldn't load stock levels</div>`;
    }
  }

  async function loadRecentPurchases() {
    const panel = document.querySelector(".cmd-pending");
    try {
      const purchases = await api.get("/purchases?limit=5");
      const container = document.getElementById("recent-purchases-rows");
      if (purchases.length === 0) {
        container.innerHTML = `<div class="card-sub">No purchases recorded yet</div>`;
        return;
      }
      container.innerHTML = purchases
        .map(
          (p) => `
            <div class="po-row">
              <span class="po-id">${escapeHtml(p.invoice_no) || "#" + p.id}</span>
              <span class="po-sub">${p.items.length} item${p.items.length === 1 ? "" : "s"}</span>
              <span class="po-amt">${fmtMoney(p.total_amount)}</span>
            </div>`
        )
        .join("");
    } catch (err) {
      // Cashiers, and branches without the purchases module, can't see this — hide the card.
      panel.classList.add("hidden");
    }
  }

  async function loadDashboard(branchId) {
    try {
      const query = branchId ? `?branch_id=${branchId}` : "";
      const data = await api.get(`/dashboard/summary${query}`);

      document.getElementById("kpi-today-sales").textContent = fmtMoney(data.today_sales);
      document.getElementById("kpi-month-revenue").textContent = fmtMoney(data.month_revenue);
      document.getElementById("kpi-month-expenses").textContent = fmtMoney(data.month_expenses);

      const netProfitEl = document.getElementById("kpi-net-profit");
      netProfitEl.textContent = fmtMoney(data.month_net_profit);
      netProfitEl.style.color = data.month_net_profit >= 0 ? "var(--success-text)" : "var(--danger-text)";

      renderPaymentBreakdown(data.today_payment_breakdown || {});
      renderRecentActivityFallback(data.recent_sales);

      const body = document.getElementById("recent-sales-body");
      body.innerHTML = "";
      if (data.recent_sales.length === 0) {
        body.innerHTML = '<tr><td colspan="4">No sales yet</td></tr>';
      }
      data.recent_sales.forEach((s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(s.invoice_no) || "#" + s.id}</td>
          <td>${escapeHtml(s.cashier) || "-"}</td>
          <td>${fmtMoney(s.total_amount)}</td>
          <td>${fmtDate(s.created_at)}</td>
        `;
        body.appendChild(tr);
      });
    } catch (err) {
      document.querySelector(".main").insertAdjacentHTML(
        "afterbegin",
        `<div class="msg error">${err.message}</div>`
      );
    }
  }

  document.getElementById("export-branches-overview-btn").addEventListener("click", () => {
    exportCSV(
      "branch-overview.csv",
      [
        { key: "branch_name", label: "Branch" },
        { key: "today_sales", label: "Today's Sales" },
        { key: "month_revenue", label: "Month Revenue" },
        { key: "month_expenses", label: "Month Expenses" },
        { key: "month_net_profit", label: "Net Profit" },
        { key: "stock_value", label: "Stock Value" },
        { key: "low_stock_count", label: "Low Stock Items" },
      ],
      lastBranchesOverview
    );
  });

  loadDashboard("");
  loadSalesTrend("");
  loadExpenseBreakdown("");
  loadBranchesOverview();
  loadLowStockAlerts();
  loadRecentPurchases();
  loadRecentActivity();
})();
