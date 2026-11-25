package com.rangs.hotellauncher

import android.app.admin.DevicePolicyManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebStorage
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * `window.Android` in the guest screen. Every method is called from the page's JavaScript
 * (see the table in the documentation). Methods run on a WebView binder thread.
 */
class Bridge(private val a: MainActivity) {
    private val prefs get() = a.prefs
    private val tag = "HotelBridge"

    @JavascriptInterface
    fun getConfig(): String = JSONObject().apply {
        put("serverUrl", prefs.effectiveServer)
        put("standalone", prefs.standalone)
        put("adminUrl", if (prefs.standalone) "http://${ipAddress()}:${LocalServer.PORT}/admin/" else "${prefs.serverUrl}/admin/")
        put("room", prefs.room)
        put("deviceId", prefs.deviceId)
        put("versionName", BuildConfig.VERSION_NAME)
        put("versionCode", BuildConfig.VERSION_CODE)
        put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        put("isDeviceOwner", Launcher.isDeviceOwner(a))
        put("ip", ipAddress())
    }.toString()

    @JavascriptInterface
    fun getAppInfo(): String = JSONObject(getConfig()).apply {
        put("sdk", Build.VERSION.SDK_INT)
        put("release", Build.VERSION.RELEASE)
        put("homeEnabled", Launcher.isHomeEnabled(a) && !prefs.permanentlyDisabled)
        put("board", Build.BOARD)
    }.toString()

    @JavascriptInterface
    fun setConfig(json: String): String {
        val o = JSONObject(json)
        if (o.has("room")) prefs.room = o.getString("room").trim()
        if (o.has("serverUrl")) prefs.serverUrl = o.getString("serverUrl").trim()
        if (prefs.standalone) LocalServer.start(a)
        return "ok"
    }

    @JavascriptInterface
    fun storeGet(key: String): String? = prefs.cacheGet(key)

    @JavascriptInterface
    fun storeSet(key: String, value: String) = prefs.cacheSet(key, value)

    // ---------------------------------------------------------------- apps

    @JavascriptInterface
    fun launchApp(pkg: String): Boolean {
        val pm = a.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return false
        return start(intent)
    }

    /** Opens the board's tuner app. [pkg] from the admin panel wins; otherwise known boards are tried. */
    @JavascriptInterface
    fun openLiveTv(pkg: String): Boolean {
        val candidates = (if (pkg.isNotBlank()) listOf(pkg) else emptyList()) + Launcher.LIVE_TV_PACKAGES
        for (p in candidates) if (Launcher.installed(a, p) && launchApp(p)) return true
        // Generic Android TV input framework entry point.
        return start(Intent(Intent.ACTION_VIEW, android.media.tv.TvContract.Channels.CONTENT_URI))
    }

    @JavascriptInterface
    fun openSettings(): Boolean = start(Intent(Settings.ACTION_SETTINGS))

    @JavascriptInterface
    fun openNetworkSettings(): Boolean =
        start(Intent(Settings.ACTION_WIFI_SETTINGS)) || start(Intent(Settings.ACTION_WIRELESS_SETTINGS))

    private fun start(intent: Intent): Boolean = try {
        a.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        Log.w(tag, "start $intent", e); false
    }

    // ---------------------------------------------------------------- launcher role

    @JavascriptInterface
    fun exitLauncher(): Boolean { a.runOnUiThread { a.leave(permanent = false) }; return true }

    @JavascriptInterface
    fun disableLauncherPermanently(): Boolean { a.runOnUiThread { a.leave(permanent = true) }; return true }

    @JavascriptInterface
    fun enableLauncher(): Boolean { a.runOnUiThread { a.reenable() }; return true }

    @JavascriptInterface
    fun restartApp() { a.runOnUiThread { a.restartApp() } }

    @JavascriptInterface
    fun reloadFromServer() { a.runOnUiThread { a.loadStartPage() } }

    /** Settings pushed from the admin panel: {"maxVolume": 80, "kiosk": false}. */
    @JavascriptInterface
    fun applyTvSettings(json: String) {
        val o = JSONObject(json)
        if (o.has("maxVolume")) prefs.maxVolume = o.getInt("maxVolume")
        if (o.has("kiosk")) {
            val kiosk = o.getBoolean("kiosk")
            val changed = kiosk != prefs.kiosk
            prefs.kiosk = kiosk
            if (changed) a.runOnUiThread { if (kiosk) a.startKioskIfAllowed() else a.stopKiosk() }
        }
        VolumeGuard.enforce(a, prefs)
    }

    @JavascriptInterface
    fun setMaxVolume(percent: Int) {
        prefs.maxVolume = percent
        VolumeGuard.enforce(a, prefs)
    }

    // ---------------------------------------------------------------- check-out

    /**
     * Wipes YouTube / Netflix sign-ins at check-out. Needs Device Owner (Android 9+):
     *   adb shell dpm set-device-owner com.rangs.hotellauncher/.AdminReceiver
     * Returns "ok" or the reason it could not.
     */
    @JavascriptInterface
    fun clearGuestData(packagesJson: String): String {
        a.runOnUiThread {
            CookieManager.getInstance().removeAllCookies(null)
            WebStorage.getInstance().deleteAllData()
        }
        if (!Launcher.isDeviceOwner(a)) return "not device owner"
        if (Build.VERSION.SDK_INT < 28) return "needs Android 9+"
        val arr = JSONArray(packagesJson)
        val pkgs = (0 until arr.length()).map { arr.getString(it) }.filter { Launcher.installed(a, it) }
        if (pkgs.isEmpty()) return "ok"
        val dpm = a.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val done = CountDownLatch(pkgs.size)
        val failed = AtomicInteger(0)
        val exec = Executors.newSingleThreadExecutor()
        for (p in pkgs) {
            try {
                dpm.clearApplicationUserData(Launcher.admin(a), p, exec) { _, ok ->
                    if (!ok) failed.incrementAndGet()
                    done.countDown()
                }
            } catch (e: Exception) {
                Log.w(tag, "clear $p", e); failed.incrementAndGet(); done.countDown()
            }
        }
        val finished = done.await(20, TimeUnit.SECONDS)
        exec.shutdown()
        return when {
            !finished -> "timeout"
            failed.get() > 0 -> "failed for ${failed.get()} app(s)"
            else -> "ok"
        }
    }

    // ---------------------------------------------------------------- updates

    /** Downloads the APK the admin panel uploaded and installs it (silently on Device Owner TVs). */
    @JavascriptInterface
    fun installUpdate(url: String, versionCode: Int, sha256: String): String {
        if (versionCode <= BuildConfig.VERSION_CODE) return "already up to date"
        Updater.start(a.applicationContext, url, sha256)
        return "downloading"
    }

    private fun ipAddress(): String = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address }?.hostAddress ?: ""
    } catch (e: Exception) { "" }
}
