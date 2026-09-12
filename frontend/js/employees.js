(function () {
  const session = requireRole("admin");
  if (!session) return;
  renderSidebar("/employees.html");

  let employees = [];
  let branches = [];
  const msgBox = document.getElementById("msg-box");
  const form = document.getElementById("employee-form");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const formTitle = document.getElementById("form-title");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function renderBranchOptions(selectedId) {
    const select = document.getElementById("branch_id");
    select.innerHTML = branches.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
    if (selectedId) select.value = selectedId;
  }

  function resetForm() {
    form.reset();
    document.getElementById("employee-id").value = "";
    document.getElementById("base_salary").value = 0;
    formTitle.textContent = "Add Employee";
    renderBranchOptions(null);
    cancelBtn.classList.add("hidden");
  }

  function fillForm(e) {
    document.getElementById("employee-id").value = e.id;
    document.getElementById("full_name").value = e.full_name;
    document.getElementById("position").value = e.position || "";
    document.getElementById("phone").value = e.phone || "";
    document.getElementById("base_salary").value = e.base_salary;
    renderBranchOptions(e.branch_id);
    formTitle.textContent = `Edit Employee: ${e.full_name}`;
    cancelBtn.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelBtn.addEventListener("click", resetForm);

  async function loadBranches() {
    branches = await api.get("/branches");
    renderBranchOptions(null);
  }

  async function loadEmployees() {
    employees = await api.get("/employees");
    const body = document.getElementById("employees-body");
    body.innerHTML = "";
    employees.forEach((e) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(e.full_name)}</td>
        <td>${escapeHtml(e.position) || "—"}</td>
        <td>${escapeHtml(e.branch_name) || "—"}</td>
        <td>${fmtMoney(e.base_salary)}</td>
        <td>${e.is_active ? "Active" : "Disabled"}</td>
        <td>${e.has_login ? '<span class="badge admin">Has login</span>' : '<span class="badge">None</span>'}</td>
        <td class="actions-cell">
          <button data-edit="${e.id}" class="secondary">Edit</button>
          <button data-delete="${e.id}" class="danger">Delete</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const e = employees.find((x) => x.id === Number(btn.dataset.edit));
        if (e) fillForm(e);
      })
    );
    body.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this employee?")) return;
        try {
          await api.del(`/employees/${btn.dataset.delete}`);
          showMsg("Employee deleted", "success");
          loadEmployees();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("employee-id").value;
    const payload = {
      full_name: document.getElementById("full_name").value,
      position: document.getElementById("position").value || null,
      phone: document.getElementById("phone").value || null,
      branch_id: Number(document.getElementById("branch_id").value),
      base_salary: Number(document.getElementById("base_salary").value || 0),
    };

    try {
      if (id) {
        await api.put(`/employees/${id}`, payload);
        showMsg("Employee updated", "success");
      } else {
        await api.post("/employees", payload);
        showMsg("Employee registered", "success");
      }
      resetForm();
      loadEmployees();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-employees-btn").addEventListener("click", () => {
    exportCSV(
      "employees.csv",
      [
        { key: "full_name", label: "Full Name" },
        { key: "position", label: "Position" },
        { key: "branch_name", label: "Branch" },
        { key: "base_salary", label: "Base Salary" },
        { key: "status", label: "Status" },
      ],
      employees.map((e) => ({ ...e, status: e.is_active ? "Active" : "Disabled" }))
    );
  });

  (async () => {
    try {
      await loadBranches();
      await loadEmployees();
    } catch (err) {
      showMsg(err.message, "error");
    }
  })();
})();
