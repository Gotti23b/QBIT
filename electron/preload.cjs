const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("qbitPC", Object.freeze({
  isDesktop: true,
  getStatus: () => ipcRenderer.invoke("qbit:status"),
  openApp: name => ipcRenderer.invoke("qbit:open-app", name),
  openFolder: name => ipcRenderer.invoke("qbit:open-folder", name),
  volume: action => ipcRenderer.invoke("qbit:volume", action),
  runAutomation: name => ipcRenderer.invoke("qbit:automation", name)
}));
