(async function () {
  const session = requireAuth();
  if (!session) return;
  renderSidebar("/dashboard.html");

  const header = document.querySelector(".main header");
  if (session.isAdminBranch && session.branches.length > 1) {
    const select = document.createElement("select");
    select.id = "branch-filter";
    select.style.width = "auto";
    select.innerHTML =
      `<option value="">All Branches</option>` +
      session.branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
    header.appendChild(select);
    select.addEventListener("change", () => {
      loadDashboard(select.value);
      loadSalesTrend(select.value);
      loadExpenseBreakdown(select.value);
    });
  }

  const CATEGORY_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#64748b"];

  let salesTrendChart = null;
  async function loadSalesTrend(branchId) {
    try {
      const query = branchId ? `?branch_id=${branchId}` : "";
      const data = await api.get(`/dashboard/sales-trend${query}`);
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
            backgroundColor: "rgba(37,99,235,.1)",
            tension: 0.3,
            fill: true,
          }],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
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
        options: { responsive: true, plugins: { legend: { position: "bottom" } } },
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
      options: { responsive: true, plugins: { legend: { display: false } } },
    });
  }

  async function loadBranchesOverview() {
    if (!session.isAdminBranch) return;
    try {
      const rows = await api.get("/dashboard/branches-overview");
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
              .map((i) => `${i.name} (${i.quantity_on_hand}/${i.reorder_level})`)
              .join(", ")}${r.low_stock_count > r.low_stock_items.length ? ", …" : ""}</div>`
          : "";
        tr.innerHTML = `
          <td>${r.needs_attention ? "⚠️ " : ""}${r.branch_name}${r.is_admin ? ' <span class="badge admin">HQ</span>' : ""}</td>
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

  async function loadDashboard(branchId) {
    try {
      const query = branchId ? `?branch_id=${branchId}` : "";
      const data = await api.get(`/dashboard/summary${query}`);

      document.getElementById("kpi-today-sales").textContent = fmtMoney(data.today_sales);
      document.getElementById("kpi-month-revenue").textContent = fmtMoney(data.month_revenue);
      document.getElementById("kpi-month-expenses").textContent = fmtMoney(data.month_expenses);

      const netCard = document.getElementById("kpi-net-profit-card");
      netCard.classList.remove("good", "bad");
      netCard.classList.add(data.month_net_profit >= 0 ? "good" : "bad");
      document.getElementById("kpi-net-profit").textContent = fmtMoney(data.month_net_profit);

      document.getElementById("kpi-low-stock").textContent = data.low_stock_count;

      const body = document.getElementById("recent-sales-body");
      body.innerHTML = "";
      if (data.recent_sales.length === 0) {
        body.innerHTML = '<tr><td colspan="4">No sales yet</td></tr>';
      }
      data.recent_sales.forEach((s) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${s.invoice_no || "#" + s.id}</td>
          <td>${s.cashier || "-"}</td>
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

  loadDashboard("");
  loadSalesTrend("");
  loadExpenseBreakdown("");
  loadBranchesOverview();
})();
