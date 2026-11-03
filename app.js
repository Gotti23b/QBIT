(() => {
  const URL = "https://jtxyzfjgspnmzlvztjqx.supabase.co";
  const KEY = "sb_publishable_s6GXW0tRJR9vo2T2VdPH7Q_otjhGunV";
  const db = window.supabase.createClient(URL, KEY);
  const $ = id => document.getElementById(id);
  let user = null, categories = [], commands = [], responses = [], chatHistory = [], activeChatId = null, restoringChat = false, petMessagePending = false;
  async function executeDesktopArtifact(name,args={}){
    const pc=window.qbitPC;
    if(!pc?.isDesktop)throw new Error("Este Artifact solo está disponible en QBIT Desktop para Windows.");
    if(name==="open_anything"){
      const query=String(args.query||"").trim();
      if(!query)throw new Error("Necesito el nombre de la aplicación o archivo.");
      const folderNames={"inicio":"inicio","documentos":"documentos","descargas":"descargas","escritorio":"escritorio","imagenes":"imagenes","imágenes":"imagenes","musica":"musica","música":"musica","videos":"videos"};
      if(folderNames[query.toLocaleLowerCase("es")])return await pc.openFolder(folderNames[query.toLocaleLowerCase("es")]);
      const sites={"youtube":"https://www.youtube.com/","google":"https://www.google.com/","github":"https://github.com/","roblox":"https://www.roblox.com/","minecraft":"https://www.minecraft.net/","spotify":"https://open.spotify.com/","gmail":"https://mail.google.com/","reddit":"https://www.reddit.com/"};
      const site=sites[query.toLocaleLowerCase("es")];
      if(site){await pc.openUrl(site);return {ok:true,message:"Abriendo "+query+" en el navegador."};}
      return await pc.openAnything(query);
    }
    if(name==="system_info"){
      const s=await pc.getStatus();
      return {ok:true,message:"Información del equipo:\n• Sistema: "+s.os+"\n• Equipo: "+s.computer+"\n• Procesador: "+s.cpu+"\n• Procesadores lógicos: "+s.logicalProcessors+"\n• RAM total: "+s.ramTotalGB+" GB\n• RAM libre: "+s.ramFreeGB+" GB\n• Tiempo encendida: "+s.uptimeHours+" horas"+(s.batteryPercent===null?"":"\n• Batería: "+s.batteryPercent+" %")};
    }
    if(name==="volume"){
      if(args.action==="set"){
        const level=Math.round(Number(args.level));
        if(!Number.isFinite(level)||level<0||level>100)throw new Error("El volumen tiene que ser un número entre 0 y 100.");
        return await pc.volume("set",level);
      }
      if(!["up","down","mute"].includes(args.action))throw new Error("Acción de volumen no permitida.");
      return await pc.volume(args.action);
    }
    if(name==="web_search"){
      const query=String(args.query||"").trim();
      if(!query)throw new Error("Necesito qué querés buscar.");
      await pc.openUrl("https://www.google.com/search?q="+encodeURIComponent(query));
      return {ok:true,message:"Abrí una búsqueda de Google para: "+query+". La búsqueda se abrió en el navegador; QBIT no lee automáticamente los resultados de esa página."};
    }
    if(name==="time_date"){
      const now=new Date();
      return {ok:true,message:"Son las "+new Intl.DateTimeFormat("es-AR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now)+". Hoy es "+new Intl.DateTimeFormat("es-AR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now)+"."};
    }
    if(name==="automation"){
      if(!args.__allowed&&!window.confirm("Agent quiere preparar el entorno de estudio: abrir Calculadora, Bloc de notas y Documentos. ¿Continuar?"))return {ok:true,message:"Cancelaste la automatización. No se realizaron cambios."};
      return await pc.runAutomation("study");
    }
    if(name==="open_settings")return await pc.openSettings(String(args.page||"system"));
    if(name==="lock_pc")return await pc.lockPC();
    if(name==="battery_info")return await pc.getBatteryInfo();
    if(name==="network_info")return await pc.getNetworkInfo();
    if(name==="display_info")return await pc.getDisplayInfo();
    if(name==="brightness_info")return await pc.getBrightnessInfo();
    if(name==="brightness_set"){
      const rawLevel=args.level&&typeof args.level==="object"?(args.level.level??args.level.value):args.level;
      const level=Number(rawLevel);
      if(!Number.isInteger(level)||level<0||level>100)throw new Error("El brillo tiene que ser un número entero entre 0 y 100.");
      return await pc.setBrightness(level);
    }
    if(name==="brightness_up")return await pc.adjustBrightness(10);
    if(name==="brightness_down")return await pc.adjustBrightness(-10);
    if(name==="media_control"){
      if(!["play_pause","next","previous","stop"].includes(args.action))throw new Error("Acción multimedia no válida.");
      return await pc.mediaControl(args.action);
    }
    if(name==="create_folder")return await pc.createFolder(String(args.base||"documentos"),String(args.path||""));
    if(name==="create_file")return await pc.createFile(String(args.base||"documentos"),String(args.path||""),String(args.content??""));
    if(name==="search_files"){
      const result=await pc.searchFiles(String(args.query||""));
      if(!result.matches?.length)return {ok:true,message:"No encontré archivos con ese nombre."};
      return {ok:true,message:"Archivos encontrados:\n"+result.matches.map(x=>"• "+x.name+" (carpeta: "+x.folder+")").join("\n")};
    }
    if(name==="empty_recycle_bin")return await pc.emptyRecycleBin();
    if(name==="get_processes")return await pc.getProcesses();
    if(name==="cpu_usage")return await pc.getCpuUsage();
    if(name==="ram_usage")return await pc.getRamUsage();
    if(name==="disk_usage")return await pc.getDiskUsage();
    if(name==="toggle_night_light")return await pc.openNightLightSettings();
    if(name==="toggle_wifi")return await pc.toggleWifi(args.action);
    if(name==="minimize_all")return await pc.minimizeAll();
    if(name==="restore_all")return await pc.restoreAll();
    if(name==="focus_app")return await pc.focusApp(String(args.query||""));
    if(name==="close_window")return await pc.closeWindow(String(args.query||""));
    if(name==="open_file_location")return await pc.openFileLocation(String(args.query||""));
    if(name==="get_file_info")return await pc.getFileInfo(String(args.query||""));
    if(name==="zip_files")return await pc.zipFile(String(args.query||""));
    if(name==="unzip_file")return await pc.unzipFile(String(args.query||""));
    if(name==="read_text_file")return await pc.readTextFile(String(args.query||""));
    if(name==="show_notification")return await pc.showNotification(String(args.title||"QBIT"),String(args.message||""));
    if(name==="set_timer")return await pc.setTimer(Number(args.seconds),String(args.label||"Temporizador"));
    if(name==="cancel_timer")return await pc.cancelTimer(String(args.id||"default"));
    if(name==="open_calculator")return await pc.openApp("calculadora");
    if(name==="open_notepad")return await pc.openApp("bloc de notas");
    if(name==="open_task_manager")return await pc.openApp("administrador de tareas");
    if(name==="volume_info")return await pc.getAudioDevices();
    if(name==="volume_set"){const level=Number(args.level);if(!Number.isInteger(level)||level<0||level>100)throw new Error("El volumen debe ser un entero entre 0 y 100.");return await pc.volume("set",level);}
    if(name==="audio_mute")return await pc.volume("mute");
    if(name==="clipboard_write")return await pc.writeClipboard(String(args.text??""));

    throw new Error("Artifact desconocido o no habilitado: "+name);
  }
  // ── Artifacts desde la IA del navegador ──────────────────────────────────
  // La IA puede pedir un artifact con un bloque:  ```qbit\n{"artifact":"volume","args":{"action":"up"}}\n```
  const AI_ARTIFACTS={
    open_anything:"abrir una aplicación, archivo, carpeta o sitio",
    system_info:"consultar información del equipo",
    volume:"cambiar el volumen",
    web_search:"buscar en Google",
    time_date:"consultar la hora y la fecha",
    automation:"preparar el entorno de estudio",
    open_settings:"abrir una sección de Configuración de Windows",
    lock_pc:"bloquear la PC",
    battery_info:"consultar el estado de la batería",
    network_info:"consultar las conexiones de red activas",
    display_info:"consultar las pantallas conectadas",
    brightness_info:"consultar el nivel de brillo de la pantalla",
    brightness_set:"establecer el brillo de la pantalla",
    brightness_up:"subir el brillo de la pantalla",
    brightness_down:"bajar el brillo de la pantalla",
    media_control:"controlar la reproducción multimedia",
    create_folder:"crear una carpeta en Documentos, Descargas o Escritorio",
    create_file:"crear un archivo de texto en Documentos, Descargas o Escritorio",
    search_files:"buscar archivos por nombre",
    clipboard_write:"copiar texto al portapapeles",
    empty_recycle_bin:"vaciar la Papelera de reciclaje (acción irreversible)",
    get_processes:"consultar los procesos activos",
    cpu_usage:"consultar el uso del procesador",
    ram_usage:"consultar el uso de memoria RAM",
    disk_usage:"consultar el espacio de los discos",
    toggle_night_light:"abrir la configuración de Luz nocturna de Windows",
    toggle_wifi:"activar o desactivar el Wi-Fi",
    minimize_all:"minimizar todas las ventanas",
    restore_all:"restaurar las ventanas minimizadas",
    focus_app:"llevar una aplicación abierta al frente",
    close_window:"cerrar una aplicación abierta",
    open_file_location:"mostrar un archivo en su carpeta",
    get_file_info:"consultar información de un archivo",
    zip_files:"comprimir un archivo en ZIP",
    unzip_file:"extraer un archivo ZIP",
    read_text_file:"leer un archivo de texto",
    show_notification:"mostrar una notificación de Windows",
    set_timer:"crear un temporizador",
    cancel_timer:"cancelar un temporizador",
    open_calculator:"abrir la Calculadora",
    open_notepad:"abrir el Bloc de notas",
    open_task_manager:"abrir el Administrador de tareas",
    volume_info:"consultar los dispositivos de audio detectados",
    volume_set:"establecer el volumen",
    audio_mute:"silenciar el audio",
  };
  const AI_ARTIFACTS_NO_CONFIRM=new Set(["system_info","time_date","battery_info","network_info","display_info","brightness_info","get_processes","cpu_usage","ram_usage","disk_usage","volume_info"]);
  let aiGuideSent=false;
  function aiGuide(){
    return "[Instrucciones de QBIT — leelas y respondé solo al mensaje del usuario]\n"+
      "Estás respondiendo a través de QBIT, un asistente de escritorio para Windows. Respondé en español.\n"+
      "Si el usuario te pide una acción en su PC, agregá al final un bloque de código con lenguaje qbit y un JSON, por ejemplo:\n"+
      "```qbit\n{\"artifact\":\"volume\",\"args\":{\"action\":\"up\"}}\n```\n"+
      "Artifacts disponibles: open_anything {\"query\":\"nombre\"}; system_info {}; volume {\"action\":\"up|down|mute\"} o {\"action\":\"set\",\"level\":0-100}; web_search {\"query\":\"texto\"}; time_date {}; automation {}; open_settings {\"page\":\"system|display|sound|network|wifi|bluetooth|apps|personalization|updates|storage|notifications|privacy\"}; lock_pc {}; battery_info {}; network_info {}; display_info {}; brightness_info {}; brightness_set {\"level\":0-100}; brightness_up {}; brightness_down {}; media_control {\"action\":\"play_pause|next|previous|stop\"}; create_folder {\"base\":\"documentos|descargas|escritorio\",\"path\":\"Carpeta nueva\"}; create_file {\"base\":\"documentos|descargas|escritorio\",\"path\":\"nota.txt\",\"content\":\"texto\"}; search_files {\"query\":\"nombre\"}; clipboard_write {\"text\":\"texto\"}; empty_recycle_bin {}; get_processes {}; cpu_usage {}; ram_usage {}; disk_usage {}; toggle_night_light {}; toggle_wifi {\"action\":\"on|off\"}; minimize_all {}; restore_all {}; focus_app {\"query\":\"nombre de aplicación\"}; close_window {\"query\":\"nombre de aplicación\"}; open_file_location {\"query\":\"nombre de archivo\"}; get_file_info {\"query\":\"nombre de archivo\"}; zip_files {\"query\":\"nombre de archivo\"}; unzip_file {\"query\":\"archivo ZIP\"}; read_text_file {\"query\":\"archivo de texto\"}; show_notification {\"title\":\"Título\",\"message\":\"Texto\"}; set_timer {\"seconds\":60,\"label\":\"Descanso\"}; cancel_timer {\"id\":\"default\"}; open_calculator {}; open_notepad {}; open_task_manager {}; volume_info {}; volume_set {\"level\":0-100}; audio_mute {}.\n"+

      "El bloque tiene que empezar exactamente con ```qbit. Usá como máximo uno por respuesta y solo si el usuario lo pidió.\n\nMensaje del usuario:\n";
  }
  // Acepta ```qbit … ``` y también cualquier bloque cuyo contenido sea un JSON con "artifact"
  // (algunas IAs, como Gemini, pierden el nombre del lenguaje).
  function extractArtifactBlocks(text){
    const calls=[];
    // Junta bloques vacíos pegados ("```\n```\n{...}") que dejan algunas páginas.
    const fixed=String(text).replace(/```[\w#+.-]*[ \t]*\n```[ \t]*\n/g,"```\n");
    const clean=fixed.replace(/```([\w#+.-]*)\s*\n([\s\S]*?)```/g,(whole,lang,body)=>{
      const json=body.replace(/^\s*```\w*\s*$/gm,"").trim();
      let isArtifact=lang.toLowerCase()==="qbit";
      if(!isArtifact){try{const o=JSON.parse(json);isArtifact=!!(o&&typeof o==="object"&&o.artifact);}catch{}}
      if(!isArtifact)return whole;
      calls.push(json);return "";
    }).replace(/\n{3,}/g,"\n\n").trim();
    return {clean,calls:calls.slice(0,3)};
  }
  // ── Permisos de las acciones de la IA ("Permitir siempre") ────────────────
  // Se guardan en esta PC. Se cambian desde la pestaña Conector.
  const ALLOW_KEY="qbit-ai-always-allow";
  let allowMemory=null; // respaldo por si el almacenamiento no está disponible
  function loadAlwaysAllow(){try{const v=JSON.parse(localStorage.getItem(ALLOW_KEY)||"[]");return new Set(Array.isArray(v)?v.filter(n=>AI_ARTIFACTS[n]):[]);}catch{return new Set(allowMemory||[]);}}
  function saveAlwaysAllow(set){allowMemory=[...set];try{localStorage.setItem(ALLOW_KEY,JSON.stringify(allowMemory));}catch{}renderAllowSettings();}
  function setAlwaysAllow(name,on){const set=loadAlwaysAllow();on?set.add(name):set.delete(name);saveAlwaysAllow(set);}
  // Ventana propia con tres opciones (window.confirm solo tiene Aceptar/Cancelar).
  function askPermission(name,detail){
    return new Promise(resolve=>{
      const overlay=node("div","qbit-modal-overlay");const box=node("div","qbit-modal card");
      box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");
      box.append(node("h3","","La IA quiere hacer algo en tu PC"),node("p","","Quiere "+AI_ARTIFACTS[name]+detail+"."));
      const actions=node("div","qbit-modal-actions");
      const done=v=>{overlay.remove();document.removeEventListener("keydown",onKey);resolve(v);};
      const onKey=e=>{if(e.key==="Escape")done("deny");};
      actions.append(btn("No","",()=>done("deny")),btn("Permitir siempre","",()=>done("always")),btn("Permitir una vez","primary",()=>done("once")));
      box.append(actions,node("p","muted small-note","«Permitir siempre» se puede desactivar en la pestaña 🔌 Conector."));
      overlay.append(box);document.body.append(overlay);document.addEventListener("keydown",onKey);
      actions.lastChild.focus();
    });
  }
  function renderAllowSettings(){
    const list=document.getElementById("aiAllowList");if(!list)return;
    const allowed=loadAlwaysAllow();list.replaceChildren();
    for(const [name,label] of Object.entries(AI_ARTIFACTS)){
      if(AI_ARTIFACTS_NO_CONFIRM.has(name))continue;
      const row=node("label","allow-row");const input=document.createElement("input");input.type="checkbox";input.className="switch";input.checked=allowed.has(name);
      input.addEventListener("change",()=>setAlwaysAllow(name,input.checked));
      row.append(input,node("span","",label.charAt(0).toUpperCase()+label.slice(1)));list.append(row);
    }
    const all=document.getElementById("aiAllowAll");
    if(all){const total=Object.keys(AI_ARTIFACTS).filter(n=>!AI_ARTIFACTS_NO_CONFIRM.has(n)).length;all.textContent=allowed.size?"Volver a preguntar siempre":"Permitir todas";all.onclick=()=>{const set=new Set();if(!allowed.size)Object.keys(AI_ARTIFACTS).filter(n=>!AI_ARTIFACTS_NO_CONFIRM.has(n)).forEach(n=>set.add(n));saveAlwaysAllow(set);};}
  }
  setTimeout(renderAllowSettings,0);
  async function runArtifactBlock(json){
    let call;try{call=JSON.parse(json);}catch{return "La IA mandó un bloque qbit que no es JSON válido.";}
    const name=String(call?.artifact||"");const args=call?.args&&typeof call.args==="object"?{...call.args}:Object.fromEntries(Object.entries(call||{}).filter(([key])=>key!=="artifact"));
    delete args.__allowed;
    if(!AI_ARTIFACTS[name])return "La IA pidió un artifact que no existe: "+name;
    if(!AI_ARTIFACTS_NO_CONFIRM.has(name)&&!loadAlwaysAllow().has(name)){
      const detail=args.query?" (\""+String(args.query).slice(0,80)+"\")":args.action==="set"?" al "+args.level+"%":args.action?" ("+args.action+")":"";
      const answer=await askPermission(name,detail);
      if(answer==="deny")return "Cancelaste el artifact "+name+".";
      if(answer==="always")setAlwaysAllow(name,true);
    }
    args.__allowed=true;
    try{const r=await executeDesktopArtifact(name,args);return r?.message||("Artifact "+name+" ejecutado.");}
    catch(e){return "No pude ejecutar "+name+": "+(e?.message||e);}
  }
  // ── Actualizaciones (solo QBIT Desktop) ─────────────────────────────────
  (async()=>{
    const pc=window.qbitPC;if(!pc?.isDesktop||!pc.checkForUpdates)return;
    const bar=document.getElementById("updateBar"),label=document.getElementById("updateVersion"),status=document.getElementById("updateStatus"),button=document.getElementById("updateBtn");
    if(!bar)return;bar.classList.remove("hidden");
    try{label.textContent="v"+await pc.getAppVersion();}catch{}
    const show=s=>{if(!s)return;status.textContent=s.message||"";status.className=s.status==="error"?"error":"muted";button.textContent="";
      button.append(document.createTextNode(s.status==="ready"?"⬆ Actualizar a v"+s.version+" ":"⟳ "),Object.assign(document.createElement("span"),{id:"updateVersion",textContent:"v"+(s.current||label.textContent.replace(/^v/,""))}));
      if(s.status==="latest")setTimeout(()=>{if(status.textContent===s.message)status.textContent="";},6000);};
    pc.onUpdateState(show);
    button.addEventListener("click",async()=>{try{show(await pc.checkForUpdates());}catch(e){show({status:"error",message:e?.message||"No pude buscar actualizaciones."});}});
  })();
  const say = (id, text, error=false) => { $(id).textContent=text; $(id).className=error?"error":"muted"; };
  const node = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  function normalizeText(value){ return String(value).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[¿?¡!.,;:]/g," ").replace(/\s+/g," ").trim(); }
  const btn = (text, cls, fn) => { const b=node("button",cls,text); b.type="button"; b.onclick=fn; return b; };
  const historyKey=()=> "qbit-chat-history-"+(user?.id||"guest");
  function saveHistory(){if(!user)return;try{localStorage.setItem(historyKey(),JSON.stringify(chatHistory));}catch(e){console.warn("No se pudo guardar el historial",e);}}
  function ensureActiveChat(){
    if(activeChatId&&chatHistory.some(c=>c.id===activeChatId))return;
    const chat={id: (crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(36).slice(2)),title:"Nuevo chat",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
    chatHistory.unshift(chat);activeChatId=chat.id;saveHistory();
  }
  function loadHistory(){
    chatHistory=[];activeChatId=null;
    if(!user)return;
    try{const saved=JSON.parse(localStorage.getItem(historyKey())||"[]");chatHistory=Array.isArray(saved)?saved.filter(c=>c&&Array.isArray(c.messages)):[];}catch{chatHistory=[];}
    if(chatHistory.length){activeChatId=chatHistory[0].id;showChat(activeChatId,false);}else{
      ensureActiveChat();$("chatbox").replaceChildren();
      bubble("QBIT","¡Hola! Soy QBIT. Agregá comandos y respuestas en el panel de administración para empezar. ✨","bot");
    }
    renderHistory();
  }
  // Muestra el texto y convierte los bloques ```lenguaje … ``` en código con botón Copiar.
  function richText(text){
    text=String(text).replace(/```[\w#+.-]*[ \t]*\n```[ \t]*\n/g,"```\n");
    const frag=document.createDocumentFragment();const re=/```([\w#+.-]*)\n([\s\S]*?)```/g;let last=0,m;
    while((m=re.exec(text))){
      if(m.index>last)frag.append(document.createTextNode(text.slice(last,m.index)));
      const box=node("div","codeblock");const head=node("div","codehead");head.append(node("span","",m[1]||"código"));
      const code=m[2].replace(/\n$/,"");
      head.append(btn("Copiar","small",async e=>{try{await navigator.clipboard.writeText(code);e.target.textContent="¡Copiado!";setTimeout(()=>e.target.textContent="Copiar",1500);}catch{e.target.textContent="No se pudo";}}));
      const pre=node("pre");pre.append(node("code","",code));box.append(head,pre);frag.append(box);last=re.lastIndex;
    }
    if(last<text.length)frag.append(document.createTextNode(text.slice(last)));
    return frag;
  }
  function bubble(who,text,kind){
    const b=node("div","bubble "+kind);b.append(node("small","",who),richText(String(text)));$("chatbox").append(b);$("chatbox").scrollTop=$("chatbox").scrollHeight;
    if(kind==="bot"&&petMessagePending){petMessagePending=false;window.qbitPC?.sendPetReply?.(String(text));}
    if(!restoringChat&&user){ensureActiveChat();const chat=chatHistory.find(c=>c.id===activeChatId);if(chat){chat.messages.push({who,text:String(text),kind,at:new Date().toISOString()});if(chat.messages.filter(m=>m.kind==="user").length===1)chat.title=String(text).slice(0,48);chat.updatedAt=new Date().toISOString();saveHistory();renderHistory();}}
  }
  function showChat(id,switchToChat=true){
    const chat=chatHistory.find(c=>c.id===id);if(!chat)return;
    activeChatId=id;restoringChat=true;$("chatbox").replaceChildren();
    chat.messages.forEach(m=>{const b=node("div","bubble "+m.kind);b.append(node("small","",m.who),document.createTextNode(m.text));$("chatbox").append(b);});
    if(!chat.messages.length){const b=node("div","bubble bot");b.append(node("small","","QBIT"),document.createTextNode("Chat vacío. Escribí un mensaje para empezar. ✨"));$("chatbox").append(b);}
    restoringChat=false;$("chatbox").scrollTop=$("chatbox").scrollHeight;renderHistory();
    if(switchToChat)activateTab("chatView");
  }
  function renderHistory(){
    const list=$("historyList");if(!list)return;list.replaceChildren();
    if(!chatHistory.length){list.append(node("div","empty","Todavía no hay conversaciones guardadas."));return;}
    [...chatHistory].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).forEach(chat=>{
      const preview=[...chat.messages].reverse().find(m=>m.kind==="user")?.text||"Conversación vacía";
      const date=new Date(chat.updatedAt||chat.createdAt);
      const detail=(Number.isNaN(date.getTime())?"":new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short"}).format(date))+" · "+chat.messages.length+" mensajes\n"+preview;
      list.append(card(chat.title||"Nuevo chat",detail,[
        btn("Abrir","small",()=>showChat(chat.id,true)),
        btn("Borrar","small danger",()=>deleteChat(chat.id))
      ]));
    });
  }
  function deleteChat(id){
    if(!confirm("¿Borrar esta conversación del historial?"))return;
    chatHistory=chatHistory.filter(c=>c.id!==id);
    if(activeChatId===id){activeChatId=null;ensureActiveChat();$("chatbox").replaceChildren();bubble("QBIT","Chat nuevo. ¿Qué probamos? ✨","bot");}
    saveHistory();renderHistory();
  }
  function newChat(){
    const current=chatHistory.find(c=>c.id===activeChatId);
    if(current&&!current.messages.some(m=>m.kind==="user")&&current.messages.length===0){showChat(current.id,false);return;}
    const chat={id:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(36).slice(2)),title:"Nuevo chat",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
    chatHistory.unshift(chat);activeChatId=chat.id;saveHistory();$("chatbox").replaceChildren();
    bubble("QBIT","Chat nuevo. ¿Qué probamos? ✨","bot");
    renderHistory();activateTab("chatView");
  }
  function activateTab(id){
    document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
    ["chatView","historyView","connectorView","mascotSettingsView","adminView"].forEach(view=>$(view).classList.toggle("hidden",view!==id));
    if(id==="mascotSettingsView")void loadPetSettings();if(id==="connectorView")void refreshConnectorStatus();
  }
  function solveMathQuestion(message){
    let s=normalizeText(message);
    const match=s.match(/^cuanto es\s+(.+)$/);
    if(!match)return null;
    s=match[1]
      .replace(/dividido entre|dividido por|dividida entre|dividida por/g,"/")
      .replace(/multiplicado por|multiplicada por/g,"*")
      .replace(/\bpor\b/g,"*")
      .replace(/\bx\b/g,"*")
      .replace(/\bmas\b/g,"+")
      .replace(/\bmenos\b/g,"-")
      .replace(/[×·]/g,"*")
      .replace(/÷/g,"/")
      .replace(/,/g,".");
    if(!/^[\d\s.+*/()\-]+$/.test(s)||!/\d/.test(s))return null;
    const tokens=s.match(/\d+(?:\.\d+)?|[()+*/-]/g);
    if(!tokens||tokens.join("")!==s.replace(/\s/g,""))return null;
    let i=0;
    function factor(){
      if(tokens[i]==="+"){i++;return factor();}
      if(tokens[i]==="-"){i++;return -factor();}
      if(tokens[i]==="("){i++;const v=expression();if(tokens[i]!==")")throw Error("paréntesis");i++;return v;}
      const t=tokens[i++];if(!t||!/^\d+(?:\.\d+)?$/.test(t))throw Error("número");
      return Number(t);
    }
    function term(){let v=factor();while(tokens[i]==="*"||tokens[i]==="/"){const op=tokens[i++],n=factor();v=op==="*"?v*n:v/n;}return v;}
    function expression(){let v=term();while(tokens[i]==="+"||tokens[i]==="-"){const op=tokens[i++],n=term();v=op==="+"?v+n:v-n;}return v;}
    try{const result=expression();if(i!==tokens.length||!Number.isFinite(result))return "No puedo resolver esa cuenta (revisá si hay una división por cero).";return "Da "+Number(result.toPrecision(12))+" 🧮";}catch{return null;}
  }
  function session(u){const changed=user?.id!==u?.id;user=u;$("loginView").classList.toggle("hidden",!!u);$("appView").classList.toggle("hidden",!u);$("userBar").classList.toggle("hidden",!u);$("userEmail").textContent=u?u.email:"";if(changed&&u)loadHistory();if(!u){chatHistory=[];activeChatId=null;}}
  function notice(t,error=false){$("adminMsg").textContent=t;$("adminMsg").className=t?(error?"notice error":"notice"):"";}
  function card(title,detail,actions){const c=node("div","item"),h=node("div","item-head"),a=node("div","item-actions");h.append(node("strong","",title));actions.forEach(x=>a.append(x));h.append(a);c.append(h);if(detail)c.append(node("p","muted",detail));return c;}
  async function refresh(){
    const [a,b,c]=await Promise.all([
      db.from("qbit_categories").select("id,name").order("name"),
      db.from("qbit_commands").select("id,name,trigger_text,category_id").order("name"),
      db.from("qbit_responses").select("id,command_id,content,is_active,priority").order("priority",{ascending:false})
    ]);
    const error=a.error||b.error||c.error;if(error){notice("Error al cargar: "+error.message,true);return;}

    categories=a.data||[];commands=b.data||[];responses=c.data||[];
    const variants={
      "hola":["¡Buenas! ¿En qué te doy una mano? 👋","¡Ey, hola! Acá QBIT, listo para ayudarte.","¡Hola! ¿Qué hacemos hoy?"],
      "buenas":["¡Buenas! 😎 ¿Todo bien?","¡Buenasss! ¿Qué onda?","¡Hola! ¿Qué necesitás?"],
      "gracias":["¡No hay de qué! 😊","¡Cuando quieras!","¡De nada! Para eso estoy."],
      "ayuda":["Podés probar hola, buenas, gracias, quién sos, qué podés hacer o contame un chiste.","¡Estoy para ayudarte! Escribí uno de los comandos que ya tengo configurados.","Si querés cambiar lo que respondo, entrá a Admin y editá las respuestas."],
      "quién sos":["Soy QBIT, tu asistente personal. Respondo usando comandos guardados.","¡Soy QBIT! Todavía estoy aprendiendo comandos, pero podés configurar mis respuestas.","Me llamo QBIT y soy un asistente personal en desarrollo."],
      "qué podés hacer":["Puedo responder los comandos que tengo configurados. ¡Probá alguno!","Por ahora funciono con comandos y respuestas guardadas en Supabase.","Podés probar los comandos del panel y administrar todo desde Admin."],
      "contame un chiste":["¿Qué le dice un techo a otro? Techo de menos. 😄","¿Cuál es el colmo de un jardinero? Que siempre lo dejen plantado. 🌱","¿Qué hace una computadora cuando tiene frío? Cierra Windows. 🥶"]
    };
    let seeded=false;
    for(const [trigger,contents] of Object.entries(variants)){
      const cmd=commands.find(x=>x.trigger_text===trigger);
      if(!cmd)continue;
      for(const value of contents){
        if(responses.some(x=>x.command_id===cmd.id&&x.content===value))continue;
        const {data:added,error:addError}=await db.from("qbit_responses").insert({user_id:user.id,command_id:cmd.id,content:value,is_active:true,priority:1}).select("id,command_id,content,is_active,priority").single();
        if(addError){notice("No se pudieron guardar las variantes: "+addError.message,true);return;}
        responses.push(added);seeded=true;
      }
    }
    if(seeded){notice("¡Se agregaron las variantes de respuesta!");}

    if(["hola","ayuda","gracias","quién sos","qué podés hacer","contame un chiste"].some(t=>!commands.some(cmd=>cmd.trigger_text===t))){await addStarterCommands();return;}
    render();
  }
  function render(){
    const cl=$("categoriesList"),ml=$("commandsList"),rl=$("responsesList"),qc=$("quickCommands");
    [cl,ml,rl,qc].forEach(x=>x.replaceChildren());
    const cs=$("commandCategory"),rs=$("responseCommand");
    cs.replaceChildren(new Option(categories.length?"Elegí categoría":"Creá una categoría primero",""));
    categories.forEach(c=>cs.add(new Option(c.name,c.id)));
    rs.replaceChildren(new Option(commands.length?"Elegí comando":"Creá un comando primero",""));
    commands.forEach(c=>rs.add(new Option(c.name+" · "+c.trigger_text,c.id)));
    if(!categories.length)cl.append(node("div","empty","Todavía no hay categorías."));
    categories.forEach(c=>cl.append(card(c.name,"Categoría",[
      btn("Editar","small",()=>{ $("categoryId").value=c.id;$("categoryName").value=c.name;$("cancelCategory").classList.remove("hidden"); }),
      btn("Borrar","small danger",()=>remove("qbit_categories",c.id,"¿Borrar esta categoría?") )
    ])));
    if(!commands.length)ml.append(node("div","empty","Todavía no hay comandos."));
    const uncategorized=commands.filter(c=>!categories.some(cat=>cat.id===c.category_id));
    categories.forEach(cat=>{
      const grouped=commands.filter(c=>c.category_id===cat.id);
      if(!grouped.length)return;
      const group=node("section","command-category");
      group.append(node("h4","category-heading",cat.name));
      grouped.forEach(c=>group.append(card(c.name,"Activador: "+c.trigger_text,[
        btn("Editar","small",()=>{$("commandId").value=c.id;$("commandName").value=c.name;$("commandTrigger").value=c.trigger_text;$("commandCategory").value=c.category_id;$("cancelCommand").classList.remove("hidden");}),
        btn("Borrar","small danger",()=>remove("qbit_commands",c.id,"¿Borrar el comando?"))
      ])));
      ml.append(group);
    });
    if(uncategorized.length){
      const group=node("section","command-category");
      group.append(node("h4","category-heading","Sin categoría"));
      uncategorized.forEach(c=>group.append(card(c.name,"Activador: "+c.trigger_text,[
        btn("Editar","small",()=>{$("commandId").value=c.id;$("commandName").value=c.name;$("commandTrigger").value=c.trigger_text;$("commandCategory").value="";$("cancelCommand").classList.remove("hidden");}),
        btn("Borrar","small danger",()=>remove("qbit_commands",c.id,"¿Borrar el comando?"))
      ])));
      ml.append(group);
    }
    if(!responses.length)rl.append(node("div","empty","Todavía no hay respuestas."));
    responses.forEach(r=>{const c=commands.find(x=>x.id===r.command_id);rl.append(card((c?c.name:"Comando")+" · prioridad "+r.priority,(r.is_active?"Activa":"Inactiva")+"\n"+r.content,[
      btn("Editar","small",()=>{$("responseId").value=r.id;$("responseCommand").value=r.command_id;$("responseContent").value=r.content;$("responsePriority").value=r.priority;$("responseActive").checked=r.is_active;$("cancelResponse").classList.remove("hidden");}),
      btn("Borrar","small danger",()=>remove("qbit_responses",r.id,"¿Borrar esta respuesta?"))
    ]));});
    if(!commands.length)qc.append(node("div","empty","Agregá comandos desde el panel."));
    categories.forEach(cat=>{
      const grouped=commands.filter(c=>c.category_id===cat.id);
      if(!grouped.length)return;
      qc.append(node("h4","category-heading",cat.name));
      grouped.forEach(c=>{const x=node("div","item");x.append(node("strong","",c.name),node("p","muted","Escribí: "+c.trigger_text));x.append(btn("Probar comando","small",()=>{$("chatInput").value=c.trigger_text;$("sendForm").requestSubmit();}));qc.append(x);});
    });
    commands.filter(c=>!categories.some(cat=>cat.id===c.category_id)).forEach(c=>{const x=node("div","item");x.append(node("strong","","Sin categoría · "+c.name),node("p","muted","Escribí: "+c.trigger_text));x.append(btn("Probar comando","small",()=>{$("chatInput").value=c.trigger_text;$("sendForm").requestSubmit();}));qc.append(x);});
  }
  async function save(table,idField,values,reset){
    const id=$(idField).value,payload={...values,user_id:user.id};
    const result=id?await db.from(table).update(payload).eq("id",id):await db.from(table).insert(payload);
    if(result.error){notice("No se pudo guardar: "+result.error.message,true);return;}
    reset();notice("¡Guardado!");await refresh();
  }
  async function remove(table,id,question){
    if(!confirm(question))return;
    const {error}=await db.from(table).delete().eq("id",id);
    if(error){notice("No se pudo borrar. Si está relacionado con otros datos, borrá primero esos elementos. "+error.message,true);return;}
    notice("Elemento borrado.");await refresh();
  }
  function resetCategory(){$("categoryId").value="";$("categoryName").value="";$("cancelCategory").classList.add("hidden");}
  function resetCommand(){$("commandId").value="";$("commandName").value="";$("commandTrigger").value="";$("commandCategory").value="";$("cancelCommand").classList.add("hidden");}
  function resetResponse(){$("responseId").value="";$("responseCommand").value="";$("responseContent").value="";$("responsePriority").value="1";$("responseActive").checked=true;$("cancelResponse").classList.add("hidden");}
  $("loginForm").addEventListener("submit",async e=>{e.preventDefault();say("loginMsg","Iniciando sesión…");const {data,error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error){say("loginMsg","No se pudo iniciar sesión. Revisá los datos. "+error.message,true);return;}$("password").value="";session(data.user);await refresh();});
  $("logoutBtn").onclick=async()=>{await db.auth.signOut();session(null);};
  $("categoryForm").onsubmit=async e=>{e.preventDefault();await save("qbit_categories","categoryId",{name:$("categoryName").value.trim()},resetCategory);};
  $("commandForm").onsubmit=async e=>{e.preventDefault();if(!$("commandCategory").value){notice("Elegí una categoría primero.",true);return;}await save("qbit_commands","commandId",{name:$("commandName").value.trim(),trigger_text:$("commandTrigger").value.trim(),category_id:$("commandCategory").value},resetCommand);};
  $("responseForm").onsubmit=async e=>{e.preventDefault();if(!$("responseCommand").value){notice("Elegí un comando primero.",true);return;}await save("qbit_responses","responseId",{command_id:$("responseCommand").value,content:$("responseContent").value.trim(),priority:Number($("responsePriority").value)||0,is_active:$("responseActive").checked,updated_at:new Date().toISOString()},resetResponse);};
  $("cancelCategory").onclick=resetCategory;$("cancelCommand").onclick=resetCommand;$("cancelResponse").onclick=resetResponse;
  function getWebSearchRequest(message){
    const n=normalizeText(message).replace(/\s+/g," ").trim();
    const engines={
      google:{name:"Google",base:"https://www.google.com/search?q="},
      bing:{name:"Bing",base:"https://www.bing.com/search?q="},
      youtube:{name:"YouTube",base:"https://www.youtube.com/results?search_query="},
      wikipedia:{name:"Wikipedia",base:"https://es.wikipedia.org/w/index.php?search="},
      imagenes:{name:"Google Imágenes",base:"https://www.google.com/search?tbm=isch&q="},
      noticias:{name:"Google Noticias",base:"https://news.google.com/search?q="},
      mapas:{name:"Google Maps",base:"https://www.google.com/maps/search/"}
    };
    const site=n.match(/^(?:busca(?:r)?(?:me)?\s+(?:en\s+)?)(youtube|wikipedia|imagenes|noticias|mapas|bing|google)\s*(?:[:,-]\s*|\s+)(.+)$/);
    if(site){const key=site[1];return {engine:engines[key],query:site[2].trim()};}
    const general=n.match(/^(?:(?:busca(?:r)?(?:me)?)(?:\s+en)?(?:\s+la)?\s+(?:web|internet)|busca(?:r)?(?:me)?)\s*[:,-]?\s+(.+)$/);
    if(general)return {engine:engines.google,query:general[1].trim()};
    return null;
  }
  function getDesktopRequest(message){
    const n=normalizeText(message);
    const openMatch=n.match(/^(?:qbit )?(?:abre|abri|abrir|abrime|anda a|ve a|ir a|entra a|entrar a) (.+)$/);
    if(openMatch){
      const target=openMatch[1].replace(/^(?:la pagina de|la web de|el sitio de|la pagina|el sitio) /,"").trim();
      const apps={"calculadora":"calculadora","bloc de notas":"bloc de notas","notepad":"bloc de notas","paint":"paint","administrador de tareas":"administrador de tareas","explorador de archivos":"explorador","explorador":"explorador"};
      const folders={"inicio":"inicio","mi inicio":"inicio","documentos":"documentos","descargas":"descargas","escritorio":"escritorio","imagenes":"imagenes","musica":"musica","videos":"videos"};
      if(apps[target])return {type:"app",name:apps[target]};
      if(folders[target])return {type:"folder",name:folders[target]};
    }
    if(/^(?:subi|sube|aumenta|subir) (?:el )?volumen$/.test(n))return {type:"volume",action:"up"};
    if(/^(?:baja|baja|disminui|disminuye|bajar) (?:el )?volumen$/.test(n))return {type:"volume",action:"down"};
    if(/^(?:silencia|silencia|silenciar|mutea|mute) (?:el )?volumen$/.test(n)||n==="silencia"||n==="silenciar")return {type:"volume",action:"mute"};
    if(/^(?:informacion|datos) (?:de )?(?:mi )?(?:pc|computadora|equipo|sistema)$/.test(n)||["estado de mi pc","estado del sistema","como esta mi pc","informacion del sistema"].includes(n))return {type:"status"};
    if(["prepara el entorno de estudio","preparar el entorno de estudio","prepara mi entorno de estudio","modo estudio","inicia modo estudio"].includes(n))return {type:"automation",name:"study"};
    return null;
  }
  function getOpenRequest(message){
    const rawMessage=String(message).trim().replace(/[!?]+$/,"");
    const command=rawMessage.match(/^(?:qbit[,: ]+)?(?:abre|abrí|abrir|abrime|anda a|ve a|ir a|entra a|entrar a|open)\s+(.+)$/i);
    if(!command)return null;
    const targetRaw=command[1].trim().replace(/^(?:la pagina de|la web de|el sitio de|la pagina|el sitio)\s+/i,"").trim();
    const target=normalizeText(targetRaw);
    const sites=[
      {keys:["youtube","yt"],label:"YouTube",url:"https://www.youtube.com/"},
      {keys:["google"],label:"Google",url:"https://www.google.com/"},
      {keys:["bing"],label:"Bing",url:"https://www.bing.com/"},
      {keys:["wikipedia","wiki"],label:"Wikipedia",url:"https://es.wikipedia.org/"},
      {keys:["github","mi repositorio de github","mi repo de github","repositorio qbit","mi repositorio qbit"],label:"tu repositorio de QBIT en GitHub",url:"https://github.com/Gotti23b/QBIT"},
      {keys:["qbit"],label:"QBIT",url:"https://gotti23b.github.io/QBIT/"},
      {keys:["reddit"],label:"Reddit",url:"https://www.reddit.com/"},
      {keys:["google drive","drive"],label:"Google Drive",url:"https://drive.google.com/"},
      {keys:["gmail"],label:"Gmail",url:"https://mail.google.com/"},
      {keys:["google maps","maps","mapas"],label:"Google Maps",url:"https://maps.google.com/"},
      {keys:["google classroom","classroom"],label:"Google Classroom",url:"https://classroom.google.com/"},
      {keys:["spotify"],label:"Spotify",url:"https://open.spotify.com/"},
      {keys:["twitch"],label:"Twitch",url:"https://www.twitch.tv/"},
      {keys:["roblox"],label:"Roblox",url:"https://www.roblox.com/"},
      {keys:["minecraft"],label:"Minecraft",url:"https://www.minecraft.net/"}
    ];
    const site=sites.find(x=>x.keys.includes(target));
    if(site)return {type:"url",label:site.label,url:site.url};
    if(/^(?:la )?(?:calculadora|bloc de notas|notepad|explorador de archivos|configuracion|configuracion de windows|administrador de tareas|cmd|terminal|powershell|paint|word|excel|minecraft instalado)$/.test(target)){
      return {type:"local",label:target};
    }
    const urlText=targetRaw.replace(/^https?:\/\//i,"").replace(/\/+$/,"");
    const looksLikeFile=/\.(?:txt|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|mp3|mp4|zip|rar|7z|csv|json|js|html|css|py|md|log|xml|apk|exe|msi)$/i.test(urlText);
    if(!looksLikeFile&&/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(urlText)){
      const directUrl=/^https?:\/\//i.test(targetRaw)?targetRaw:"https://"+urlText;
      return {type:"url",label:urlText.split("/")[0],url:directUrl};
    }
    return {type:"unknown",label:targetRaw};
  }
  function getBrowserName(){
    const ua=navigator.userAgent||"";
    if(/Edg\//.test(ua))return "Microsoft Edge";
    if(/SamsungBrowser\//.test(ua))return "Samsung Internet";
    if(/OPR\//.test(ua)||/Opera/.test(ua))return "Opera";
    if(/Firefox\//.test(ua))return "Mozilla Firefox";
    if(/Chrome\//.test(ua))return "Google Chrome o un navegador basado en Chromium";
    if(/Safari\//.test(ua))return "Safari";
    return "un navegador no identificado";
  }
  async function getSystemAnswer(message){
    const n=normalizeText(message);
    const has=(...words)=>words.some(w=>n.includes(w));
    const now=new Date();
    if(has("que hora es","hora actual","hora de ahora","que fecha es","fecha de hoy","que dia es hoy","dia de hoy","hoy que dia","que dia estamos")){
      return "Ahora son las "+new Intl.DateTimeFormat("es-AR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now)+". Hoy es "+new Intl.DateTimeFormat("es-AR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(now)+". 🕒";
    }
    if(has("bateria","nivel de carga","esta cargando","esta enchufada","estado de carga")){
      if(!navigator.getBattery)return "Este navegador no permite consultar la batería desde una página web. 🔋";
      try{const b=await navigator.getBattery();return "Batería: "+Math.round(b.level*100)+" %. "+(b.charging?"Está cargándose ⚡":"No está cargándose")+(Number.isFinite(b.chargingTime)&&b.chargingTime!==Infinity&&b.chargingTime>0?" · Tiempo estimado para cargar: "+Math.round(b.chargingTime/60)+" min.":"")+(Number.isFinite(b.dischargingTime)&&b.dischargingTime!==Infinity&&b.dischargingTime>0?" · Tiempo estimado restante: "+Math.round(b.dischargingTime/60)+" min.":"");}
      catch{return "No pude acceder al estado de la batería. El navegador puede bloquear esta función. 🔋";}
    }
    if(has("informacion de mi pc","info de mi pc","datos de mi pc","informacion del sistema","datos del sistema","que equipo tengo")){
      const platform=navigator.userAgentData?.platform||navigator.platform||"No disponible";
      const mem=navigator.deviceMemory?("RAM estimada que informa el navegador: "+navigator.deviceMemory+" GB"):"RAM estimada: no disponible";
      const cores=navigator.hardwareConcurrency?("Procesadores lógicos informados: "+navigator.hardwareConcurrency):"Procesadores lógicos: no disponibles";
      const conn=navigator.connection;
      const net=conn?("Conexión estimada: "+(conn.effectiveType||"tipo desconocido")+(conn.downlink?" · "+conn.downlink+" Mb/s estimados":"")):"Tipo de conexión: no disponible en este navegador";
      return "Información que la página puede consultar:\n• Sistema/plataforma: "+platform+"\n• Navegador: "+getBrowserName()+"\n• Pantalla: "+screen.width+" × "+screen.height+" (escala "+(window.devicePixelRatio||1)+"×)\n• Idioma: "+(navigator.language||"no disponible")+"\n• Zona horaria: "+(Intl.DateTimeFormat().resolvedOptions().timeZone||"no disponible")+"\n• "+mem+"\n• "+cores+"\n• "+net+"\n• Conexión de red: "+(navigator.onLine?"aparece conectada":"aparece sin conexión")+"\n\nEstos datos son limitados; una página web no puede leer todo Windows.";
    }
    if(has("que navegador","nombre del navegador","cual es mi navegador"))return "Estás usando "+getBrowserName()+". 🌐";
    if(has("resolucion de pantalla","tamano de pantalla","mi pantalla","resolucion de mi pantalla"))return "La pantalla informa "+screen.width+" × "+screen.height+" píxeles CSS, con una escala de "+(window.devicePixelRatio||1)+"×. 🖥️";
    if(has("zona horaria","mi zona horaria"))return "La zona horaria que informa tu navegador es "+(Intl.DateTimeFormat().resolvedOptions().timeZone||"desconocida")+". 🌎";
    if(has("idioma del navegador","idioma tengo","que idioma usa"))return "El idioma principal del navegador es "+(navigator.language||"desconocido")+".";
    if(has("cuantos nucleos","procesadores logicos"))return navigator.hardwareConcurrency?"El navegador informa "+navigator.hardwareConcurrency+" procesadores lógicos. No necesariamente es el número físico de núcleos.":"Este navegador no informa esa cantidad.";
    if(has("memoria ram","cuanta ram","cuanta memoria"))return navigator.deviceMemory?"El navegador informa una estimación de "+navigator.deviceMemory+" GB de memoria del dispositivo; no es una lectura exacta de la RAM instalada.":"Este navegador no permite consultar una estimación de la RAM.";
    if(has("estoy conectado","hay internet","tengo internet","estado de internet","conexion a internet","conectado a internet","estoy online"))return navigator.onLine?"El navegador indica que hay conexión de red. Eso no garantiza por sí solo que Internet esté funcionando correctamente. 🌐":"El navegador indica que no hay conexión de red. 📡";
    if(has("donde estoy","mi ubicacion","ubicacion actual","ubicacion del dispositivo")){
      if(!navigator.geolocation)return "Este navegador no permite consultar la ubicación desde esta página.";
      return await new Promise(resolve=>navigator.geolocation.getCurrentPosition(
        p=>resolve("Ubicación aproximada autorizada por el navegador: latitud "+p.coords.latitude.toFixed(4)+", longitud "+p.coords.longitude.toFixed(4)+". Precisión estimada: "+Math.round(p.coords.accuracy)+" m."),
        e=>resolve(e.code===1?"No se concedió permiso para consultar la ubicación. Podés seguir usando QBIT sin activarlo.":e.code===2?"El dispositivo no pudo determinar la ubicación.":"La consulta de ubicación tardó demasiado o no se pudo completar."),
        {enableHighAccuracy:false,timeout:10000,maximumAge:60000}
      ));
    }
    return null;
  }
  $("sendForm").onsubmit=async e=>{
    e.preventDefault();
    const q=$("chatInput").value.trim();if(!q)return;
    bubble("Vos",q,"user");$("chatInput").value="";
    const desktopRequest=getDesktopRequest(q);
    if(desktopRequest){
      if(!window.qbitPC?.isDesktop){
        bubble("QBIT","Esa función necesita la aplicación de escritorio de QBIT instalada en Windows. La versión web no puede controlar programas, carpetas ni el volumen. 💻","bot");
        return;
      }
      if(desktopRequest.type==="automation"&&!window.confirm("QBIT va a abrir Calculadora, Bloc de notas y Documentos. ¿Querés continuar?")){
        bubble("QBIT","Automatización cancelada. 👍","bot");
        return;
      }
      try{
        if(desktopRequest.type==="app"){
          const result=await window.qbitPC.openApp(desktopRequest.name);
          bubble("QBIT",result.message+" 🖥️","bot");
        }else if(desktopRequest.type==="folder"){
          const result=await window.qbitPC.openFolder(desktopRequest.name);
          bubble("QBIT",result.message+" 📁","bot");
        }else if(desktopRequest.type==="volume"){
          const result=await window.qbitPC.volume(desktopRequest.action);
          bubble("QBIT",result.message+" 🔊","bot");
        }else if(desktopRequest.type==="automation"){
          const result=await window.qbitPC.runAutomation(desktopRequest.name);
          bubble("QBIT",result.message+" 📚","bot");
        }else if(desktopRequest.type==="status"){
          const st=await window.qbitPC.getStatus();
          bubble("QBIT","Información de tu PC 🖥️\n• Sistema: "+st.os+"\n• Equipo: "+st.computer+"\n• Procesador: "+st.cpu+"\n• Procesadores lógicos: "+st.logicalProcessors+"\n• RAM total: "+st.ramTotalGB+" GB\n• RAM libre: "+st.ramFreeGB+" GB\n• Tiempo encendida: "+st.uptimeHours+" horas"+(st.batteryPercent===null?"":"\n• Batería: "+st.batteryPercent+" %"),"bot");
        }
      }catch(error){
        bubble("QBIT","No pude completar esa acción: "+(error?.message||"error desconocido")+" ⚠️","bot");
      }
      return;
    }
    const openRequest=getOpenRequest(q);
    if(openRequest){
      if(openRequest.type==="url"){
        if(window.qbitPC?.isDesktop){
          try{await window.qbitPC.openUrl(openRequest.url);bubble("QBIT","Abriendo "+openRequest.label+" en tu navegador 🌐","bot");}
          catch(error){bubble("QBIT","No pude abrir el sitio: "+(error?.message||"error desconocido"),"bot");}
        }else{
          const opened=window.open(openRequest.url,"_blank");
          if(opened)opened.opener=null;
          bubble("QBIT",opened===null?"El navegador bloqueó la pestaña. Permití las ventanas emergentes para QBIT y volvé a intentarlo.":"Abriendo "+openRequest.label+" 🌐","bot");
        }
      }else if(openRequest.type==="local" || openRequest.type==="unknown"){
        if(window.qbitPC?.isDesktop){
          try{
            const result=await window.qbitPC.openAnything(openRequest.label);
            bubble("QBIT",result.message+" ✨","bot");
          }catch(error){
            bubble("QBIT","No pude abrirlo: "+(error?.message||"error desconocido")+" 🔎","bot");
          }
        }else if(openRequest.type==="local"){
          bubble("QBIT","Para abrir archivos y aplicaciones de Windows necesitás usar QBIT Desktop; la versión web no puede acceder a tus archivos locales. 💻","bot");
        }else{
          bubble("QBIT","No reconocí ese sitio. Probá con un nombre conocido (por ejemplo, YouTube o GitHub) o escribí el dominio, como ejemplo.com. 🌐","bot");
        }
      }
      return;
    }
    const webRequest=getWebSearchRequest(q);
    if(webRequest&&webRequest.query){
      const searchUrl=webRequest.engine.base+encodeURIComponent(webRequest.query);
      if(window.qbitPC?.isDesktop){
        try{await window.qbitPC.openUrl(searchUrl);bubble("QBIT","Abriendo la búsqueda en "+webRequest.engine.name+": "+webRequest.query+" 🔎","bot");}
        catch(error){bubble("QBIT","No pude abrir la búsqueda: "+(error?.message||"error desconocido"),"bot");}
      }else{
        window.open(searchUrl,"_blank","noopener,noreferrer");
        bubble("QBIT","Abriendo "+webRequest.engine.name+" para buscar: "+webRequest.query+" 🔎\n\nQBIT abre la búsqueda en otra pestaña; no puede leer automáticamente todos los resultados de Google desde esta página por las restricciones de seguridad del navegador. Si no se abre, revisá el bloqueo de ventanas emergentes.","bot");
      }
      return;
    }
    const systemAnswer=await getSystemAnswer(q);
    if(systemAnswer){bubble("QBIT",systemAnswer,"bot");return;}
    const mathAnswer=solveMathQuestion(q);
    if(mathAnswer!==null){bubble("QBIT",mathAnswer,"bot");return;}
    const n=normalizeText(q);
    const found=commands.filter(c=>{const trigger=normalizeText(c.trigger_text);return trigger&&(" "+n+" ").includes(" "+trigger+" ");}).sort((a,b)=>normalizeText(b.trigger_text).length-normalizeText(a.trigger_text).length)[0];
    const activeResponses=found?responses.filter(x=>x.command_id===found.id&&x.is_active):[];
    if(!found||!activeResponses.length){
      if(window.qbitPC?.isDesktop){const waiting=node("div","bubble bot");waiting.append(node("small","","QBIT"),document.createTextNode("Consultando la IA del navegador…"));$("chatbox").append(waiting);$("chatbox").scrollTop=$("chatbox").scrollHeight;try{const prompt=aiGuideSent?q:aiGuide()+q;const result=await window.qbitPC.askBrowserAI(prompt);aiGuideSent=true;const providerLabel=$("activeProvider");if(providerLabel&&result.provider){providerLabel.textContent="· "+String(result.provider);providerLabel.classList.remove("hidden");}waiting.remove();const {clean,calls}=extractArtifactBlocks(result.answer||"");if(clean||!calls.length)bubble("QBIT",clean||"La IA no devolvió una respuesta.","bot");for(const call of calls)bubble("QBIT",await runArtifactBlock(call),"bot");}catch(error){waiting.remove();bubble("QBIT","No encontré una respuesta guardada y no pude consultar la IA: "+(error?.message||"conector desconectado")+". Revisá la pestaña Conector. 🔌","bot");}}
      else bubble("QBIT",found?"Encontré el comando, pero no tiene respuestas activas.":"Todavía no tengo una respuesta para eso. Podés agregar el comando desde el panel de administración.","bot");
      return;
    }
    const r=activeResponses[Math.floor(Math.random()*activeResponses.length)];
    bubble("QBIT",r.content,"bot");
  };
  window.qbitPC?.onPetMessage?.(message=>{const input=$("chatInput");if(!input)return;petMessagePending=true;input.value=String(message||"").slice(0,500);$("sendForm").requestSubmit();});
  $("clearChat").onclick=()=>newChat();
  $("newChatFromHistory").onclick=()=>newChat();
  $("newChatSidebar")?.addEventListener("click",()=>newChat());
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));

  function connectorNotice(message,error=false){const el=$("connectorStatus");if(el){el.textContent=message;el.className=error?"notice error":"notice";}}
  async function refreshConnectorStatus(){if(!window.qbitPC?.isDesktop){connectorNotice("Disponible en QBIT Desktop para Windows.",true);return;}try{const s=await window.qbitPC.getConnectorStatus();connectorNotice(s.running?(s.connected?"Conector activo · Extensión conectada.":"Conector activo · Esperando Chrome."):"Conector detenido. Inicialo para usar la IA.");}catch(e){connectorNotice("No pude consultar el estado: "+(e?.message||"error"),true);}}
  $("connectorStart")?.addEventListener("click",async()=>{try{const s=await window.qbitPC.startConnector();connectorNotice(s.message||"Conector iniciado.");}catch(e){connectorNotice(e?.message||"No se pudo iniciar.",true);}await refreshConnectorStatus();});
  $("connectorStop")?.addEventListener("click",async()=>{try{await window.qbitPC.stopConnector();connectorNotice("Conector desconectado.");}catch(e){connectorNotice(e?.message||"No se pudo detener.",true);}await refreshConnectorStatus();});
  $("connectorFolder")?.addEventListener("click",async()=>{try{await window.qbitPC.openExtensionFolder();}catch(e){connectorNotice(e?.message||"No pude abrir la carpeta.",true);}});
  $("connectorChrome")?.addEventListener("click",async()=>{try{await window.qbitPC.openChromeExtensions();}catch(e){connectorNotice("Abrí chrome://extensions manualmente. "+(e?.message||""),true);}});
  setInterval(()=>{if(!$("connectorView")?.classList.contains("hidden"))void refreshConnectorStatus();},2500);
  function petSettingsMessage(text,error=false){const el=$("petSettingsNotice");if(!el)return;el.textContent=text;el.className=error?"notice error":"notice";}
  async function loadPetSettings(){
    if(!window.qbitPC?.isDesktop){$("petSettingsForm").classList.add("hidden");petSettingsMessage("Esta configuración está disponible en QBIT Desktop para Windows.",true);return;}
    $("petSettingsForm").classList.remove("hidden");
    try{const s=await window.qbitPC.getPetSettings();$("petVisible").checked=s.visible!==false;$("petSize").value=["small","normal","large"].includes(s.size)?s.size:"normal";$("petAnimations").checked=s.animations!==false;petSettingsMessage("Configuración cargada. Guardá los cambios para aplicarlos.");}
    catch(e){petSettingsMessage("No pude cargar la configuración: "+(e?.message||"error desconocido"),true);}
  }
  $("petSettingsForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!window.qbitPC?.isDesktop){petSettingsMessage("Necesitás QBIT Desktop para aplicar estos ajustes.",true);return;}
    try{const s=await window.qbitPC.setPetSettings({visible:$("petVisible").checked,size:$("petSize").value,animations:$("petAnimations").checked});$("petVisible").checked=s.visible;$("petSize").value=s.size;$("petAnimations").checked=s.animations;petSettingsMessage("¡Listo! La configuración de la mascota se guardó y se aplicó. 💠");}
    catch(err){petSettingsMessage("No pude guardar los cambios: "+(err?.message||"error desconocido"),true);}
  });
  $("petResetPosition").addEventListener("click",async()=>{
    if(!window.qbitPC?.isDesktop){petSettingsMessage("Necesitás QBIT Desktop para mover la mascota.",true);return;}
    try{await window.qbitPC.resetPetPosition();$("petVisible").checked=true;petSettingsMessage("¡Mascota devuelta a la esquina inferior derecha!");}
    catch(e){petSettingsMessage("No pude restablecer la posición: "+(e?.message||"error desconocido"),true);}
  });
  db.auth.onAuthStateChange((event)=>{if(event==="SIGNED_OUT")session(null);});
  async function addStarterCommands(){
    if(!user)return;
    const groups=[
      {name:"Básicos",items:[
        ["Saludar","hola","¡Hola! 👋 Soy QBIT. ¿Qué necesitás?"],
        ["Pedir ayuda","ayuda","Probá: hola, ayuda, quién sos, qué podés hacer, gracias o contame un chiste."],
        ["Dar las gracias","gracias","¡De nada! 😄"]
      ]},
      {name:"QBIT",items:[
        ["Quién sos","quién sos","Soy QBIT, tu asistente personal. Por ahora respondo con comandos guardados en Supabase."],
        ["Qué podés hacer","qué podés hacer","Por ahora respondo a los comandos configurados. Podés administrar categorías, comandos y respuestas desde Admin."]
      ]},
      {name:"Diversión",items:[
        ["Contar un chiste","contame un chiste","¿Qué hace una abeja en el gimnasio? ¡Zum-ba! 🐝"]
      ]}
    ];
    for(const group of groups){
      let {data:cat,error:catError}=await db.from("qbit_categories").select("id").eq("user_id",user.id).eq("name",group.name).maybeSingle();
      if(catError){notice("No se pudo buscar la categoría "+group.name+": "+catError.message,true);return;}
      if(!cat){
        const created=await db.from("qbit_categories").insert({user_id:user.id,name:group.name}).select("id").single();
        cat=created.data;catError=created.error;
        if(catError){notice("No se pudo crear la categoría "+group.name+": "+catError.message,true);return;}
      }
      for(const item of group.items){
        const {data:existing,error:existingError}=await db.from("qbit_commands").select("id").eq("user_id",user.id).eq("trigger_text",item[1]).maybeSingle();
        if(existingError){notice("No se pudo comprobar el comando "+item[0]+": "+existingError.message,true);return;}
        if(existing)continue;
        const {data:cmd,error:cmdError}=await db.from("qbit_commands").insert({user_id:user.id,category_id:cat.id,name:item[0],trigger_text:item[1]}).select("id").single();
        if(cmdError){notice("No se pudo crear el comando "+item[0]+": "+cmdError.message,true);return;}
        const {error:respError}=await db.from("qbit_responses").insert({user_id:user.id,command_id:cmd.id,content:item[2],is_active:true,priority:1});
        if(respError){notice("No se pudo guardar la respuesta de "+item[0]+": "+respError.message,true);return;}
      }
    }
    notice("¡Listo! Se agregaron 6 comandos iniciales.");
    await refresh();
  }
  (async()=>{const {data}=await db.auth.getSession();if(data.session){session(data.session.user);await refresh();}else session(null);})();
})();