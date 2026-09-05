const NAV_SECTIONS = [
  {
    label: "Overview",
    links: [
      { href: "/dashboard.html", label: "Dashboard", icon: "grid", roles: ["admin", "manager", "cashier"] },
    ],
  },
  {
    label: "Store Operations",
    links: [
      { href: "/sales.html", label: "Sales", icon: "shopping-cart", roles: ["admin", "manager", "cashier"] },
      { href: "/inventory.html", label: "Inventory", icon: "package", roles: ["admin", "manager", "cashier"] },
      { href: "/purchases.html", label: "Purchases", icon: "arrow-down-circle", roles: ["admin", "manager"] },
    ],
  },
  {
    label: "Finance",
    links: [
      { href: "/expenses.html", label: "Expenses", icon: "credit-card", roles: ["admin", "manager"] },
      { href: "/reports.html", label: "Reports", icon: "bar-chart-2", roles: ["admin", "manager"] },
    ],
  },
  {
    label: "Admin",
    links: [
      { href: "/branches.html", label: "Branches", icon: "git-branch", roles: ["admin"], adminBranchOnly: true },
      { href: "/users.html", label: "User Management", icon: "settings", roles: ["admin"], adminBranchOnly: true },
      { href: "/audit-log.html", label: "Audit Log", icon: "activity", roles: ["admin"] },
      { href: "/companies.html", label: "Companies", icon: "briefcase", roles: ["admin"], platformAdminOnly: true },
    ],
  },
];

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallUI();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallUI();
});

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandaloneDisplay() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function updateInstallUI() {
  const installBtn = document.getElementById("install-app-btn");
  const iosHint = document.getElementById("install-ios-hint");
  if (!installBtn || !iosHint) return;
  installBtn.classList.toggle("hidden", !deferredInstallPrompt);
  iosHint.classList.toggle("hidden", !(isIos() && !isStandaloneDisplay() && !deferredInstallPrompt));
}

const THEME_OPTIONS = [
  { value: "dark-engineering", label: "Dark Engineering" },
  { value: "warm-minimal", label: "Warm Minimal" },
  { value: "high-contrast", label: "High Contrast" },
];

function requireAuth() {
  const session = getSession();
  if (!session.token) {
    window.location.href = "/index.html";
    return null;
  }
  if (session.isPlatformAdmin && !session.branchId && !window.location.pathname.startsWith("/companies")) {
    window.location.href = "/companies.html";
    return null;
  }
  return session;
}

function requireRole(...roles) {
  const session = requireAuth();
  if (!session) return null;
  if (!roles.includes(session.role)) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;">' +
      "<h2>403 - Access denied</h2>" +
      '<p>You do not have permission to view this page. <a href="/dashboard.html">Back to dashboard</a></p>' +
      "</div>";
    throw new Error("forbidden");
  }
  return session;
}

function logout() {
  clearSession();
  window.location.href = "/index.html";
}

function renderSidebar(activeHref) {
  const session = getSession();
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const sections = NAV_SECTIONS.map((section) => {
    const links = section.links.filter(
      (l) =>
        l.roles.includes(session.role) &&
        (!l.adminBranchOnly || session.isAdminBranch) &&
        (!l.platformAdminOnly || session.isPlatformAdmin)
    );
    if (links.length === 0) return "";
    const items = links
      .map(
        (l) =>
          `<a href="${l.href}" class="nav-item ${l.href === activeHref ? "active" : ""}">` +
          `<i data-feather="${l.icon}"></i> ${l.label}</a>`
      )
      .join("");
    return `<div class="nav-section"><div class="nav-section-label">${section.label}</div>${items}</div>`;
  }).join("");

  const branches = session.branches || [];
  const branchSwitcher = branches.length > 1
    ? `<select class="branch-switcher" id="branch-switcher">` +
      branches
        .map(
          (b) => `<option value="${b.id}" ${b.id === session.branchId ? "selected" : ""}>${escapeHtml(b.name)}</option>`
        )
        .join("") +
      `</select>`
    : "";

  const demoBanner = session.isDemo
    ? `<div class="demo-banner">Demo Mode — resets each session</div>`
    : "";

  const themeSwitcher = `<select class="branch-switcher" id="theme-switcher" style="margin-top:8px;" aria-label="Theme">` +
    THEME_OPTIONS.map((t) => `<option value="${t.value}" ${t.value === session.theme ? "selected" : ""}>${t.label}</option>`).join("") +
    `</select>`;

  container.innerHTML = `
    <div class="sidebar" id="sidebar">
      ${demoBanner}
      <div class="brand">T-Tech Connect${session.companyName ? `<span class="brand-business">${escapeHtml(session.companyName)}</span>` : ""}</div>
      <nav>${sections}</nav>
      <div class="user-box">
        <div>${escapeHtml(session.fullName) || escapeHtml(session.username) || ""}</div>
        <span class="role-badge">${escapeHtml(session.role) || ""}</span>
        <div style="margin-top:6px;font-size:0.75rem;color:var(--sidebar-text);">${escapeHtml(session.branchName) || ""}</div>
        ${branchSwitcher}
        ${themeSwitcher}
        <button class="logout-btn hidden" id="install-app-btn" style="margin-top:8px;">Install App</button>
        <div class="hidden" id="install-ios-hint" style="margin-top:8px;font-size:0.72rem;color:var(--sidebar-text);line-height:1.4;">Install: tap Share, then "Add to Home Screen".</div>
        <button class="logout-btn" id="change-password-btn" style="margin-top:8px;">Change Password</button>
        <button class="logout-btn" onclick="logout()">Log out</button>
      </div>
    </div>
  `;

  updateInstallUI();

  document.getElementById("install-app-btn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallUI();
  });

  const switcher = document.getElementById("branch-switcher");
  if (switcher) {
    switcher.addEventListener("change", async () => {
      try {
        const data = await api.post("/auth/switch-branch", { branch_id: Number(switcher.value) });
        storeSession(data);
        window.location.href = "/dashboard.html";
      } catch (err) {
        alert(err.message || "Could not switch branch");
      }
    });
  }

  document.getElementById("theme-switcher").addEventListener("change", async (e) => {
    const theme = e.target.value;
    const previous = session.theme;
    applyTheme(theme);
    try {
      await api.put("/auth/me/theme", { theme });
    } catch (err) {
      applyTheme(previous);
      e.target.value = previous;
      alert(err.message || "Could not save theme preference");
    }
  });

  document.getElementById("change-password-btn").addEventListener("click", openChangePasswordModal);

  setupMobileSidebarToggle();

  if (window.feather) feather.replace();
}

