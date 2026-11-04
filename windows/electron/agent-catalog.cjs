"use strict";
// Catálogo de herramientas PC que el agente puede pedir (mismos nombres que AI_ARTIFACTS en app.js).
const CATALOG = [
  'open_anything {"query"}', 'system_info {}', 'volume {"action":"up|down|mute"} | {"action":"set","level":0-100}',
  'web_search {"query"}', 'time_date {}', 'open_settings {"page"}', 'lock_pc {}', 'battery_info {}', 'network_info {}',
  'display_info {}', 'brightness_info {}', 'brightness_set {"level"}', 'media_control {"action":"play_pause|next|previous|stop"}',
  'create_folder {"base":"documentos|descargas|escritorio","path"}', 'create_file {"base","path","content"}',
  'search_files {"query"}', 'clipboard_write {"text"}', 'get_processes {}', 'cpu_usage {}', 'ram_usage {}', 'disk_usage {}',
  'focus_app {"query"}', 'close_window {"query"}', 'open_file_location {"query"}', 'get_file_info {"query"}',
  'zip_files {"query"}', 'unzip_file {"query"}', 'read_text_file {"query"}', 'show_notification {"title","message"}',
  'set_timer {"seconds","label"}', 'open_calculator {}', 'open_notepad {}', 'volume_info {}', 'volume_set {"level"}', 'computer_observe {}', 'computer_click {"target":"nombre o AutomationId"}', 'computer_type {"text":"texto"}', 'computer_key {"key":"ENTER|TAB|ESCAPE|BACKSPACE|DELETE|UP|DOWN|LEFT|RIGHT|CTRL+A|CTRL+C|CTRL+V"}'
].join("; ");

// Herramientas de solo lectura: se pueden usar como fuente de "vigilar" sin pedir permiso en cada consulta.
const SILENT_TOOLS = new Set(["system_info", "time_date", "battery_info", "network_info", "display_info",
  "brightness_info", "get_processes", "cpu_usage", "ram_usage", "disk_usage", "volume_info"]);

module.exports = { CATALOG, SILENT_TOOLS };
