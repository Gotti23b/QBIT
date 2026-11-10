-- Keep the queue aligned with commands implemented by QBIT Web, Windows and Android.
-- Obsolete command names without a receiver are intentionally excluded.
alter table public.qbit_device_commands
  drop constraint if exists qbit_device_commands_command_check;

alter table public.qbit_device_commands
  add constraint qbit_device_commands_command_check
  check (command in (
    'get_system_info',
    'get_battery_info',
    'get_network_info',
    'get_display_info',
    'volume_up',
    'volume_down',
    'volume_mute',
    'brightness_up',
    'brightness_down',
    'lock_pc',
    'android_open_accessibility_settings',
    'android_back',
    'android_home',
    'android_notifications',
    'android_quick_settings',
    'android_lock_screen',
    'android_volume_up',
    'android_volume_down',
    'android_volume_mute',
    'android_brightness_up',
    'android_brightness_down',
    'android_open_wifi_settings',
    'android_open_bluetooth_settings',
    'android_open_display_settings',
    'android_open_sound_settings',
    'android_open_battery_settings',
    'android_open_app_settings'
  ));
