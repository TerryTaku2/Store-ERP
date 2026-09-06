(function () {
  const session = requireRole("admin");
  if (!session) return;
  renderSidebar("/business-profile.html");

  const msgBox = document.getElementById("msg-box");
  const form = document.getElementById("profile-form");
  const nameInput = document.getElementById("business-name");
  const fileInput = document.getElementById("logo-file");
  const removeLogoBtn = document.getElementById("remove-logo-btn");
  const logoPreview = document.getElementById("logo-preview");
  const logoPlaceholder = document.getElementById("logo-placeholder");
  const brandPreview = document.getElementById("brand-preview");

  const MAX_LOGO_DIMENSION = 320;
  let pendingLogo = undefined; // undefined = no change, null = remove, string = new data URI
  let displayedLogo = null; // whatever is currently shown in the preview/thumbnail

  function showMsg(text, type) {
    msgBox.innerHTML = `<div class="msg ${type}">${text}</div>`;
    setTimeout(() => (msgBox.innerHTML = ""), 4000);
  }

  function setLogoDisplay(dataUri) {
    displayedLogo = dataUri || null;
    if (dataUri) {
      logoPreview.src = dataUri;
      logoPreview.style.display = "";
      logoPlaceholder.style.display = "none";
      removeLogoBtn.classList.remove("hidden");
    } else {
      logoPreview.style.display = "none";
      logoPlaceholder.style.display = "flex";
      removeLogoBtn.classList.add("hidden");
    }
  }

  function renderBrandPreview(name, logo) {
    brandPreview.innerHTML = `
      <div class="brand" style="background:var(--sidebar-bg);">
        <div class="brand-row">
          ${logo ? `<img src="${logo}" alt="" class="brand-logo" />` : ""}
          <span class="brand-business-name">${escapeHtml(name || "Your Business")}</span>
        </div>
        <span class="brand-powered-by">T-Tech Connect</span>
      </div>`;
  }

  function resizeImageFile(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("That file isn't a readable image"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/png"));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadProfile() {
    const company = await api.get("/company-profile");
    nameInput.value = company.name || "";
    setLogoDisplay(company.logo || null);
    renderBrandPreview(company.name, company.logo);
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const dataUri = await resizeImageFile(file, MAX_LOGO_DIMENSION);
      pendingLogo = dataUri;
      setLogoDisplay(dataUri);
      renderBrandPreview(nameInput.value, dataUri);
    } catch (err) {
      showMsg(err.message, "error");
    } finally {
      fileInput.value = "";
    }
  });

  removeLogoBtn.addEventListener("click", () => {
    pendingLogo = null;
    setLogoDisplay(null);
    renderBrandPreview(nameInput.value, null);
  });

  nameInput.addEventListener("input", () => {
    renderBrandPreview(nameInput.value, displayedLogo);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = { name: nameInput.value.trim() };
    if (pendingLogo !== undefined) payload.logo = pendingLogo;

    try {
      const company = await api.put("/company-profile", payload);
      localStorage.setItem("company_name", company.name || "");
      if (company.logo) {
        localStorage.setItem("company_logo", company.logo);
      } else {
        localStorage.removeItem("company_logo");
      }
      pendingLogo = undefined;
      setLogoDisplay(company.logo || null);
      nameInput.value = company.name || "";
      showMsg("Business profile updated", "success");
      renderSidebar("/business-profile.html");
      renderBrandPreview(company.name, company.logo);
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  loadProfile().catch((err) => showMsg(err.message, "error"));
})();
