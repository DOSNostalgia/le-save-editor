// Preload: expose API to renderer via window.api
// Since contextIsolation is false, we can use direct assignment.

async function api(path, options = {}) {
  const url = `http://127.0.0.1:17345${path}`;
  const method = options.method || "GET";
  const headers = options.body ? { "Content-Type": "application/json" } : {};
  const resp = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

window.api = {
  health: () => api("/api/health"),
  listCharacters: () => api("/api/characters"),
  characterInfo: (slot) => api(`/api/character/${slot}`),
  editCharacter: (slot, edits) => api(`/api/character/${slot}/edit`, { method: "POST", body: edits }),
  unlockWaypoints: (slot) => api(`/api/character/${slot}/unlock-waypoints`, { method: "POST", body: {} }),
  characterItems: (slot) => api(`/api/character/${slot}/items`),
  itemInfo: (slot, index) => api(`/api/character/${slot}/items/${index}`),
  editItem: (slot, index, edits) => api(`/api/character/${slot}/items/${index}`, { method: "POST", body: edits }),
  addItem: (slot, req) => api(`/api/character/${slot}/items/add`, { method: "POST", body: req }),
  stashInfo: () => api("/api/stash"),
  editStash: (edits) => api("/api/stash/edit", { method: "POST", body: edits }),
  backupSlot: (slot) => api(`/api/backup/${slot}`, { method: "POST" }),
  backupAll: () => api("/api/backup-all", { method: "POST" }),
  search: (kind, q, limit = 20) => api(`/api/search?kind=${kind}&q=${encodeURIComponent(q)}&limit=${limit}`),
  stashKeys: () => api("/api/stash/keys"),
  editKeys: (edits) => api("/api/stash/keys", { method: "POST", body: edits }),
  keyTypes: () => api("/api/key-types"),
};