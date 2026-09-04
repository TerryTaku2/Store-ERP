(function () {
  const session = requireRole("admin");
  if (!session) return;
  renderSidebar("/audit-log.html");

  const msgBox = document.getElementById("msg-box");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  let lastLogs = [];

  async function loadLogs() {
    const params = new URLSearchParams();
    const entity = document.getElementById("filter-entity").value;
    const action = document.getElementById("filter-action").value;
    const start = document.getElementById("filter-start").value;
    const end = document.getElementById("filter-end").value;
    if (entity) params.set("entity_type", entity);
    if (action) params.set("action", action);
    if (start) params.set("start_date", start);
    if (end) params.set("end_date", end);

    const qs = params.toString() ? `?${params.toString()}` : "";
    const logs = await api.get(`/audit-logs${qs}`);
    lastLogs = logs;

    const body = document.getElementById("audit-body");
    body.innerHTML = "";
    if (logs.length === 0) {
      body.innerHTML = '<tr><td colspan="6">No audit entries found</td></tr>';
      return;
    }
    logs.forEach((l) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(l.created_at)}</td>
        <td>${escapeHtml(l.username)}</td>
        <td>${l.role ? `<span class="badge ${l.role}">${escapeHtml(l.role)}</span>` : "-"}</td>
        <td>${escapeHtml(l.action)}</td>
        <td>${escapeHtml(l.entity_type)}${l.entity_id ? " #" + l.entity_id : ""}</td>
        <td>${escapeHtml(l.summary)}</td>
      `;
      body.appendChild(tr);
    });
  }

  document.getElementById("run-filter-btn").addEventListener("click", () => {
    loadLogs().catch((err) => showMsg(err.message, "error"));
  });

  document.getElementById("export-audit-btn").addEventListener("click", () => {
    exportCSV(
      "audit-log.csv",
      [
        { key: "created_at", label: "Date" },
        { key: "username", label: "User" },
        { key: "role", label: "Role" },
        { key: "action", label: "Action" },
        { key: "entity_type", label: "Entity Type" },
        { key: "entity_id", label: "Entity ID" },
        { key: "summary", label: "Details" },
      ],
      lastLogs
    );
  });

  loadLogs().catch((err) => showMsg(err.message, "error"));
})();
