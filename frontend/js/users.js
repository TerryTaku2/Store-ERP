(function () {
  const session = requireRole("admin");
  if (!session) return;
  renderSidebar("/users.html");

  let users = [];
  const msgBox = document.getElementById("msg-box");
  const form = document.getElementById("user-form");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const formTitle = document.getElementById("form-title");
  const passwordHint = document.getElementById("password-hint");

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function resetForm() {
    form.reset();
    document.getElementById("user-id").value = "";
    document.getElementById("username").disabled = false;
    document.getElementById("base_salary").value = 0;
    formTitle.textContent = "Add User";
    passwordHint.textContent = "";
    document.getElementById("password").required = true;
    cancelBtn.classList.add("hidden");
  }

  function fillForm(u) {
    document.getElementById("user-id").value = u.id;
    document.getElementById("username").value = u.username;
    document.getElementById("username").disabled = true;
    document.getElementById("full_name").value = u.full_name;
    document.getElementById("role").value = u.role;
    document.getElementById("base_salary").value = u.base_salary;
    document.getElementById("password").value = "";
    document.getElementById("password").required = false;
    passwordHint.textContent = "(leave blank to keep current password)";
    formTitle.textContent = `Edit User: ${u.username}`;
    cancelBtn.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelBtn.addEventListener("click", resetForm);

  async function loadUsers() {
    users = await api.get("/users");
    const body = document.getElementById("users-body");
    body.innerHTML = "";
    users.forEach((u) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.full_name)}</td>
        <td><span class="badge ${u.role}">${escapeHtml(u.role)}</span></td>
        <td>${fmtMoney(u.base_salary)}</td>
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

    try {
      if (id) {
        const payload = {
          full_name: document.getElementById("full_name").value,
          role: document.getElementById("role").value,
          base_salary: Number(document.getElementById("base_salary").value || 0),
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
          base_salary: Number(document.getElementById("base_salary").value || 0),
          password,
        });
        showMsg("User created", "success");
      }
      resetForm();
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
        { key: "base_salary", label: "Base Salary" },
        { key: "status", label: "Status" },
      ],
      users.map((u) => ({ ...u, status: u.is_active ? "Active" : "Disabled" }))
    );
  });

  loadUsers().catch((err) => showMsg(err.message, "error"));
})();
