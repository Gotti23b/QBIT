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
      for (const task of this.state.tasks) {
        if (!["manual", "interval", "once"].includes(task.trigger)) task.trigger = "manual";
        if (!["active", "paused", "stopped", "completed"].includes(task.status)) task.status = "active";
        task.intervalMinutes = Math.max(1, Math.min(10080, Number(task.intervalMinutes) || 30));
      }
    } catch {}
    if (!this.state.bots.length) {
      const now = new Date().toISOString();
      this.state.bots.push({ id: this.id(), name: "QBIT", instructions: "Sos el agente principal de QBIT. Trabajá con cuidado, informá tus avances y no afirmes haber realizado acciones que no se ejecutaron.", createdAt: now, enabled: true });
    }
    this.save();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(temp, this.file);
  }
  snapshot() { return JSON.parse(JSON.stringify(this.state)); }
  changed() { this.save(); this.onUpdate(this.snapshot()); }
  log(botId, taskId, level, message) {
    this.state.logs.push({ id: this.id(), botId, taskId, level, message: String(message).slice(0, 5000), at: new Date().toISOString() });
    this.state.logs = this.state.logs.slice(-500);
    this.changed();
  }
  createBot(input = {}) {
    const name = String(input.name || "").trim().slice(0, 60);
    if (!name) throw new Error("El bot necesita un nombre.");
    const bot = { id: this.id(), name, instructions: String(input.instructions || "").slice(0, 6000), createdAt: new Date().toISOString(), enabled: true };
    this.state.bots.push(bot); this.changed(); return bot;
  }
  updateBot(id, patch = {}) {
    const bot = this.state.bots.find(x => x.id === id);
    if (!bot) throw new Error("No encontré ese bot.");
    if (patch.name !== undefined) { const name = String(patch.name).trim().slice(0, 60); if (!name) throw new Error("El nombre no puede quedar vacío."); bot.name = name; }
    if (patch.instructions !== undefined) bot.instructions = String(patch.instructions).slice(0, 6000);
    if (patch.enabled !== undefined) bot.enabled = !!patch.enabled;
    this.changed(); return bot;
  }
  deleteBot(id) {
    if (this.state.bots.length < 2) throw new Error("Tiene que quedar al menos un bot.");
    const taskIds = this.state.tasks.filter(x => x.botId === id).map(x => x.id);
    if (taskIds.some(taskId => this.busy.has(taskId))) throw new Error("No podés borrar un bot mientras una de sus tareas está ejecutándose.");
    this.state.bots = this.state.bots.filter(x => x.id !== id);
    this.state.tasks = this.state.tasks.filter(x => x.botId !== id);
    this.state.logs = this.state.logs.filter(x => x.botId !== id);
    this.changed(); return this.snapshot();
  }
  createTask(input = {}) {
    const bot = this.state.bots.find(x => x.id === input.botId);
    if (!bot) throw new Error("Elegí un bot válido.");
    const title = String(input.title || "").trim().slice(0, 100);
    const objective = String(input.objective || "").trim().slice(0, 5000);
    if (!title || !objective) throw new Error("La tarea necesita un título y un objetivo.");
    const trigger = ["interval", "once"].includes(input.trigger) ? input.trigger : "manual";
    const intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(input.intervalMinutes) || 30)));
    let nextRunAt = null;
    if (trigger === "interval") nextRunAt = new Date(Date.now() + intervalMinutes * 60000).toISOString();
    if (trigger === "once") {
      const when = Date.parse(input.scheduledAt);
      if (!Number.isFinite(when) || when <= Date.now()) throw new Error("Elegí una fecha y hora futuras para la tarea.");
      nextRunAt = new Date(when).toISOString();
    }
    const now = Date.now();
    const task = { id: this.id(), botId: bot.id, title, objective, trigger, intervalMinutes, scheduledAt: trigger === "once" ? nextRunAt : null, status: "active", createdAt: new Date(now).toISOString(), nextRunAt, lastRunAt: null };
    this.state.tasks.push(task); this.changed(); return task;
  }
  updateTask(id, patch = {}) {
    const task = this.state.tasks.find(x => x.id === id);
    if (!task) throw new Error("No encontré esa tarea.");
    if (this.busy.has(id)) throw new Error("Esperá a que termine la ejecución para editar esta tarea.");
    if (patch.title !== undefined) { const title = String(patch.title).trim().slice(0, 100); if (!title) throw new Error("El título no puede quedar vacío."); task.title = title; }
    if (patch.objective !== undefined) { const objective = String(patch.objective).trim().slice(0, 5000); if (!objective) throw new Error("El objetivo no puede quedar vacío."); task.objective = objective; }
    if (patch.trigger !== undefined) {
      const trigger = ["manual", "interval", "once"].includes(patch.trigger) ? patch.trigger : null;
      if (!trigger) throw new Error("Tipo de programación no válido.");
      task.trigger = trigger;
      if (trigger === "interval") {
        task.intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(patch.intervalMinutes ?? task.intervalMinutes) || 30)));
        task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
        task.scheduledAt = null;
      } else if (trigger === "once") {
        const when = Date.parse(patch.scheduledAt);
        if (!Number.isFinite(when) || when <= Date.now()) throw new Error("Elegí una fecha y hora futuras.");
        task.scheduledAt = new Date(when).toISOString();
        task.nextRunAt = task.scheduledAt;
      } else { task.nextRunAt = null; task.scheduledAt = null; }
    } else if (patch.intervalMinutes !== undefined && task.trigger === "interval") {
      task.intervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(patch.intervalMinutes) || 30)));
      task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
    }
    if (task.status === "completed" && task.trigger !== "once") task.status = "active";
    this.changed(); return task;
  }
  deleteTask(id) {
    if (this.busy.has(id)) throw new Error("No podés borrar una tarea mientras se está ejecutando.");
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter(x => x.id !== id);
    if (this.state.tasks.length === before) throw new Error("No encontré esa tarea.");
    this.state.logs = this.state.logs.filter(x => x.taskId !== id);
    this.changed(); return this.snapshot();
  }
  setTaskState(id, status) {
    const task = this.state.tasks.find(x => x.id === id);
    if (!task) throw new Error("No encontré esa tarea.");
    if (!["active", "paused", "stopped"].includes(status)) throw new Error("Estado no válido.");
    task.status = status;
    if (status === "active" && task.trigger === "interval" && (!task.nextRunAt || Date.parse(task.nextRunAt) <= Date.now())) task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
    if (status === "active" && task.trigger === "once" && !task.nextRunAt) task.nextRunAt = task.scheduledAt;
    this.changed(); return task;
  }
  async runTask(taskId, { force = false } = {}) {
    const task = this.state.tasks.find(x => x.id === taskId);
    if (!task || (!force && task.status !== "active") || this.busy.has(taskId)) return;
    const bot = this.state.bots.find(x => x.id === task.botId);
    if (!bot || !bot.enabled) throw new Error("Este bot está pausado. Activá el bot para ejecutar sus tareas.");
    this.busy.add(taskId);
    task.lastRunAt = new Date().toISOString();
    if (task.trigger === "interval") task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
    this.changed();
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
        if (typeof this.onAction !== "function") throw new Error("No está disponible el sistema de Artifacts de QBIT.");
        const actionResult = await this.onAction({ botId: bot.id, taskId: task.id, call });
        report += "\n" + String(actionResult || "Acción procesada.");
      }
      if (task.trigger === "once") { task.status = "completed"; task.nextRunAt = null; }
      this.log(bot.id, task.id, "success", report || "Ejecución completada.");
    } catch (error) {
      if (task.trigger === "interval" && task.status === "active") task.nextRunAt = new Date(Date.now() + 60000).toISOString();
      if (task.trigger === "once" && task.status === "active") task.nextRunAt = new Date(Date.now() + 60000).toISOString();
      this.log(bot.id, task.id, "error", error?.message || "No se pudo ejecutar la tarea.");
    } finally {
      this.busy.delete(taskId);
      this.changed();
    }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const task of this.state.tasks) {
        if (task.status === "active" && ["interval", "once"].includes(task.trigger) && task.nextRunAt && Date.parse(task.nextRunAt) <= now) void this.runTask(task.id);
      }
    }, 5000);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.save(); }
  runNow(id) { return this.runTask(id, { force: true }); }
}
module.exports = { AgentEngine };
