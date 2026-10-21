export async function apiRequest(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const headers = {
    ...(isStateChanging || options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const body = isStateChanging && options.body === undefined ? "{}" : options.body;

  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function fetchSavedMixes() {
  const data = await apiRequest("/api/mixes");
  return data.mixes || [];
}

export async function createSavedMix({ name, levels, source = "manual" }) {
  const data = await apiRequest("/api/mixes", {
    method: "POST",
    body: JSON.stringify({ name, levels, source }),
  });
  return data.mix;
}

export async function renameSavedMix(id, name) {
  const data = await apiRequest(`/api/mixes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return data.mix;
}

export async function deleteSavedMix(id) {
  return await apiRequest(`/api/mixes/${id}`, {
    method: "DELETE",
    body: "{}",
  });
}
