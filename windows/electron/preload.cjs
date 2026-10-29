const { contextBridge, ipcRenderer } = require("electron");
const petListeners = new Map();
contextBridge.exposeInMainWorld("qbitPC", Object.freeze({
  isDesktop: true,
  ensureModelFiles: () => ipcRenderer.invoke("qbit:model-ensure"),
  onModelProgress: callback => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("qbit:model-progress", listener);
    return () => ipcRenderer.removeListener("qbit:model-progress", listener);
  },
  openUrl: url => ipcRenderer.invoke("qbit:open-url", url),
  getStatus: () => ipcRenderer.invoke("qbit:status"),
  openApp: name => ipcRenderer.invoke("qbit:open-app", name),
  openFolder: name => ipcRenderer.invoke("qbit:open-folder", name),
  openAnything: query => ipcRenderer.invoke("qbit:open-anything", String(query).slice(0, 180)),
  volume: action => ipcRenderer.invoke("qbit:volume", action),
  runAutomation: name => ipcRenderer.invoke("qbit:automation", name),
  onPetMessage: callback => { if (typeof callback === "function") ipcRenderer.on("qbit:pet-message", (_event, message) => callback(message)); },
  sendPetReply: message => ipcRenderer.send("qbit:pet-reply", String(message).slice(0, 2000)),
  getPetSettings: () => ipcRenderer.invoke("qbit:pet-settings-get"),
  setPetSettings: settings => ipcRenderer.invoke("qbit:pet-settings-set", settings),
  resetPetPosition: () => ipcRenderer.invoke("qbit:pet-position-reset")
}));
contextBridge.exposeInMainWorld("qbitPet", Object.freeze({
  resizePet: expanded => ipcRenderer.invoke("qbit:pet-resize", Boolean(expanded)),
  getPosition: () => ipcRenderer.invoke("qbit:pet-position"),
  moveTo: (x, y) => ipcRenderer.invoke("qbit:pet-move", Number(x), Number(y)),
  showMainWindow: () => ipcRenderer.invoke("qbit:pet-show-main"),
  sendMessage: message => ipcRenderer.invoke("qbit:pet-send-message", String(message).slice(0, 500)),
  onPetReply: callback => { if (typeof callback === "function") ipcRenderer.on("qbit:pet-reply", (_event, message) => callback(message)); },
  hidePet: () => ipcRenderer.invoke("qbit:pet-hide"),
  onPetToggle: callback => {
    if (typeof callback !== "function") return;
    const listener = () => callback();
    ipcRenderer.on("qbit:pet-toggle", listener);
    petListeners.set(callback, ["qbit:pet-toggle", listener]);
  },
  getSettings: () => ipcRenderer.invoke("qbit:pet-settings-get"),
  onPetSettings: callback => {
    if (typeof callback !== "function") return;
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("qbit:pet-settings", listener);
    petListeners.set(callback, ["qbit:pet-settings", listener]);
  },
  onPetState: callback => {
    if (typeof callback !== "function") return;
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("qbit:pet-state", listener);
    petListeners.set(callback, ["qbit:pet-state", listener]);
  },
  removeListener: callback => {
    const item = petListeners.get(callback);
    if (item) {
      ipcRenderer.removeListener(item[0], item[1]);
      petListeners.delete(callback);
    }
  }
}));
