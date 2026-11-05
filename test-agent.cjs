const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { AgentEngine, parseAgentJSON, isPrivateHost } = require("./windows/electron/agent-engine.cjs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qbit-")), "state.json");
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(15); } throw new Error("timeout esperando condición"); }
function make(over = {}) {
  const calls = { ai: [], act: [], notes: [] };
  const eng = new AgentEngine({ dataPath: tmp(), tickMs: 20, minWatchMinutes: 0.0003,
    runAI: over.runAI || (async p => { calls.ai.push(p); return { answer: "{\"fin\":\"hecho\",\"resumen\":\"ok\"}" }; }),
    onAction: over.onAction || (async ({ call }) => { calls.act.push(call); return "resultado de " + call.artifact; }),
    notify: n => calls.notes.push(n), fetchImpl: over.fetchImpl, limits: over.limits });
  return { eng, calls, bot: eng.state.bots[0] };
}
const T = [];
const test = (name, fn) => T.push([name, fn]);

test("parser acepta JSON puro, con fence y rodeado de texto", () => {
  assert.equal(parseAgentJSON('{"fin":"hecho"}').fin, "hecho");
  assert.equal(parseAgentJSON('Claro:\n```json\n{"tool":"disk_usage","args":{}}\n```').tool, "disk_usage");
  assert.equal(parseAgentJSON('Voy a hacerlo {"artifact":"volume","args":{"action":"up"}} listo').tool, "volume");
  assert.equal(parseAgentJSON("sin json"), null);
});
test("M: bloquea herramientas inexistentes sin ejecutarlas", async () => {
  let calls = 0, prompts = [];
  const { eng, bot } = make({ runAI: async p => {
    prompts.push(p);
    return { answer: prompts.length === 1
      ? '{"tool":"delete_everything","args":{}}'
      : '{"fin":"hecho","resumen":"Detecté una herramienta inválida y no la ejecuté."}' };
  }, onAction: async () => { calls++; return "ejecutada"; } });
  const t = eng.createTask({ botId: bot.id, title: "validar", objective: "probar catálogo", trigger: "auto" });
  eng.start(); await until(() => t.status === "completed"); eng.stop();
  assert.equal(calls, 0);
  assert.match(prompts[1], /BLOQUEADO: la herramienta no existe en el catálogo/);
});
test("N: detecta acciones repetidas aunque cambie el orden de las claves", async () => {
  let n = 0, actions = 0;
  const { eng, bot } = make({ runAI: async () => ({
    answer: ++n === 1
      ? '{"tool":"time_date","args":{"alpha":1,"beta":2}}'
      : '{"tool":"time_date","args":{"beta":2,"alpha":1}}'
  }), onAction: async () => { actions++; return "ok"; } });
  const t = eng.createTask({ botId: bot.id, title: "detectar loop", objective: "probar repetición", trigger: "auto" });
  eng.start(); await until(() => !!t.wakeAt); eng.stop();
  assert.equal(actions, 1, "la misma herramienta y argumentos se ejecutan una sola vez");
  assert.equal(n, 4, "tres repeticiones consecutivas activan la pausa protectora");
  assert.match(t.lastSummary, /Repetía la misma acción/);
});
test("isPrivateHost", () => {
  for (const h of ["localhost", "127.0.0.1", "192.168.1.5", "10.0.0.1", "172.20.0.1", "169.254.1.1", "[::1]", "foo.local"]) assert.ok(isPrivateHost(h), h);
  for (const h of ["example.com", "fcbarcelona.com", "8.8.8.8", "172.32.0.1"]) assert.ok(!isPrivateHost(h), h);
});
test("A: bucle multi-paso: herramienta → observación → hecho, y notifica", async () => {
  const seen = [];
  const answers = ['{"tool":"disk_usage","args":{}}', '{"tool":"remember","args":{"nota":"disco ok"}}', '{"fin":"hecho","resumen":"Revisé el disco"}'];
  const { eng, calls, bot } = make({ runAI: async p => { seen.push(p); return { answer: answers[seen.length - 1] }; } });
  const task = eng.createTask({ botId: bot.id, title: "t", objective: "revisar disco", trigger: "auto" });
  eng.start(); await until(() => task.status === "completed"); eng.stop();
  assert.equal(seen.length, 3);
  assert.match(seen[1], /OBSERVACIÓN: resultado de disk_usage/);
  assert.match(seen[2], /Nota guardada/);
  assert.equal(task.memory, "disco ok");
  assert.equal(calls.notes.length, 1); assert.match(calls.notes[0].body, /Revisé el disco/);
  assert.ok(seen.every(p => p.length <= 12000));
});
test("B: vigilar → consulta local sin IA → despierta solo al cambiar", async () => {
  let n = 0, aiCalls = 0, wakePrompt = "";
  const { eng, calls, bot } = make({
    onAction: async ({ call }) => { n++; return n < 4 ? "cpu 10%" : "cpu 95%"; },
    runAI: async p => { aiCalls++; if (aiCalls === 1) return { answer: '{"fin":"vigilar","cada_minutos":0.0005,"fuente":{"tool":"cpu_usage","args":{}},"modo":"cambio","resumen":"vigilando CPU"}' }; wakePrompt = p; return { answer: '{"tool":"notify","args":{"title":"CPU","message":"subió"}}' }; }
  });
  const task = eng.createTask({ botId: bot.id, title: "cpu", objective: "avisame si cambia la CPU", trigger: "auto" });
  let step3 = 0; const orig = eng.runAI; eng.runAI = async (p, c) => { const r = await orig(p, c); if (aiCalls >= 2 && !/fin/.test(r.answer)) { step3++; if (step3 > 0 && /OBSERVACIÓN: Notificación/.test(p)) return { answer: '{"fin":"hecho","resumen":"avisé"}' }; } return r; };
  eng.start(); await until(() => task.status === "completed"); eng.stop();
  assert.ok(n >= 4, "consultó la fuente varias veces: " + n);
  assert.ok(aiCalls <= 4, "la IA no se usó en cada consulta: " + aiCalls);
  assert.match(wakePrompt, /cambió/); assert.match(wakePrompt, /cpu 95%/); assert.match(wakePrompt, /cpu 10%/);
  assert.ok(calls.notes.some(x => x.title === "CPU"));
});
test("C: JSON inválido → reintenta una vez; segunda vez falla", async () => {
  let i = 0;
  const { eng, bot } = make({ runAI: async () => ({ answer: ++i === 1 ? "hola, no sé" : '{"fin":"hecho","resumen":"ok"}' }) });
  const t1 = eng.createTask({ botId: bot.id, title: "a", objective: "x", trigger: "auto" });
  eng.start(); await until(() => t1.status === "completed"); eng.stop();
  const { eng: e2, bot: b2 } = make({ runAI: async () => ({ answer: "blabla" }) });
  const t2 = e2.createTask({ botId: b2.id, title: "b", objective: "x", trigger: "auto" });
  e2.start(); await until(() => t2.status === "failed"); e2.stop();
});
test("D: misma acción repetida NO mata la tarea: pausa 5 min y sigue activa", async () => {
  const { eng, bot } = make({ runAI: async () => ({ answer: '{"tool":"time_date","args":{}}' }) });
  const t = eng.createTask({ botId: bot.id, title: "loop", objective: "x", trigger: "auto" });
  eng.start(); await until(() => t.wakeAt); eng.stop();
  assert.equal(t.status, "active"); assert.match(t.lastSummary, /Repetía/);
});
test("E: IA desconectada → reintenta en 2 min sin gastar intentos ni quedar fallida", async () => {
  const { eng, calls, bot } = make({ runAI: async () => { throw new Error("La extensión no está conectada."); } });
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "y", trigger: "auto" });
  eng.start(); await until(() => t.wakeAt); eng.stop();
  assert.equal(t.status, "active"); assert.equal(t.failures, 0);
  assert.ok(ts(t.wakeAt) - Date.now() > 100000);
  assert.equal(calls.notes.length, 1);
});
function ts(v) { return Date.parse(v); }
test("F: errores reales → backoff creciente (tope 30 min), avisa una vez y NUNCA queda fallida", async () => {
  let clock = Date.now();
  const { eng, calls, bot } = make({ runAI: async () => { throw new Error("boom"); } });
  eng.now = () => clock;
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "y", trigger: "auto" });
  eng.start();
  for (let k = 0; k < 9; k++) { const prev = t.lastRunAt; await until(() => t.lastRunAt !== prev && !eng.busy.has(t.id)); clock += 3600000; }
  eng.stop();
  assert.equal(t.status, "active"); assert.ok(t.failures >= 9);
  assert.ok(Date.parse(t.wakeAt) - (clock - 3600000) <= 30 * 60000 + 1000, "espera máxima 30 min");
  assert.equal(calls.notes.filter(n => /Sigue fallando/.test(n.body)).length, 1);
});
test("G: nunca dos consultas a la IA en paralelo", async () => {
  let active = 0, max = 0;
  const { eng, bot } = make({ runAI: async () => { active++; max = Math.max(max, active); await sleep(60); active--; return { answer: '{"fin":"hecho","resumen":"ok"}' }; } });
  const a = eng.createTask({ botId: bot.id, title: "a", objective: "x", trigger: "auto" });
  const b = eng.createTask({ botId: bot.id, title: "b", objective: "x", trigger: "auto" });
  eng.start(); await until(() => a.status === "completed" && b.status === "completed"); eng.stop();
  assert.equal(max, 1);
});
test("H: allowedArtifacts bloquea herramientas no permitidas (pero no las del agente)", async () => {
  const seen = [];
  const answers = ['{"tool":"close_window","args":{"query":"x"}}', '{"fin":"hecho","resumen":"ok"}'];
  const { eng, calls, bot } = make({ runAI: async p => { seen.push(p); return { answer: answers[seen.length - 1] }; } });
  eng.updateBot(bot.id, { allowedArtifacts: ["disk_usage"] });
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "y", trigger: "auto" });
  eng.start(); await until(() => t.status === "completed"); eng.stop();
  assert.equal(calls.act.length, 0); assert.match(seen[1], /BLOQUEADO/);
});
test("I: fetch_url bloquea direcciones privadas y limpia HTML", async () => {
  const fetchImpl = async url => ({ ok: true, status: 200, headers: new Map([["content-type", "text/html"]]), text: async () => "<html><script>x()</script><body><h1>Hola</h1> mundo</body></html>" });
  const { eng } = make({ fetchImpl });
  await assert.rejects(eng.fetchText("http://127.0.0.1:17614/", 500), /BLOQUEADO/);
  await assert.rejects(eng.fetchText("file:///etc/passwd", 500), /http/);
  assert.equal(await eng.fetchText("https://example.com", 500), "Hola mundo");
  const redir = async url => url.includes("a.com") ? { ok: false, status: 302, headers: new Map([["location", "http://192.168.0.1/"]]), text: async () => "" } : fetchImpl(url);
  const { eng: e2 } = make({ fetchImpl: redir });
  await assert.rejects(e2.fetchText("https://a.com", 500), /BLOQUEADO/);
});
test("J: el prompt respeta el límite aunque haya observaciones enormes y bot/tarea largos", async () => {
  const seen = []; let n = 0;
  const { eng, bot } = make({ onAction: async () => "x".repeat(9000), runAI: async p => { seen.push(p); return { answer: ++n <= 6 ? `{"tool":"read_text_file","args":{"query":"f${n}"}}` : '{"fin":"hecho","resumen":"ok"}' }; } });
  eng.updateBot(bot.id, { instructions: "i".repeat(6000) });
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "o".repeat(5000), trigger: "auto" });
  t.memory = "m".repeat(800); t.lastSummary = "s".repeat(500);
  eng.start(); await until(() => t.status === "completed"); eng.stop();
  assert.ok(seen.length >= 7); for (const p of seen) assert.ok(p.length <= 12000, "largo " + p.length);
});
test("K: por defecto SIN tope de pasos (30 pasos seguidos); los límites existen solo si se configuran", async () => {
  let n = 0;
  const { eng, bot } = make({ runAI: async () => ({ answer: ++n <= 30 ? `{"tool":"time_date","args":{"n":${n}}}` : '{"fin":"hecho","resumen":"ok"}' }) });
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "y", trigger: "auto" });
  eng.start(); await until(() => t.status === "completed", 8000); eng.stop();
  assert.equal(n, 31);
  let k = 0; const lim = make({ limits: { maxSteps: 3 }, runAI: async () => ({ answer: `{"tool":"time_date","args":{"n":${k++}}}` }) });
  const t2 = lim.eng.createTask({ botId: lim.bot.id, title: "x", objective: "y", trigger: "auto" });
  lim.eng.start(); await until(() => t2.wakeAt); lim.eng.stop();
  assert.equal(k, 3); assert.equal(t2.status, "active");
});
test("L: pausar a mitad de ejecución la cancela; estado persiste y se recarga", async () => {
  let release; const gate = new Promise(r => release = r);
  const { eng, bot } = make({ runAI: async () => { await gate; return { answer: '{"tool":"time_date","args":{}}' }; } });
  const t = eng.createTask({ botId: bot.id, title: "x", objective: "y", trigger: "auto" });
  eng.start(); await until(() => eng.busy.has(t.id));
  eng.setTaskState(t.id, "paused"); release();
  await until(() => !eng.busy.has(t.id)); eng.stop();
  assert.equal(t.status, "paused");
  const again = new AgentEngine({ dataPath: eng.file, runAI() {}, onAction() {} });
  assert.equal(again.state.tasks[0].status, "paused");
});

