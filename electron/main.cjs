const { app, BrowserWindow, ipcMain, shell } = require("electron");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

let mainWindow;

function runWindowsCommand(file, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("La operación tardó demasiado.")); }, timeout);
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(stdout.trim()); else reject(new Error(stderr.trim() || "Windows devolvió un error.")); });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 560,
    backgroundColor: "#07111f", title: "QBIT — Asistente personal",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
}

const allowedApps = {
  "calculadora": { file: "calc.exe", args: [] },
  "bloc de notas": { file: "notepad.exe", args: [] },
  "paint": { file: "mspaint.exe", args: [] },
  "administrador de tareas": { file: "taskmgr.exe", args: [] },
  "explorador": { file: "explorer.exe", args: [] }
};
const knownFolders = {
  "inicio": () => app.getPath("home"),
  "documentos": () => app.getPath("documents"),
  "descargas": () => path.join(app.getPath("home"), "Downloads"),
  "escritorio": () => app.getPath("desktop"),
  "imagenes": () => app.getPath("pictures"),
  "musica": () => app.getPath("music"),
  "videos": () => app.getPath("videos")
};

ipcMain.handle("qbit:open-url", async (_event, rawUrl) => {
  if (typeof rawUrl !== "string") throw new Error("Dirección web inválida.");
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error("La dirección web no es válida."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Solo se pueden abrir direcciones HTTP o HTTPS.");
  await shell.openExternal(parsed.href);
  return { ok: true };
});

ipcMain.handle("qbit:status", async () => {
  const cpus = os.cpus();
  const batteryText = await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining) -join ''"], 5000).catch(() => "");
  const batteryPercent = /^\d{1,3}$/.test(batteryText) ? Number(batteryText) : null;
  return { os: os.type() + " " + os.release(), computer: os.hostname(), cpu: cpus[0]?.model || "No disponible", logicalProcessors: cpus.length, ramTotalGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)), ramFreeGB: Number((os.freemem() / 1024 ** 3).toFixed(1)), uptimeHours: Number((os.uptime() / 3600).toFixed(1)), batteryPercent };
});

ipcMain.handle("qbit:open-app", async (_event, appName) => {
  if (typeof appName !== "string") throw new Error("Nombre de aplicación inválido.");
  const key = appName.toLocaleLowerCase("es").trim();
  const appSpec = allowedApps[key];
  if (!appSpec) throw new Error("Esa aplicación no está en la lista permitida.");
  const child = spawn(appSpec.file, appSpec.args, { detached: true, stdio: "ignore", shell: false, windowsHide: false });
  child.on("error", () => {}); child.unref();
  return { ok: true, message: "Abriendo " + key + "." };
});

ipcMain.handle("qbit:open-folder", async (_event, folderName) => {
  if (typeof folderName !== "string") throw new Error("Carpeta inválida.");
  const key = folderName.toLocaleLowerCase("es").trim();
  const getPath = knownFolders[key];
  if (!getPath) throw new Error("Esa carpeta no está en la lista permitida.");
  const error = await shell.openPath(getPath());
  if (error) throw new Error(error);
  return { ok: true, message: "Abriendo " + key + "." };
});

ipcMain.handle("qbit:volume", async (_event, action) => {
  if (!["up", "down", "mute"].includes(action)) throw new Error("Acción de volumen no permitida.");
  const virtualKey = action === "up" ? 0xAF : action === "down" ? 0xAE : 0xAD;
  const script = "$src = 'using System; using System.Runtime.InteropServices; public static class QbitNativeKeys { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }'; Add-Type -TypeDefinition $src; [QbitNativeKeys]::keybd_event(" + virtualKey + ",0,0,0)";
  await runWindowsCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
  return { ok: true, message: action === "up" ? "Subiendo el volumen." : action === "down" ? "Bajando el volumen." : "Alternando silencio." };
});

ipcMain.handle("qbit:automation", async (_event, taskName) => {
  if (taskName !== "study") throw new Error("Automatización desconocida.");
  for (const file of ["calc.exe", "notepad.exe"]) { const child = spawn(file, [], { detached: true, stdio: "ignore", shell: false }); child.on("error", () => {}); child.unref(); }
  const error = await shell.openPath(app.getPath("documents"));
  if (error) throw new Error(error);
  return { ok: true, message: "Preparé el entorno de estudio: calculadora, Bloc de notas y Documentos." };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
