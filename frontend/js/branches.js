(function () {
  const session = requireRole("admin");
  if (!session) return;
  if (!session.isAdminBranch) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;">' +
      "<h2>403 - Access denied</h2>" +
      '<p>Only the administration branch can manage branches. <a href="/dashboard.html">Back to dashboard</a></p>' +
      "</div>";
    return;
  }
  renderSidebar("/branches.html");

  const MODULES = [
    { key: "sales", label: "Sales" },
    { key: "purchases", label: "Purchases" },
    { key: "expenses", label: "Expenses" },
    { key: "reports", label: "Reports" },
  ];

  let branches = [];
  let allUsers = [];
  let activeBranchId = null;

  const msgBox = document.getElementById("msg-box");
  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  const initialModulesBox = document.getElementById("initial-modules");
  initialModulesBox.innerHTML = MODULES.map(
    (m) => `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-weight:normal;text-transform:none;">
      <input type="checkbox" value="${m.key}" class="initial-module-check" /> ${m.label}
    </label>`
  ).join("");

  async function loadBranches() {
    branches = await api.get("/branches");
    const body = document.getElementById("branches-body");
    body.innerHTML = "";
    branches.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(b.name)}</td>
        <td>${escapeHtml(b.code)}</td>
        <td>${b.is_admin ? '<span class="badge admin">Administration</span>' : "Branch"}</td>
        <td>${b.is_active ? "Active" : "Disabled"}</td>
        <td class="actions-cell">
          <button data-manage="${b.id}" class="secondary">Manage</button>
        </td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-manage]").forEach((btn) =>
      btn.addEventListener("click", () => openManageModal(Number(btn.dataset.manage)))
    );
  }

  document.getElementById("branch-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const initial_modules = Array.from(
      document.querySelectorAll(".initial-module-check:checked")
    ).map((c) => c.value);
    try {
      await api.post("/branches", {
        name: document.getElementById("branch-name").value,
        code: document.getElementById("branch-code").value,
        address: document.getElementById("branch-address").value || null,
        phone: document.getElementById("branch-phone").value || null,
        initial_modules,
      });
      showMsg("Branch created", "success");
      e.target.reset();
      loadBranches();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  // ---------- Manage modal ----------

  const modal = document.getElementById("branch-modal");
  document.getElementById("branch-modal-close").addEventListener("click", () => modal.classList.add("hidden"));

  async function openManageModal(branchId) {
    activeBranchId = branchId;
    const branch = branches.find((b) => b.id === branchId);
    document.getElementById("branch-modal-title").textContent = `Manage: ${branch.name}`;
    document.getElementById("modal-branch-name").value = branch.name;
    document.getElementById("modal-branch-code").value = branch.code;
    document.getElementById("modal-branch-address").value = branch.address || "";
    document.getElementById("modal-branch-phone").value = branch.phone || "";
    const activeCheckbox = document.getElementById("modal-branch-active");
    activeCheckbox.checked = branch.is_admin ? true : branch.is_active;
    activeCheckbox.disabled = branch.is_admin;
    document.getElementById("modal-functions-section").classList.toggle("hidden", branch.is_admin);
    document.getElementById("modal-admin-note").classList.toggle("hidden", !branch.is_admin);

    const [modules, branchUsers] = await Promise.all([
      api.get(`/branches/${branchId}/modules`),
      api.get(`/branches/${branchId}/users`),
    ]);
    if (allUsers.length === 0) allUsers = await api.get("/users");

    const enabled = new Set(modules.filter((m) => m.enabled).map((m) => m.module));
    document.getElementById("modal-modules").innerHTML = MODULES.map(
      (m) => `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-weight:normal;text-transform:none;">
        <input type="checkbox" value="${m.key}" class="modal-module-check" ${enabled.has(m.key) ? "checked" : ""} /> ${m.label}
      </label>`
    ).join("");

    renderBranchUsers(branchUsers);

    const grantedIds = new Set(branchUsers.map((u) => u.id));
    const selectable = allUsers.filter((u) => !grantedIds.has(u.id));
    const select = document.getElementById("grant-user-select");
    select.innerHTML = selectable
      .map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`)
      .join("") || `<option disabled>No other users</option>`;

    modal.classList.remove("hidden");
  }

  function renderBranchUsers(branchUsers) {
    const list = document.getElementById("modal-users");
    list.innerHTML = branchUsers
      .map(
        (u) =>
          `<li>${escapeHtml(u.full_name)} (${escapeHtml(u.username)}) <span class="badge ${u.role}">${escapeHtml(u.role)}</span>
            <button data-revoke="${u.id}" class="danger" style="margin-left:8px;padding:2px 8px;font-size:12px;">Revoke</button>
          </li>`
      )
      .join("");
    list.querySelectorAll("[data-revoke]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api.del(`/branches/${activeBranchId}/users/${btn.dataset.revoke}`);
          openManageModal(activeBranchId);
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  document.getElementById("save-details-btn").addEventListener("click", async () => {
    try {
      await api.put(`/branches/${activeBranchId}`, {
        name: document.getElementById("modal-branch-name").value,
        address: document.getElementById("modal-branch-address").value || null,
        phone: document.getElementById("modal-branch-phone").value || null,
        is_active: document.getElementById("modal-branch-active").checked,
      });
      showMsg("Branch details updated", "success");
      await loadBranches();
      const branch = branches.find((b) => b.id === activeBranchId);
      if (branch) document.getElementById("branch-modal-title").textContent = `Manage: ${branch.name}`;
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("save-modules-btn").addEventListener("click", async () => {
    const modules = {};
    document.querySelectorAll(".modal-module-check").forEach((c) => (modules[c.value] = c.checked));
    try {
      await api.put(`/branches/${activeBranchId}/modules`, { modules });
      showMsg("Functions updated", "success");
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("grant-user-btn").addEventListener("click", async () => {
    const select = document.getElementById("grant-user-select");
    if (!select.value) return;
    try {
      await api.post(`/branches/${activeBranchId}/users/${select.value}`, {});
      openManageModal(activeBranchId);
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-branches-btn").addEventListener("click", () => {
    exportCSV(
      "branches.csv",
      [
        { key: "name", label: "Name" },
        { key: "code", label: "Code" },
        { key: "type", label: "Type" },
        { key: "address", label: "Address" },
        { key: "phone", label: "Phone" },
        { key: "status", label: "Status" },
      ],
      branches.map((b) => ({
        ...b,
        type: b.is_admin ? "Administration" : "Branch",
        status: b.is_active ? "Active" : "Disabled",
      }))
    );
  });

  loadBranches().catch((err) => showMsg(err.message, "error"));
})();
