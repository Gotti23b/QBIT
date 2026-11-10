package com.gotti23b.qbit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

public class QBITBackgroundService extends Service {
    private static final String TAG = "QBITBackgroundAgent";
    private static final String CHANNEL = "qbit_background_agent";
    private static final int NOTIFICATION_ID = 1541;
    private static final String ACTION_STOP = "com.gotti23b.qbit.STOP_BACKGROUND_AGENT";
    private static final String SUPABASE_URL = "https://jtxyzfjgspnmzlvztjqx.supabase.co";
    private static final String SUPABASE_KEY = "sb_publishable_s6GXW0tRJR9vo2T2VdPH7Q_otjhGunV";
    private static final long POLL_INTERVAL_MS = 10000L;
    private static final long HEARTBEAT_INTERVAL_MS = 20000L;
    private static final String KEY_ALIAS = "qbit_background_agent_key";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean polling = false;
    private volatile String deviceId = "";
    private volatile String accessToken = "";
    private volatile String refreshToken = "";
    private long lastHeartbeat = 0L;
    private Runnable pollRunnable;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopAgent(true);
            return START_NOT_STICKY;
        }
        if (intent != null) {
            String incomingDevice = intent.getStringExtra("deviceId");
            String incomingAccess = intent.getStringExtra("accessToken");
            String incomingRefresh = intent.getStringExtra("refreshToken");
            if (incomingDevice != null && incomingAccess != null && incomingRefresh != null) {
                deviceId = incomingDevice;
                accessToken = incomingAccess;
                refreshToken = incomingRefresh;
                saveCredentials();
            }
        }
        if (deviceId.isEmpty()) loadCredentials();
        startAsForeground();
        if (!deviceId.isEmpty() && !accessToken.isEmpty()) schedulePoll(1000L);
        else updateNotification("Iniciá sesión en QBIT para conectar el agente");
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // QBIT debe seguir ejecutándose aunque se quite su actividad de Recientes.
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        worker.shutdownNow();
        super.onDestroy();
    }

    private void startAsForeground() {
        Notification notification = buildNotification("Conectando con QBIT Cloud…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Agente QBIT en segundo plano", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Indica cuándo QBIT puede recibir y ejecutar acciones remotas autorizadas.");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String message) {
        Intent stop = new Intent(this, QBITBackgroundService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1542, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        builder.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("QBIT · Agente activo")
            .setContentText(message)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", stopPending);
        return builder.build();
    }

    private void updateNotification(String message) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(message));
    }

    private void schedulePoll(long delay) {
        if (pollRunnable != null) handler.removeCallbacks(pollRunnable);
        pollRunnable = () -> {
            if (polling || deviceId.isEmpty() || accessToken.isEmpty()) {
                schedulePoll(POLL_INTERVAL_MS);
                return;
            }
            polling = true;
            worker.execute(() -> {
                try {
                    if (System.currentTimeMillis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
                        updatePresence(true);
                        lastHeartbeat = System.currentTimeMillis();
                    }
                    pollCommands();
                } catch (Exception ignored) {
                    updateNotification("Conexión temporalmente interrumpida · reintentando");
                } finally {
                    polling = false;
                    handler.post(() -> schedulePoll(POLL_INTERVAL_MS));
                }
            });
        };
        handler.postDelayed(pollRunnable, delay);
    }

    private void pollCommands() throws Exception {
        String query = "/rest/v1/qbit_device_commands?select=id,command,payload,status,expires_at"
            + "&device_id=eq." + enc(deviceId)
            + "&status=eq.pending&expires_at=gt." + enc(new Date().toInstant().toString())
            + "&order=created_at.asc&limit=5";
        JSONArray commands = new JSONArray(api("GET", query, null, null));
        for (int i = 0; i < commands.length(); i++) {
            JSONObject command = commands.optJSONObject(i);
            if (command != null) processCommand(command);
        }
        updateNotification("Activo · esperando órdenes de QBIT Web");
    }

    private void processCommand(JSONObject command) {
        String id = command.optString("id", "");
        String name = command.optString("command", "");
        if (id.isEmpty()) return;
        try {
            JSONObject claimBody = new JSONObject().put("status", "running").put("started_at", new Date().toInstant().toString());
            String claim = api("PATCH", "/rest/v1/qbit_device_commands?id=eq." + enc(id) + "&status=eq.pending",
                claimBody, "return=representation");
            if (new JSONArray(claim).length() == 0) return;

            JSONObject payload = command.optJSONObject("payload");
            if (payload == null || !payload.optBoolean("skip_confirmation", false)) {
                throw new SecurityException("La confirmación remota está activada. Desactivala en QBIT Web para autorizar acciones con la app cerrada.");
            }
            JSONObject result = executeAllowedCommand(name);
            JSONObject body = new JSONObject()
                .put("status", "completed")
                .put("result", new JSONObject().put("message", result.optString("message", "Completado")))
                .put("completed_at", new Date().toInstant().toString());
            api("PATCH", "/rest/v1/qbit_device_commands?id=eq." + enc(id), body, "return=minimal");
            updateNotification("Acción completada · esperando órdenes");
        } catch (Exception error) {
            try {
                JSONObject body = new JSONObject()
                    .put("status", "failed")
                    .put("error_message", safeMessage(error.getMessage()))
                    .put("result", new JSONObject().put("message", safeMessage(error.getMessage())))
                    .put("completed_at", new Date().toInstant().toString());
                api("PATCH", "/rest/v1/qbit_device_commands?id=eq." + enc(id), body, "return=minimal");
            } catch (Exception ignored) {}
            updateNotification("Una acción no pudo ejecutarse · revisá QBIT Web");
        }
    }

    private JSONObject executeAllowedCommand(String command) throws Exception {
        switch (command) {
            case "get_system_info":
                return new JSONObject().put("message", "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ") · " + Build.MANUFACTURER + " " + Build.MODEL);
            case "get_battery_info": {
                BatteryManager battery = (BatteryManager) getSystemService(BATTERY_SERVICE);
                int level = battery != null ? battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1;
                if (level < 0) throw new Exception("Android no devolvió el nivel de batería.");
                return new JSONObject().put("message", "Batería: " + level + "%");
            }
            case "get_network_info": {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                Network network = cm != null ? cm.getActiveNetwork() : null;
                NetworkCapabilities caps = cm != null && network != null ? cm.getNetworkCapabilities(network) : null;
                String type = caps == null ? "sin conexión" :
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "Wi-Fi" :
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "datos móviles" :
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "Ethernet" : "conectada";
                return new JSONObject().put("message", "Conexión: " + type);
            }
            case "get_display_info": {
                DisplayMetrics metrics = new DisplayMetrics();
                WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
                if (wm != null && Build.VERSION.SDK_INT >= 30) {
                    android.view.Display display = wm.getDefaultDisplay();
                    display.getRealMetrics(metrics);
                } else if (wm != null) wm.getDefaultDisplay().getMetrics(metrics);
                return new JSONObject().put("message", "Pantalla: " + metrics.widthPixels + " × " + metrics.heightPixels + " · escala " + metrics.density);
            }
            case "android_volume_up":
            case "android_volume_down":
            case "android_volume_mute": {
                AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
                if (audio == null) throw new Exception("El control de audio no está disponible.");
                int direction = command.endsWith("up") ? AudioManager.ADJUST_RAISE :
                    command.endsWith("down") ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_MUTE;
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, 0);
                return new JSONObject().put("message", "Volumen actualizado.");
            }
            case "android_brightness_up":
            case "android_brightness_down": {
                if (!Settings.System.canWrite(this)) throw new Exception("QBIT necesita el permiso «Modificar ajustes del sistema» para cambiar el brillo.");
                int current = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128);
                int next = Math.max(10, Math.min(255, current + (command.endsWith("up") ? 26 : -26)));
                if (!Settings.System.putInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, next)) throw new Exception("Android no permitió cambiar el brillo.");
                return new JSONObject().put("message", "Brillo ajustado al " + Math.round(next * 100f / 255f) + "%.");
            }
            case "android_back":
            case "android_home":
            case "android_notifications":
            case "android_quick_settings":
            case "android_lock_screen": {
                String action = command.substring("android_".length());
                if (!QBITAccessibilityService.performQbitGlobalAction(action)) {
                    throw new Exception("Activá QBIT Control en Ajustes → Accesibilidad para ejecutar esta acción.");
                }
                return new JSONObject().put("message", "Acción del sistema ejecutada: " + action);
            }
            case "android_open_accessibility_settings":
            case "android_open_wifi_settings":
            case "android_open_bluetooth_settings":
            case "android_open_display_settings":
            case "android_open_sound_settings":
            case "android_open_battery_settings":
            case "android_open_app_settings":
                throw new Exception("Android no permite abrir pantallas de Ajustes desde un servicio en segundo plano. Abrí QBIT y repetí la acción.");
            default:
                throw new SecurityException("Acción no permitida para QBIT Android: " + command);
        }
    }

    private void updatePresence(boolean online) throws Exception {
        JSONObject body = new JSONObject().put("is_online", online).put("last_seen_at", new Date().toInstant().toString());
        api("PATCH", "/rest/v1/qbit_devices?id=eq." + enc(deviceId), body, "return=minimal");
    }

    private String api(String method, String path, JSONObject body, String prefer) throws Exception {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(SUPABASE_URL + path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("apikey", SUPABASE_KEY);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            connection.setRequestProperty("Accept", "application/json");
            if (prefer != null) connection.setRequestProperty("Prefer", prefer);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status == 401 && refreshAccessToken()) return api(method, path, body, prefer);
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String response = read(stream);
            if (status < 200 || status >= 300) throw new Exception("Supabase HTTP " + status + ": " + response);
            return response;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean refreshAccessToken() {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setDoOutput(true);
            connection.setRequestProperty("apikey", SUPABASE_KEY);
            connection.setRequestProperty("Content-Type", "application/json");
            JSONObject body = new JSONObject().put("refresh_token", refreshToken);
            try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int status = connection.getResponseCode();
            String response = read(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
            if (status < 200 || status >= 300) return false;
            JSONObject session = new JSONObject(response);
            accessToken = session.getString("access_token");
            refreshToken = session.optString("refresh_token", refreshToken);
            saveCredentials();
            return true;
        } catch (Exception ignored) { return false; }
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String enc(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8");
    }

    private static String safeMessage(String value) {
        if (value == null || value.trim().isEmpty()) return "No se pudo ejecutar la acción.";
        return value.length() > 450 ? value.substring(0, 450) : value;
    }

    private void saveCredentials() {
        try {
            JSONObject credentials = new JSONObject().put("deviceId", deviceId).put("accessToken", accessToken).put("refreshToken", refreshToken);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getSecretKey());
            byte[] encrypted = cipher.doFinal(credentials.toString().getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            byte[] packed = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
            getSharedPreferences("qbit_background_agent", MODE_PRIVATE).edit()
                .putString("credentials", Base64.encodeToString(packed, Base64.NO_WRAP))
                .putBoolean("enabled", true).apply();
        } catch (Exception ignored) {}
    }

    private void loadCredentials() {
        try {
            String stored = getSharedPreferences("qbit_background_agent", MODE_PRIVATE).getString("credentials", "");
            if (stored.isEmpty()) return;
            byte[] packed = Base64.decode(stored, Base64.NO_WRAP);
            byte[] iv = new byte[12];
            byte[] encrypted = new byte[packed.length - iv.length];
            System.arraycopy(packed, 0, iv, 0, iv.length);
            System.arraycopy(packed, iv.length, encrypted, 0, encrypted.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getSecretKey(), new GCMParameterSpec(128, iv));
            JSONObject credentials = new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
            deviceId = credentials.getString("deviceId");
            accessToken = credentials.getString("accessToken");
            refreshToken = credentials.getString("refreshToken");
        } catch (Exception ignored) {}
    }

    private SecretKey getSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private void stopAgent(boolean clearCredentials) {
        try { if (!deviceId.isEmpty()) updatePresence(false); } catch (Exception ignored) {}
        handler.removeCallbacksAndMessages(null);
        if (clearCredentials) {
            getSharedPreferences("qbit_background_agent", MODE_PRIVATE).edit().clear().apply();
            deviceId = ""; accessToken = ""; refreshToken = "";
        }
        stopForeground(true);
        stopSelf();
    }

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences("qbit_background_agent", MODE_PRIVATE).getBoolean("enabled", false);
    }
}
