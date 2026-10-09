(() => {
  const URL = "https://jtxyzfjgspnmzlvztjqx.supabase.co";
  const KEY = "sb_publishable_s6GXW0tRJR9vo2T2VdPH7Q_otjhGunV";
  const db = window.supabase.createClient(URL, KEY);
  const $ = id => document.getElementById(id);
  let user = null, categories = [], commands = [], responses = [];
  const say = (id, text, error=false) => { $(id).textContent=text; $(id).className=error?"error":"muted"; };
  const node = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  function normalizeText(value){ return String(value).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[¿?¡!.,;:]/g," ").replace(/\s+/g," ").trim(); }
  const btn = (text, cls, fn) => { const b=node("button",cls,text); b.type="button"; b.onclick=fn; return b; };
  function bubble(who,text,kind){const b=node("div","bubble "+kind);b.append(node("small","",who),document.createTextNode(text));$("chatbox").append(b);$("chatbox").scrollTop=$("chatbox").scrollHeight;}
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
  function session(u){user=u;$("loginView").classList.toggle("hidden",!!u);$("appView").classList.toggle("hidden",!u);$("userBar").classList.toggle("hidden",!u);$("userEmail").textContent=u?u.email:"";}
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
    if(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(urlText)){
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
          bubble("QBIT","Información de tu PC 🖥️\\n• Sistema: "+st.os+"\\n• Equipo: "+st.computer+"\\n• Procesador: "+st.cpu+"\\n• Procesadores lógicos: "+st.logicalProcessors+"\\n• RAM total: "+st.ramTotalGB+" GB\\n• RAM libre: "+st.ramFreeGB+" GB\\n• Tiempo encendida: "+st.uptimeHours+" horas","bot");
        }
      }catch(error){
        bubble("QBIT","No pude completar esa acción: "+(error?.message||"error desconocido")+" ⚠️","bot");
      }
      return;
    }
    const openRequest=getOpenRequest(q);
    if(openRequest){
      if(openRequest.type==="url"){
        const opened=window.open(openRequest.url,"_blank");
        if(opened)opened.opener=null;
        bubble("QBIT",opened===null?"El navegador bloqueó la pestaña. Permití las ventanas emergentes para QBIT y volvé a intentarlo.":"Abriendo "+openRequest.label+" 🌐","bot");
      }else if(openRequest.type==="local"){
        bubble("QBIT","Puedo abrir páginas web, pero esta versión de QBIT funciona dentro del navegador y no tiene permiso para ejecutar programas o abrir archivos locales de Windows. Para eso haría falta una aplicación auxiliar instalada en la PC. 💻","bot");
      }else{
        bubble("QBIT","No reconocí ese sitio. Probá con un nombre conocido (por ejemplo, YouTube o GitHub) o escribí el dominio, como ejemplo.com. 🌐","bot");
      }
      return;
    }
    const webRequest=getWebSearchRequest(q);
    if(webRequest&&webRequest.query){
      const searchUrl=webRequest.engine.base+encodeURIComponent(webRequest.query);
      window.open(searchUrl,"_blank","noopener,noreferrer");
      bubble("QBIT","Abriendo "+webRequest.engine.name+" para buscar: "+webRequest.query+" 🔎\n\nQBIT abre la búsqueda en otra pestaña; no puede leer automáticamente todos los resultados de Google desde esta página por las restricciones de seguridad del navegador. Si no se abre, revisá el bloqueo de ventanas emergentes.","bot");
      return;
    }
    const systemAnswer=await getSystemAnswer(q);
    if(systemAnswer){bubble("QBIT",systemAnswer,"bot");return;}
    const mathAnswer=solveMathQuestion(q);
    if(mathAnswer!==null){bubble("QBIT",mathAnswer,"bot");return;}
    const n=normalizeText(q);
    const found=commands.filter(c=>{const trigger=normalizeText(c.trigger_text);return trigger&&(" "+n+" ").includes(" "+trigger+" ");}).sort((a,b)=>normalizeText(b.trigger_text).length-normalizeText(a.trigger_text).length)[0];
    if(!found){bubble("QBIT","Todavía no tengo una respuesta para eso. Podés agregar el comando desde el panel de administración.","bot");return;}
    const activeResponses=responses.filter(x=>x.command_id===found.id&&x.is_active);
    const r=activeResponses.length?activeResponses[Math.floor(Math.random()*activeResponses.length)]:null;
    bubble("QBIT",r?r.content:"Encontré el comando, pero todavía no tiene respuestas activas.","bot");
  };
  $("clearChat").onclick=()=>{$("chatbox").replaceChildren();bubble("QBIT","Chat limpio. ¿Qué probamos?","bot");};
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("chatView").classList.toggle("hidden",b.dataset.tab!=="chatView");$("adminView").classList.toggle("hidden",b.dataset.tab!=="adminView");});
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