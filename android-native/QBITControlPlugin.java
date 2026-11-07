package com.gotti23b.qbit;

import android.content.ComponentName;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "QBITControl")
public class QBITControlPlugin extends Plugin {
    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject result = new JSObject();
        String enabled = Settings.Secure.getString(
            getContext().getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        String expected = new ComponentName(getContext(), QBITAccessibilityService.class).flattenToString();
        result.put("enabled", enabled != null && enabled.toLowerCase().contains(expected.toLowerCase()));
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("message", "Se abrieron los ajustes de Accesibilidad.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron abrir los ajustes de Accesibilidad.", error);
        }
    }

    @PluginMethod
    public void performSystemAction(PluginCall call) {
        String action = call.getString("action", "");
        boolean allowed = action.equals("back") || action.equals("home") ||
            action.equals("notifications") || action.equals("quick_settings") ||
            action.equals("lock_screen");
        if (!allowed) {
            call.reject("Acción del sistema no permitida.");
            return;
        }
        boolean success = QBITAccessibilityService.performQbitGlobalAction(action);
        if (!success) {
            call.reject("QBIT Control no está habilitado o Android no admite esta acción.");
            return;
        }
        JSObject result = new JSObject();
        result.put("message", "Acción ejecutada: " + action);
        call.resolve(result);
    }

    @PluginMethod
    public void adjustVolume(PluginCall call) {
        String action = call.getString("action", "");
        AudioManager audio = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        if (audio == null) {
            call.reject("El control de audio no está disponible.");
            return;
        }
        int direction;
        if (action.equals("up")) direction = AudioManager.ADJUST_RAISE;
        else if (action.equals("down")) direction = AudioManager.ADJUST_LOWER;
        else if (action.equals("mute")) direction = AudioManager.ADJUST_MUTE;
        else {
            call.reject("Acción de volumen no válida.");
            return;
        }
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
        JSObject result = new JSObject();
        result.put("message", action.equals("mute") ? "Audio silenciado." : "Volumen actualizado.");
        call.resolve(result);
    }

    @PluginMethod
    public void adjustBrightness(PluginCall call) {
        String direction = call.getString("direction", "");
        if (!direction.equals("up") && !direction.equals("down")) {
            call.reject("Dirección de brillo no válida.");
            return;
        }
        if (!Settings.System.canWrite(getContext())) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                JSObject result = new JSObject();
                result.put("requiresPermission", true);
                result.put("message", "Permití a QBIT modificar el brillo y volvé a intentarlo.");
                call.resolve(result);
            } catch (Exception error) {
                call.reject("No se pudieron abrir los permisos de brillo.", error);
            }
            return;
        }
        try {
            int current = Settings.System.getInt(getContext().getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            int next = Math.max(10, Math.min(255, current + (direction.equals("up") ? 26 : -26)));
            Settings.System.putInt(getContext().getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, next);
            JSObject result = new JSObject();
            result.put("message", "Brillo ajustado.");
            result.put("level", Math.round(next * 100f / 255f));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo cambiar el brillo.", error);
        }
    }
}
