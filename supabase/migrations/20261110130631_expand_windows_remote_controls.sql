alter table public.qbit_device_commands
  drop constraint if exists qbit_device_commands_command_check;

alter table public.qbit_device_commands
  add constraint qbit_device_commands_command_check
  check (command in (
    'get_system_info','get_battery_info','get_network_info','get_display_info',
    'volume_up','volume_down','volume_mute','volume_set',
    'brightness_up','brightness_down','brightness_set','lock_pc',
    'toggle_wifi_on','toggle_wifi_off','toggle_night_light',
    'open_settings_system','open_settings_display','open_settings_sound','open_settings_network','open_settings_wifi','open_settings_bluetooth','open_settings_apps','open_settings_personalization','open_settings_updates','open_settings_storage','open_settings_notifications','open_settings_privacy',
    'media_play_pause','media_next','media_previous','media_stop',
    'minimize_all','restore_all','focus_app','close_window','open_anything',
    'open_calculator','open_notepad','open_task_manager','get_processes','cpu_usage','ram_usage','disk_usage',
    'search_files','open_file_location','get_file_info','zip_files','unzip_file','read_text_file','create_folder','create_file','show_notification','set_timer','cancel_timer',
    'android_open_accessibility_settings','android_back','android_home','android_notifications','android_quick_settings','android_lock_screen','android_volume_up','android_volume_down','android_volume_mute','android_brightness_up','android_brightness_down','android_open_wifi_settings','android_open_bluetooth_settings','android_open_display_settings','android_open_sound_settings','android_open_battery_settings','android_open_app_settings'
  ));