(() => {
  const URL = "https://jtxyzfjgspnmzlvztjqx.supabase.co";
  const KEY = "sb_publishable_s6GXW0tRJR9vo2T2VdPH7Q_otjhGunV";
  const db = window.supabase.createClient(URL, KEY);
  const $ = id => document.getElementById(id);
  let user = null, categories = [], commands = [], responses = [];
  const say = (id, text, error=false) => { $(id).textContent=text; $(id).className=error?"error":"muted"; };
  const node = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const btn = (text, cls, fn) => { const b=node("button",cls,text); b.type="button"; b.onclick=fn; return b; };
  function bubble(who,text,kind){const b=node("div","bubble "+kind);b.append(node("small","",who),document.createTextNode(text));$("chatbox").append(b);$("chatbox").scrollTop=$("chatbox").scrollHeight;}
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
  $("sendForm").onsubmit=e=>{e.preventDefault();const q=$("chatInput").value.trim();if(!q)return;bubble("Vos",q,"user");$("chatInput").value="";const n=q.toLocaleLowerCase("es");const found=commands.filter(c=>n.includes(c.trigger_text.toLocaleLowerCase("es"))).sort((a,b)=>b.trigger_text.length-a.trigger_text.length)[0];if(!found){bubble("QBIT","Todavía no tengo una respuesta para eso. Podés agregar el comando desde el panel de administración.","bot");return;}const r=responses.filter(x=>x.command_id===found.id&&x.is_active).sort((a,b)=>b.priority-a.priority)[0];bubble("QBIT",r?r.content:"Encontré el comando, pero todavía no tiene respuestas activas.","bot");};
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