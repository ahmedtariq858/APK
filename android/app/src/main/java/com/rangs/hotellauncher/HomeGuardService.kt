package com.rangs.hotellauncher

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Keeps the hotel screen as the TV's main screen on TVs that ignore third-party Home apps
 * (most Google TV / Android TV 12+ builds):
 *  - the remote's Home button opens the hotel screen instead of the stock launcher;
 *  - whenever the stock launcher comes to the front (power-on, Home, an app closing),
 *    the hotel screen replaces it at once.
 * Staff exits ("অ্যাপ থেকে বের হন" / "স্থায়ীভাবে লঞ্চার বন্ধ") are respected.
 * Enabled once in Settings → Accessibility → Hotel Launcher.
 */
class HomeGuardService : AccessibilityService() {

    companion object {
        /**
         * Some TVs (e.g. TCL Google TV) switch accessibility services off on every reboot.
         * If the setup script granted WRITE_SECURE_SETTINGS
         * (adb shell pm grant com.rangs.hotellauncher android.permission.WRITE_SECURE_SETTINGS),
         * switch this service back on without touching any other enabled service.
         */
        fun ensureEnabled(c: Context) {
            if (isEnabled(c)) return
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            val p = Prefs(c)
            if (p.permanentlyDisabled) return
            try {
                val me = ComponentName(c, HomeGuardService::class.java).flattenToString()
                val cur = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                val next = if (cur.isNullOrBlank() || cur == "null") me else "$cur:$me"
                Settings.Secure.putString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next)
                Settings.Secure.putInt(c.contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
            } catch (e: Exception) {
                android.util.Log.w("HotelGuard", "re-enable failed", e)
            }
        }

        fun isEnabled(c: Context): Boolean {
            val list = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            val me = ComponentName(c, HomeGuardService::class.java)
            return list.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }

    private var stockHomes: Set<String> = emptySet()
    private var lastBring = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        stockHomes = findStockHomes()
        KeepAliveService.start(this)
    }

    /** Every Home app on the TV except this one, plus the usual TV launchers. */
    private fun findStockHomes(): Set<String> {
        val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val found = packageManager.queryIntentActivities(q, PackageManager.MATCH_ALL).map { it.activityInfo.packageName }
        return (found + listOf(
            "com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher",
            "com.google.android.leanbacklauncher", "com.android.tv.launcher", "com.google.android.tungsten.setupwraith"
        )).filter { it != packageName && it != "com.android.settings" && it != "com.android.tv.settings" }.toSet()
    }

    private fun active(): Boolean {
        val p = Prefs(this)
        return !p.permanentlyDisabled && p.exitedOnBoot != p.bootId()
    }

    private fun bring(reason: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBring < 800) return
        lastBring = now
        KeepAliveService.bringToFront(this, reason)
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_HOME || !active()) return false
        if (event.action == KeyEvent.ACTION_UP) bring("home_key")
        return true // the stock launcher never sees the Home press
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in stockHomes && active()) bring("stock_home")
    }

    override fun onInterrupt() {}
}
