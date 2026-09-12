(function () {
  const session = requireRole("admin", "manager");
  if (!session) return;
  renderSidebar("/payroll.html");

  const isAdmin = session.role === "admin";
  const msgBox = document.getElementById("msg-box");
  const newRunPanel = document.getElementById("new-run-panel");
  const draftPanel = document.getElementById("draft-panel");
  const finalizeBtn = document.getElementById("finalize-run-btn");
  const discardBtn = document.getElementById("discard-run-btn");

  let runs = [];

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function statusBadge(status) {
    const map = { draft: "amber", finalized: "emerald", voided: "voided" };
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return `<span class="badge ${map[status] || "active"}">${label}</span>`;
  }

  function renderItemsRows(items, editable) {
    return items
      .map(
        (it) => `
        <tr data-item-row="${it.id}">
          <td>${escapeHtml(it.employee_name || `#${it.employee_id}`)}</td>
          <td>${fmtMoney(it.base_salary)}</td>
          <td>${
            editable
              ? `<input type="number" step="0.01" value="${it.bonus}" data-bonus="${it.id}" style="width:100px;" />`
              : fmtMoney(it.bonus)
          }</td>
          <td>${
            editable
              ? `<input type="number" step="0.01" value="${it.deductions}" data-deductions="${it.id}" style="width:100px;" />`
              : fmtMoney(it.deductions)
          }</td>
          <td data-net="${it.id}">${fmtMoney(it.net_pay)}</td>
        </tr>`
      )
      .join("");
  }

  function renderDraft(run) {
    if (!run) {
      draftPanel.classList.add("hidden");
      newRunPanel.classList.remove("hidden");
      return;
    }
    newRunPanel.classList.add("hidden");
    draftPanel.classList.remove("hidden");
    document.getElementById("draft-period").textContent = `${run.period_start} to ${run.period_end}`;
    document.getElementById("draft-items-body").innerHTML = renderItemsRows(run.items, true);
    document.getElementById("draft-total").textContent = fmtMoney(run.total_amount);
    finalizeBtn.dataset.runId = run.id;
    finalizeBtn.classList.toggle("hidden", !isAdmin);
    discardBtn.dataset.runId = run.id;

    document.querySelectorAll("[data-bonus], [data-deductions]").forEach((input) => {
      input.addEventListener("change", async () => {
        const itemId = Number(input.dataset.bonus || input.dataset.deductions);
        const row = input.closest("tr");
        const bonus = Number(row.querySelector("[data-bonus]").value || 0);
        const deductions = Number(row.querySelector("[data-deductions]").value || 0);
        try {
          const updated = await api.put(`/payroll/${run.id}/items/${itemId}`, { bonus, deductions });
          const item = updated.items.find((i) => i.id === itemId);
          row.querySelector("[data-net]").textContent = fmtMoney(item.net_pay);
          document.getElementById("draft-total").textContent = fmtMoney(updated.total_amount);
        } catch (err) {
          showMsg(err.message, "error");
        }
      });
    });
  }

  function renderHistory() {
    const body = document.getElementById("history-body");
    body.innerHTML = "";
    if (runs.length === 0) {
      body.innerHTML = '<tr><td colspan="5">No payroll runs yet</td></tr>';
      return;
    }
    runs.forEach((run) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${run.period_start} – ${run.period_end}</td>
        <td>${run.items.length}</td>
        <td>${fmtMoney(run.total_amount)}</td>
        <td>${statusBadge(run.status)}</td>
        <td class="actions-cell">
          <button data-view="${run.id}" class="secondary">View</button>
          ${isAdmin && run.status === "finalized" ? `<button data-void="${run.id}" class="danger">Void</button>` : ""}
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-view]").forEach((btn) =>
      btn.addEventListener("click", () => openDetailModal(Number(btn.dataset.view)))
    );
    body.querySelectorAll("[data-void]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const reason = prompt("Void this payroll run — reason (optional), Cancel to abort:");
        if (reason === null) return;
        try {
          await api.post(`/payroll/${btn.dataset.void}/void`, { reason: reason || null });
          showMsg("Payroll run voided", "success");
          await load();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  function openDetailModal(runId) {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    document.getElementById("run-detail-title").textContent = `Payroll Run — ${run.period_start} to ${run.period_end}`;
    document.getElementById("run-detail-body").innerHTML = renderItemsRows(run.items, false);
    const note = document.getElementById("run-detail-void-note");
    if (run.status === "voided") {
      note.textContent = `Voided by ${run.voided_by_name || "—"}${run.void_reason ? `: ${run.void_reason}` : ""}`;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
    document.getElementById("run-detail-modal").classList.remove("hidden");
  }

  document.getElementById("run-detail-close").addEventListener("click", () => {
    document.getElementById("run-detail-modal").classList.add("hidden");
  });

  document.getElementById("new-run-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.post("/payroll", {
        period_start: document.getElementById("period-start").value,
        period_end: document.getElementById("period-end").value,
      });
      showMsg("Payroll run generated", "success");
      await load();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  finalizeBtn.addEventListener("click", async () => {
    if (!confirm("Finalize this payroll run? This records it as an expense and can't be adjusted afterward.")) return;
    try {
      await api.post(`/payroll/${finalizeBtn.dataset.runId}/finalize`);
      showMsg("Payroll run finalized", "success");
      await load();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  discardBtn.addEventListener("click", async () => {
    if (!confirm("Discard this draft payroll run? This cannot be undone.")) return;
    try {
      await api.del(`/payroll/${discardBtn.dataset.runId}`);
      showMsg("Draft discarded", "success");
      await load();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-payroll-btn").addEventListener("click", () => {
    exportCSV(
      "payroll-history.csv",
      [
        { key: "period_start", label: "Period Start" },
        { key: "period_end", label: "Period End" },
        { key: "employees", label: "Employees" },
        { key: "total_amount", label: "Total" },
        { key: "status", label: "Status" },
      ],
      runs.map((r) => ({ ...r, employees: r.items.length }))
    );
  });

  async function load() {
    runs = await api.get("/payroll");
    const draft = runs.find((r) => r.status === "draft") || null;
    renderDraft(draft);
    renderHistory();
  }

  load().catch((err) => showMsg(err.message, "error"));
})();
