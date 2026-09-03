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

  async function loadCompanies() {
    const companies = await api.get("/companies");
    const body = document.getElementById("companies-body");
    body.innerHTML = "";
    companies.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.name}</td>
        <td>${c.is_active ? "Active" : "Disabled"}</td>
        <td>${fmtDate(c.created_at)}</td>
        <td class="actions-cell">
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
  }

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

  loadCompanies().catch((err) => showMsg(err.message, "error"));
})();
