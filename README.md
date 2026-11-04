# QBIT Extension (carga descomprimida)

La carpeta `extension` es la que se carga desde Chrome en modo desarrollador.

1. Ejecutá `install-qbit-extension.bat` del paquete. Copia la extensión y la consola a `%LOCALAPPDATA%\QBIT Extension`, registra el enlace local que abre la consola y muestra Chrome.
2. En `chrome://extensions`, activá **Modo de desarrollador** y elegí **Cargar descomprimida**.
3. Seleccioná `%LOCALAPPDATA%\QBIT Extension\extension` y recargá las pestañas de QBIT y del proveedor de IA.
4. Iniciá sesión en [QBIT](https://gotti23b.github.io/QBIT/) y en ChatGPT o Arena.ai. También se reconocen Gemini, Claude, DeepSeek, Qwen y Meta AI.
5. Hacé clic en **Conectar IA** dentro de QBIT. Se abre QBIT Console; dejala abierta. Los comandos y respuestas prefabricadas se resuelven primero y las consultas restantes viajan a la pestaña activa de IA y vuelven al chat de QBIT.

No configures API keys. La extensión escribe el mensaje en la página del proveedor y lee la respuesta visible en esa misma conversación.

La consola solo escucha en `127.0.0.1:17614`. También podés iniciarla con `start-qbit-console.bat`. Si Chrome muestra una confirmación al abrir la consola, aceptala.

## Qué hay en cada carpeta

- `windows/electron/`: la app de escritorio QBIT Desktop. Abre el conector local y lo usa con la extensión de `browser-extension/`.
- `browser-extension/`: la extensión de Chrome que usa QBIT Desktop. La app la actualiza sola con cada release.
- `extension/`, `qbit-console.ps1`, `install-qbit-extension.*`, `start-qbit-console.bat`: la versión independiente para usar QBIT web con la consola de PowerShell.
- `.github/workflows/build-windows.yml`: arma el instalador y publica el release cuando cambia la `version` de `package.json`.

QBIT Desktop y la consola de PowerShell usan el mismo puerto (`127.0.0.1:17614`). Usá solo una de las dos a la vez.

La consola de PowerShell solo reenvía texto: no ejecuta comandos ni lo que escribe la IA.


## BOTS y automatizaciones (QBIT Desktop 1.5.9)

La sección **BOTS** permite crear agentes persistentes que trabajan con la IA conectada mediante QBIT Extension y ejecutan los Artifacts de escritorio existentes, respetando sus permisos y confirmaciones.

Funciones incluidas:
- Crear, configurar, activar, pausar y borrar bots.
- Asignar a cada bot tareas manuales, recurrentes por intervalo o programadas para una fecha y hora.
- Editar y borrar tareas; ejecutarlas ahora, pausarlas, reanudarlas o detenerlas.
- Reintentar tareas programadas que fallen: el motor vuelve a intentarlo al minuto siguiente.
- Guardar bots, tareas, próximas ejecuciones y hasta 500 registros de actividad en la carpeta de datos de QBIT.
- Reanudar las tareas activas al abrir QBIT. El motor solo consulta a la IA cuando una tarea se ejecuta; el temporizador local revisa vencimientos cada cinco segundos.
- Enviar los bloques `qbit` devueltos por la IA al ejecutor de Artifacts de QBIT, que conserva las confirmaciones y permisos configurados.

Las tareas automáticas funcionan mientras QBIT Desktop esté abierto, incluso si la ventana principal está minimizada en la bandeja. Al salir completamente de QBIT, el temporizador se detiene y el estado queda guardado.

**Límites de esta versión:** la programación por intervalo y fecha/hora ya está disponible, pero todavía no hay detectores específicos de eventos externos (por ejemplo, vigilar automáticamente las novedades de Classroom o detectar que un video se publicó), observación continua de pantalla/Computer Use autónomo ni colaboración coordinada entre varios bots. Esas capacidades requieren integraciones adicionales y no se presentan como terminadas.