function _ensurePasswordModal() {
  if (document.getElementById("password-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "password-modal";
  overlay.className = "modal-overlay hidden";
  overlay.innerHTML = `
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;">Change Password</h3>
        <button type="button" class="secondary" id="password-modal-close">Close</button>
      </div>
      <div id="password-modal-error" class="msg error hidden"></div>
      <form id="password-modal-form">
        <div class="field">
          <label>Current Password</label>
          <input type="password" id="pw-current" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label>New Password</label>
          <input type="password" id="pw-new" autocomplete="new-password" minlength="6" required />
        </div>
        <div class="field">
          <label>Confirm New Password</label>
          <input type="password" id="pw-confirm" autocomplete="new-password" minlength="6" required />
        </div>
        <button type="submit">Save New Password</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("password-modal-close").addEventListener("click", () => overlay.classList.add("hidden"));

  document.getElementById("password-modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("password-modal-error");
    errorBox.classList.add("hidden");

    const current_password = document.getElementById("pw-current").value;
    const new_password = document.getElementById("pw-new").value;
    const confirm = document.getElementById("pw-confirm").value;

    if (new_password !== confirm) {
      errorBox.textContent = "New passwords do not match";
      errorBox.classList.remove("hidden");
      return;
    }

    try {
      await api.put("/auth/me/password", { current_password, new_password });
      overlay.classList.add("hidden");
      document.getElementById("password-modal-form").reset();
      alert("Password changed successfully");
    } catch (err) {
      errorBox.textContent = err.message || "Could not change password";
      errorBox.classList.remove("hidden");
    }
  });
}

function openChangePasswordModal() {
  _ensurePasswordModal();
  document.getElementById("password-modal-error").classList.add("hidden");
  document.getElementById("password-modal-form").reset();
  document.getElementById("password-modal").classList.remove("hidden");
}

function setupMobileSidebarToggle() {
  if (document.getElementById("sidebar-toggle-btn")) return;

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.id = "sidebar-toggle-btn";
  toggleBtn.className = "menu-toggle";
  toggleBtn.setAttribute("aria-label", "Toggle navigation");
  toggleBtn.innerHTML = '<i data-feather="menu"></i>';
  document.body.appendChild(toggleBtn);

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.id = "sidebar-overlay";
  document.body.appendChild(overlay);

  function closeSidebar() {
    document.getElementById("sidebar")?.classList.remove("open");
    overlay.classList.remove("show");
    toggleBtn.classList.remove("hide-when-open");
  }

  toggleBtn.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
    overlay.classList.toggle("show");
    toggleBtn.classList.toggle("hide-when-open");
  });
  overlay.addEventListener("click", closeSidebar);
  document.querySelectorAll(".sidebar nav a").forEach((a) => a.addEventListener("click", closeSidebar));
}

async function handleLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById("login-error");
    errorBox.classList.add("hidden");

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    const body = new URLSearchParams();
    body.set("username", username);
    body.set("password", password);

    try {
      const data = await apiRequest("/auth/login", { method: "POST", body, form: true });
      storeSession(data);
      window.location.href = data.is_platform_admin && !data.branch_id ? "/companies.html" : "/dashboard.html";
    } catch (err) {
      errorBox.textContent = err.message || "Login failed";
      errorBox.classList.remove("hidden");
    }
  });
}

function handleDemoLoginButton() {
  const btn = document.getElementById("demo-login-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const errorBox = document.getElementById("login-error");
    errorBox.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Starting demo…";
    try {
      const data = await api.post("/auth/demo-login");
      storeSession(data);
      window.location.href = "/dashboard.html";
    } catch (err) {
      errorBox.textContent = err.message || "Could not start demo";
      errorBox.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "Try the Demo";
    }
  });
}

function handleForgotPasswordLink() {
  const link = document.getElementById("forgot-password-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("forgot-password-msg").classList.toggle("hidden");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("login-form")) {
    if (getToken()) {
      window.location.href = "/dashboard.html";
    } else {
      handleLoginForm();
      handleDemoLoginButton();
      handleForgotPasswordLink();
    }
  }
});
