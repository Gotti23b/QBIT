const { contextBridge, ipcRenderer } = require("electron");
const petListeners = new Map();
contextBridge.exposeInMainWorld("qbitPC", Object.freeze({
  isDesktop: true,
  openUrl: url => ipcRenderer.invoke("qbit:open-url", url),
  getStatus: () => ipcRenderer.invoke("qbit:status"),
  openApp: name => ipcRenderer.invoke("qbit:open-app", name),
  openFolder: name => ipcRenderer.invoke("qbit:open-folder", name),
  volume: action => ipcRenderer.invoke("qbit:volume", action),
  runAutomation: name => ipcRenderer.invoke("qbit:automation", name),
  onPetMessage: callback => { if (typeof callback === "function") ipcRenderer.on("qbit:pet-message", (_event, message) => callback(message)); },
  sendPetReply: message => ipcRenderer.send("qbit:pet-reply", String(message).slice(0, 2000))
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