test("M: Computer Use permite observar, desplazar y hacer clic por coordenadas solo si está activado", async () => {
  const seen = [];
  const answers = [
    '{"tool":"computer_observe","args":{}}',
    '{"tool":"computer_scroll","args":{"direction":"down","amount":2}}',
    '{"tool":"computer_click_at","args":{"x":420,"y":260}}',
    '{"fin":"hecho","resumen":"Interacción terminada"}'
  ];
  const { eng, calls, bot } = make({
    runAI: async () => ({ answer: answers[seen.length++] }),
    onAction: async ({ call }) => { calls.act.push(call); return call.artifact + " OK"; }
  });
  eng.updateBot(bot.id, { computerUse: true });
  const task = eng.createTask({ botId: bot.id, title: "computer use", objective: "interactuar con la ventana", trigger: "auto" });
  eng.start(); await until(() => task.status === "completed"); eng.stop();
  assert.deepEqual(calls.act.map(x => x.artifact), ["computer_observe","computer_scroll","computer_click_at"]);
  assert.equal(calls.act[1].args.amount, 2);
  assert.equal(calls.act[2].args.x, 420);
});
test("N: Computer Use sigue bloqueado cuando el bot no tiene permiso", async () => {
  const seen = [];
  const answers = ['{"tool":"computer_scroll","args":{"direction":"down"}}','{"fin":"hecho","resumen":"ok"}'];
  const { eng, calls, bot } = make({ runAI: async p => { seen.push(p); return { answer: answers[seen.length - 1] }; } });
  const task = eng.createTask({ botId: bot.id, title: "bloqueo", objective: "no debe manejar el PC", trigger: "auto" });
  eng.start(); await until(() => task.status === "completed"); eng.stop();
  assert.equal(calls.act.length, 0);
  assert.match(seen[1], /BLOQUEADO: activá Computer Use/);
});


