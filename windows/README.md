# QBIT para escritorio (Windows)

QBIT mantiene su versión web y agrega una aplicación de escritorio basada en Electron para las funciones locales de Windows.

## Requisitos
- Windows 10/11 de 64 bits
- Node.js LTS instalado (incluye npm)
- Conexión a internet para iniciar sesión y usar la base de datos de Supabase

## Ejecutar en modo de desarrollo
1. Descargá o cloná este repositorio en la PC.
2. Abrí una terminal dentro de la carpeta del proyecto.
3. Ejecutá:

   npm install
   npm start

## Funciones locales disponibles
- Abrir Calculadora, Bloc de notas, Paint, Administrador de tareas y Explorador.
- Buscar y abrir archivos por nombre parcial en Escritorio, Documentos, Descargas, Imágenes, Música, Videos y carpetas de OneDrive; también buscar aplicaciones por nombre en el menú Inicio.
- Abrir Inicio, Documentos, Descargas, Escritorio, Imágenes, Música y Videos.
- Consultar sistema operativo, modelo de CPU, procesadores lógicos, RAM total/libre y tiempo de actividad.
- Subir, bajar o alternar el silencio del volumen mediante las teclas multimedia de Windows.
- Automatización predefinida «preparar entorno de estudio»: abre Calculadora, Bloc de notas y Documentos.

## Comandos de ejemplo en el chat
- `abrí calculadora`
- `abrí bloc de notas`
- `abrí paint`
- `abrí descargas`
- `abrí documentos`
- `abrí xdxdarchivoxdxd` (busca coincidencias de archivos por nombre)
- `abrí Word` (busca la aplicación en el menú Inicio)
- `información de mi PC`
- `subí el volumen`
- `bajá el volumen`
- `silenciá el volumen`
- `prepará el entorno de estudio`

La automatización de estudio pide confirmación desde el chat antes de ejecutarse.

## Seguridad y límites
La aplicación no ejecuta comandos de terminal arbitrarios ni programas ejecutables encontrados como archivos normales. Busca archivos en carpetas de usuario conocidas y aplicaciones mediante accesos directos del menú Inicio; no solicita privilegios de administrador. El proceso principal valida cada operación contra una lista permitida. La integración con Windows solo existe en la aplicación Electron; GitHub Pages sigue siendo una versión web sin acceso local a estos controles.
