(function () {
  const session = requireAuth();
  if (!session) return;
  if (!session.isPlatformAdmin) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;">' +
      "<h2>403 - Access denied</h2>" +
      '<p>Only a platform admin can manage companies. <a href="/dashboard.html">Back to dashboard</a></p>' +
      "</div>";
    return;
  }
  renderSidebar("/companies.html");

  const msgBox = document.getElementById("msg-box");
  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  let companies = [];

  async function loadCompanies() {
    companies = await api.get("/companies");
    const body = document.getElementById("companies-body");
    body.innerHTML = "";
    companies.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(c.name)}</td>
        <td>${c.is_active ? "Active" : "Disabled"}</td>
        <td>${fmtDate(c.created_at)}</td>
        <td class="actions-cell">
          <button data-rename="${c.id}" class="secondary">Rename</button>
          <button data-toggle="${c.id}" data-active="${c.is_active}" class="secondary">
            ${c.is_active ? "Disable" : "Enable"}
          </button>
        </td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api.put(`/companies/${btn.dataset.toggle}`, { is_active: btn.dataset.active !== "true" });
        } catch (err) {
          showMsg(err.message, "error");
        }
        loadCompanies();
      })
    );
    body.querySelectorAll("[data-rename]").forEach((btn) =>
      btn.addEventListener("click", () => openRenameModal(Number(btn.dataset.rename)))
    );
  }

  const companyModal = document.getElementById("company-modal");
  let renamingCompanyId = null;

  function openRenameModal(companyId) {
    const company = companies.find((c) => c.id === companyId);
    if (!company) return;
    renamingCompanyId = companyId;
    document.getElementById("modal-company-name").value = company.name;
    companyModal.classList.remove("hidden");
  }

  document.getElementById("company-modal-close").addEventListener("click", () => companyModal.classList.add("hidden"));

  document.getElementById("company-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.put(`/companies/${renamingCompanyId}`, { name: document.getElementById("modal-company-name").value });
      companyModal.classList.add("hidden");
      showMsg("Business name updated", "success");
      loadCompanies();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("company-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.post("/companies", {
        name: document.getElementById("company-name").value,
        admin_username: document.getElementById("admin-username").value,
        admin_full_name: document.getElementById("admin-full-name").value,
        admin_password: document.getElementById("admin-password").value,
      });
      showMsg("Company created", "success");
      e.target.reset();
      loadCompanies();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-companies-btn").addEventListener("click", () => {
    exportCSV(
      "companies.csv",
      [
        { key: "name", label: "Name" },
        { key: "status", label: "Status" },
        { key: "created_at", label: "Created" },
      ],
      companies.map((c) => ({ ...c, status: c.is_active ? "Active" : "Disabled" }))
    );
  });

  loadCompanies().catch((err) => showMsg(err.message, "error"));
})();
