(function () {
  const session = requireRole("admin", "manager");
  if (!session) return;
  renderSidebar("/expenses.html");

  let expenses = [];
  const msgBox = document.getElementById("msg-box");
  const form = document.getElementById("expense-form");
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const formTitle = document.getElementById("form-title");

  document.getElementById("expense_date").value = new Date().toISOString().slice(0, 10);

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function resetForm() {
    form.reset();
    document.getElementById("expense-id").value = "";
    document.getElementById("expense_date").value = new Date().toISOString().slice(0, 10);
    formTitle.textContent = "Add Expense";
    cancelBtn.classList.add("hidden");
  }

  function fillForm(x) {
    document.getElementById("expense-id").value = x.id;
    document.getElementById("category").value = x.category;
    document.getElementById("amount").value = x.amount;
    document.getElementById("expense_date").value = x.expense_date;
    document.getElementById("description").value = x.description || "";
    formTitle.textContent = "Edit Expense";
    cancelBtn.classList.remove("hidden");
  }

  cancelBtn.addEventListener("click", resetForm);

  async function loadExpenses() {
    expenses = await api.get("/expenses");
    const body = document.getElementById("expenses-body");
    body.innerHTML = "";
    if (expenses.length === 0) {
      body.innerHTML = '<tr><td colspan="5">No expenses recorded</td></tr>';
      return;
    }
    expenses.forEach((x) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${x.expense_date}</td>
        <td>${x.category}</td>
        <td>${x.description || "-"}</td>
        <td>${fmtMoney(x.amount)}</td>
        <td class="actions-cell">
          <button data-edit="${x.id}" class="secondary">Edit</button>
          <button data-delete="${x.id}" class="danger">Delete</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const x = expenses.find((e) => e.id === Number(btn.dataset.edit));
        if (x) fillForm(x);
      })
    );
    body.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this expense?")) return;
        try {
          await api.del(`/expenses/${btn.dataset.delete}`);
          showMsg("Expense deleted", "success");
          loadExpenses();
        } catch (err) {
          showMsg(err.message, "error");
        }
      })
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("expense-id").value;
    const payload = {
      category: document.getElementById("category").value,
      amount: Number(document.getElementById("amount").value),
      expense_date: document.getElementById("expense_date").value,
      description: document.getElementById("description").value || null,
    };
    try {
      if (id) {
        await api.put(`/expenses/${id}`, payload);
        showMsg("Expense updated", "success");
      } else {
        await api.post("/expenses", payload);
        showMsg("Expense recorded", "success");
      }
      resetForm();
      loadExpenses();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("export-expenses-btn").addEventListener("click", () => {
    exportCSV(
      "expenses.csv",
      [
        { key: "expense_date", label: "Date" },
        { key: "category", label: "Category" },
        { key: "description", label: "Description" },
        { key: "amount", label: "Amount" },
      ],
      expenses
    );
  });

  loadExpenses().catch((err) => showMsg(err.message, "error"));
})();
