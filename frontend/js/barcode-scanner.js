let _html5QrCode = null;

function _ensureScannerModal() {
  if (document.getElementById("scanner-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "scanner-modal";
  overlay.className = "modal-overlay hidden";
  overlay.innerHTML = `
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;">Scan Barcode</h3>
        <button type="button" class="secondary" id="scanner-close-btn">Close</button>
      </div>
      <div id="qr-reader"></div>
      <div id="scanner-status" class="msg error hidden" style="margin-top:10px;"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("scanner-close-btn").addEventListener("click", closeCameraScanner);
}

function closeCameraScanner() {
  const modal = document.getElementById("scanner-modal");
  if (modal) modal.classList.add("hidden");
  if (_html5QrCode) {
    const instance = _html5QrCode;
    _html5QrCode = null;
    instance.stop().then(() => instance.clear()).catch(() => {});
  }
}

async function openCameraScanner(onResult) {
  if (typeof Html5Qrcode === "undefined") {
    alert("Camera scanning library failed to load — check your internet connection and try again.");
    return;
  }
  if (!window.isSecureContext) {
    alert(
      "Camera access requires a secure connection (HTTPS or localhost). " +
      "This page was loaded over plain HTTP from a non-local address, so the browser will block the camera."
    );
    return;
  }

  _ensureScannerModal();
  const modal = document.getElementById("scanner-modal");
  const statusBox = document.getElementById("scanner-status");
  modal.classList.remove("hidden");
  statusBox.classList.add("hidden");

  _html5QrCode = new Html5Qrcode("qr-reader");
  let handled = false;

  try {
    await _html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (decodedText) => {
        if (handled) return;
        handled = true;
        onResult(decodedText);
        closeCameraScanner();
      },
      () => {}
    );
  } catch (err) {
    statusBox.textContent =
      "Could not access camera: " + (err.message || err) + ". Check camera permissions for this site.";
    statusBox.classList.remove("hidden");
  }
}
