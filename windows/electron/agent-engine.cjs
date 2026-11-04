"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class AgentEngine {
  constructor({ dataPath, runAI, onUpdate = () => {}, onAction }) {
    this.file = dataPath;
    this.runAI = runAI;
    this.onUpdate = onUpdate;
    this.onAction = onAction;
    this.state = { bots: [], tasks: [], logs: [] };
    this.timer = null;
    this.busy = new Set();
    this.load();
  }
  id() { return crypto.randomUUID(); }
  load() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.state = {
        bots: Array.isArray(value.bots) ? value.bots : [],
        tasks: Array.isArray(value.tasks) ? value.tasks : [],
        logs: Array.isArray(value.logs) ? value.logs.slice(-500) : []
      };
    } catch {}
    if (!this.state.bots.length) {
      const now = new Date().toISOString();
      this.state.bots.push({ id: this.id(), name: "QBIT", instructions: "Sos el agente principal de QBIT. Trabajá con cuidado, informá tus avances y no afirmes haber realizado acciones que no se ejecutaron.", createdAt: now, enabled: true });
      this.save();
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temp, this.file);
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  log(botId, taskId, level, message) {
    this.state.logs.push({ id: this.id(), botId, taskId, level, message: String(message).slice(0, 5000), at: new Date().toISOString() });
    this.state.logs = this.state.logs.slice(-500);
    this.save();
    this.onUpdate(this.snapshot());
  }
  createBot(input = {}) {
    const name = String(input.name || "").trim().slice(0, 60);
    if (!name) throw new Error("El bot necesita un nombre.");
    const bot = { id: this.id(), name, instructions: String(input.instructions || "").slice(0, 6000), createdAt: new Date().toISOString(), enabled: true };
    this.state.bots.push(bot); this.save(); this.onUpdate(this.snapshot()); return bot;
  }
  updateBot(id, patch = {}) {
    const bot = this.state.bots.find(x => x.id === id);
    if (!bot) throw new Error("No encontré ese bot.");
    if (patch.name !== undefined) { const name = String(patch.name).trim().slice(0,60); if (!name) throw new Error("El nombre no puede quedar vacío."); bot.name = name; }
    if (patch.instructions !== undefined) bot.instructions = String(patch.instructions).slice(0,6000);
    if (patch.enabled !== undefined) bot.enabled = !!patch.enabled;
    this.save(); this.onUpdate(this.snapshot()); return bot;
  }
  deleteBot(id) {
    if (this.state.bots.length < 2) throw new Error("Tiene que quedar al menos un bot.");
    this.state.bots = this.state.bots.filter(x => x.id !== id);
    this.state.tasks = this.state.tasks.filter(x => x.botId !== id);
    this.save(); this.onUpdate(this.snapshot()); return this.snapshot();
  }
  createTask(input = {}) {
    const bot = this.state.bots.find(x => x.id === input.botId);
    if (!bot) throw new Error("Elegí un bot válido.");
    const title = String(input.title || "").trim().slice(0,100);
    const objective = String(input.objective || "").trim().slice(0,5000);
    if (!title || !objective) throw new Error("La tarea necesita un título y un objetivo.");
    const trigger = input.trigger === "interval" ? "interval" : "manual";
    const intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(input.intervalMinutes) || 30)));
    const now = Date.now();
    const task = { id: this.id(), botId: bot.id, title, objective, trigger, intervalMinutes, status: "active", createdAt: new Date(now).toISOString(), nextRunAt: trigger === "interval" ? new Date(now + intervalMinutes * 60000).toISOString() : null, lastRunAt: null };
    this.state.tasks.push(task); this.save(); this.onUpdate(this.snapshot()); return task;
  }
  setTaskState(id, status) {
    const task = this.state.tasks.find(x => x.id === id);
    if (!task) throw new Error("No encontré esa tarea.");
    if (!["active","paused","stopped"].includes(status)) throw new Error("Estado no válido.");
    task.status = status;
    if (status === "active" && task.trigger === "interval" && !task.nextRunAt) task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
    this.save(); this.onUpdate(this.snapshot()); return task;
  }
  async runTask(taskId) {
    const task = this.state.tasks.find(x => x.id === taskId);
    if (!task || task.status !== "active" || this.busy.has(taskId)) return;
    const bot = this.state.bots.find(x => x.id === task.botId);
    if (!bot || !bot.enabled) return;
    this.busy.add(taskId);
    task.lastRunAt = new Date().toISOString();
    if (task.trigger === "interval") task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
    this.save(); this.onUpdate(this.snapshot());
    this.log(bot.id, task.id, "info", "Iniciando tarea: " + task.title);
    try {
      const prompt = [
        "Sos el agente persistente " + bot.name + " dentro de QBIT.",
        "INSTRUCCIONES DEL BOT:\n" + (bot.instructions || "Trabajá con cuidado y explicá lo que hacés."),
        "OBJETIVO DE LA TAREA:\n" + task.objective,
        "Esta es una ejecución autónoma de una tarea guardada. Usá únicamente herramientas QBIT disponibles mediante bloques qbit cuando sean necesarias. No afirmes que hiciste algo si no se ejecutó. Pedí confirmación cuando una acción requiera permiso o el objetivo sea ambiguo.",
        "Informá brevemente qué comprobaste, qué acciones realizaste y qué queda pendiente."
      ].join("\n\n");
      const result = await this.runAI(prompt, { bot, task });
      const answer = String(result?.answer || result || "La IA no devolvió contenido.");
      const blocks = [...answer.matchAll(/```qbit\s*([\s\S]*?)```/gi)];
      let report = answer.replace(/```qbit\s*[\s\S]*?```/gi, "").trim();
      for (const match of blocks) {
        let call;
        try { call = JSON.parse(match[1]); } catch { report += "\nBloque QBIT inválido; no se ejecutó."; continue; }
        if (!call || typeof call.artifact !== "string") continue;
        const actionResult = await this.onAction({ botId: bot.id, taskId: task.id, call });
        report += "\n" + String(actionResult || "Acción procesada.");
      }
      this.log(bot.id, task.id, "success", report || "Ejecución completada.");
    } catch (error) {
      if (task.trigger === "interval" && task.status === "active") task.nextRunAt = new Date(Date.now() + 60000).toISOString();
      this.log(bot.id, task.id, "error", error?.message || "No se pudo ejecutar la tarea.");
    } finally {
      this.busy.delete(taskId);
      this.save(); this.onUpdate(this.snapshot());
    }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const task of this.state.tasks) {
        if (task.status === "active" && task.trigger === "interval" && task.nextRunAt && Date.parse(task.nextRunAt) <= now) void this.runTask(task.id);
      }
    }, 5000);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.save(); }
  runNow(id) { return this.runTask(id); }
}
module.exports = { AgentEngine };
