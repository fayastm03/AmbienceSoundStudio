// Accessible Toast Notification Stack (up to 3 toasts, 4s auto-dismiss, manual dismiss)

let region;
const MAX_TOASTS = 3;
const TOAST_DURATION_MS = 4000;

export function showToast(message) {
  if (!region) {
    region = document.querySelector("#toastRegion");
  }
  if (!region) return;

  // Enforce maximum 3 toasts
  while (region.children.length >= MAX_TOASTS) {
    dismissToast(region.firstElementChild, true);
  }

  const toast = document.createElement("div");
  toast.className = "toast-item";
  toast.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss notification");
  closeBtn.textContent = "×";

  toast.appendChild(text);
  toast.appendChild(closeBtn);

  let timer = setTimeout(() => {
    dismissToast(toast);
  }, TOAST_DURATION_MS);

  closeBtn.addEventListener("click", () => {
    clearTimeout(timer);
    dismissToast(toast);
  });

  toast.addEventListener("click", (event) => {
    if (event.target !== closeBtn) {
      clearTimeout(timer);
      dismissToast(toast);
    }
  });

  region.appendChild(toast);
}

function dismissToast(toast, immediate = false) {
  if (!toast || toast._isDismissing) return;
  toast._isDismissing = true;

  if (immediate) {
    toast.remove();
    return;
  }

  toast.classList.add("toast-out");
  setTimeout(() => {
    toast.remove();
  }, 220);
}

export function bindToast() {
  region = document.querySelector("#toastRegion");
}