test("O: computer_observe conserva suficiente información de controles y coordenadas", async () => {
  const seen = [];
  const { eng, bot } = make({
    onAction: async () => JSON.stringify({ ok: true, controls: Array.from({length:45},(_,i)=>({name:"Control "+i,rect:{x:i*10,y:i*5,width:120,height:30}})) }),
    runAI: async p => { seen.push(p); return { answer: seen.length === 1 ? '{"tool":"computer_observe","args":{}}' : '{"fin":"hecho","resumen":"observación revisada"}' }; }
  });
  eng.updateBot(bot.id, { computerUse: true });
  const task = eng.createTask({ botId: bot.id, title: "observar", objective: "leer los controles de la pantalla", trigger: "auto" });
  eng.start(); await until(() => task.status === "completed"); eng.stop();
  assert.match(seen[1], /Control 0/);
  assert.match(seen[1], /rect/);
  assert.ok(seen[1].length > 1500, "la observación de pantalla no debe truncarse al límite genérico");
});

(async () => {
  let fail = 0;
  for (const [name, fn] of T) { try { await fn(); console.log("✔", name); } catch (e) { fail++; console.log("✘", name, "\n   ", e.message); } }
  console.log(fail ? `\n${fail} FALLARON` : "\nTODAS PASARON"); process.exit(fail ? 1 : 0);
})();
