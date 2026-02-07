import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aegis", {
  start: () => ipcRenderer.invoke("aegis:start"),
  stop: () => ipcRenderer.invoke("aegis:stop"),
  status: () => ipcRenderer.invoke("aegis:status"),
  setupStatus: () => ipcRenderer.invoke("aegis:setup:status"),
  onboard: (payload) => ipcRenderer.invoke("aegis:onboard", payload),
  openDashboard: () => ipcRenderer.invoke("aegis:open-dashboard"),
  assetsStatus: () => ipcRenderer.invoke("aegis:assets:status"),
  downloadBrowserAssets: () => ipcRenderer.invoke("aegis:assets:download"),
  updateProvider: (payload) => ipcRenderer.invoke("aegis:update-provider", payload),
  metrics: () => ipcRenderer.invoke("aegis:metrics"),
  models: () => ipcRenderer.invoke("aegis:models"),
  logPath: () => ipcRenderer.invoke("aegis:log-path"),
  openLog: () => ipcRenderer.invoke("aegis:log-open"),
  openLogFolder: () => ipcRenderer.invoke("aegis:log-open-folder"),
  policyStatus: () => ipcRenderer.invoke("aegis:policy:get"),
  policyUpdate: (payload) => ipcRenderer.invoke("aegis:policy:set", payload),
  openPolicyFile: () => ipcRenderer.invoke("aegis:policy:open"),
  openPolicyFolder: () => ipcRenderer.invoke("aegis:policy:open-folder"),
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("aegis:log", listener);
    return () => ipcRenderer.removeListener("aegis:log", listener);
  },
  onAssetsStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("aegis:assets:status", listener);
    return () => ipcRenderer.removeListener("aegis:assets:status", listener);
  },
});
