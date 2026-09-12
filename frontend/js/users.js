(function () {
  const session = requireRole("admin");
  if (!session) return;
  renderSidebar("/users.html");

  let users = [];
  let employees = [];
  const msgBox = document.getElementById("msg-box");
  const form = document.getElementById("user-form");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const formTitle = document.getElementById("form-title");
  const passwordHint = document.getElementById("password-hint");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function renderEmployeeOptions(selectedId) {
    const select = document.getElementById("employee_id");
    // An employee that already has a login can't be picked again (except the
    // one currently linked to whichever user is being edited).
    const options = employees.filter((e) => !e.has_login || e.id === selectedId);
    select.innerHTML =
      `<option value="">— None —</option>` +
      options.map((e) => `<option value="${e.id}">${escapeHtml(e.full_name)}${e.branch_name ? ` (${escapeHtml(e.branch_name)})` : ""}</option>`).join("");
    select.value = selectedId || "";
  }

  function resetForm() {
    form.reset();
    document.getElementById("user-id").value = "";
    document.getElementById("username").disabled = false;
    formTitle.textContent = "Add User";
    passwordHint.textContent = "";
    document.getElementById("password").required = true;
    renderEmployeeOptions(null);
    cancelBtn.classList.add("hidden");
  }

  function fillForm(u) {
    document.getElementById("user-id").value = u.id;
    document.getElementById("username").value = u.username;
    document.getElementById("username").disabled = true;
    document.getElementById("full_name").value = u.full_name;
    document.getElementById("role").value = u.role;
    document.getElementById("password").value = "";
    document.getElementById("password").required = false;
    passwordHint.textContent = "(leave blank to keep current password)";
    renderEmployeeOptions(u.employee_id);
    formTitle.textContent = `Edit User: ${u.username}`;
    cancelBtn.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelBtn.addEventListener("click", resetForm);

  async function loadEmployees() {
    employees = await api.get("/employees");
    renderEmployeeOptions(null);
  }

  async function loadUsers() {
    users = await api.get("/users");
    const body = document.getElementById("users-body");
    body.innerHTML = "";
    users.forEach((u) => {
      const employee = employees.find((e) => e.id === u.employee_id);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.full_name)}</td>
        <td><span class="badge ${u.role}">${escapeHtml(u.role)}</span></td>
        <td>${employee ? escapeHtml(employee.full_name) : "—"}</td>
        <td>${u.is_active ? "Active" : "Disabled"}</td>
        <td class="actions-cell">
          <button data-edit="${u.id}" class="secondary">Edit</button>
          <button data-delete="${u.id}" class="danger">Delete</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const u = users.find((x) => x.id === Number(btn.dataset.edit));
        if (u) fillForm(u);
      })
    );
    body.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this user?")) return;
        try {
          await api.del(`/users/${btn.dataset.delete}`);
          showMsg("User deleted", "success");
          loadUsers();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("user-id").value;
    const password = document.getElementById("password").value;
    const employeeIdVal = document.getElementById("employee_id").value;

    try {
      if (id) {
        const payload = {
          full_name: document.getElementById("full_name").value,
          role: document.getElementById("role").value,
          employee_id: employeeIdVal ? Number(employeeIdVal) : null,
        };
        if (password) payload.password = password;
        await api.put(`/users/${id}`, payload);
        showMsg("User updated", "success");
      } else {
        if (!password) return showMsg("Password is required for a new user", "error");
        await api.post("/users", {
          username: document.getElementById("username").value,
          full_name: document.getElementById("full_name").value,
          role: document.getElementById("role").value,
          employee_id: employeeIdVal ? Number(employeeIdVal) : null,
          password,
        });
        showMsg("User created", "success");
      }
      resetForm();
      await loadEmployees();
      loadUsers();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-users-btn").addEventListener("click", () => {
    exportCSV(
      "users.csv",
      [
        { key: "username", label: "Username" },
        { key: "full_name", label: "Full Name" },
        { key: "role", label: "Role" },
        { key: "status", label: "Status" },
      ],
      users.map((u) => ({ ...u, status: u.is_active ? "Active" : "Disabled" }))
    );
  });

  (async () => {
    try {
      await loadEmployees();
      await loadUsers();
    } catch (err) {
      showMsg(err.message, "error");
    }
  })();
})();
