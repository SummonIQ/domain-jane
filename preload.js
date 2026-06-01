const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("domainJane", {
  lookupDomain: (query) => ipcRenderer.invoke("domains:lookup", query),
  suggestDomains: (query) => ipcRenderer.invoke("domains:suggest", query),
  generateAiIdeas: (query) => ipcRenderer.invoke("domains:ai-ideas", query),
  listFavorites: () => ipcRenderer.invoke("favorites:list"),
  addFavorite: (record) => ipcRenderer.invoke("favorites:add", record),
  removeFavorite: (domain) => ipcRenderer.invoke("favorites:remove", domain),
  refreshFavorites: () => ipcRenderer.invoke("favorites:refresh")
});
