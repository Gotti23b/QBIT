package com.gotti23b.qbit;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

public class QBITAccessibilityService extends AccessibilityService {
    private static volatile QBITAccessibilityService instance;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // QBIT no registra ni lee el contenido de las pantallas.
    }

    @Override
    public void onInterrupt() {
        // No hay una sesión de lectura que interrumpir.
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    public static boolean performQbitGlobalAction(String action) {
        QBITAccessibilityService service = instance;
        if (service == null) return false;
        switch (action) {
            case "back":
                return service.performGlobalAction(GLOBAL_ACTION_BACK);
            case "home":
                return service.performGlobalAction(GLOBAL_ACTION_HOME);
            case "notifications":
                return service.performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quick_settings":
                return service.performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            case "lock_screen":
                if (android.os.Build.VERSION.SDK_INT >= 28) {
                    return service.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
                }
                return false;
            default:
                return false;
        }
    }
}
