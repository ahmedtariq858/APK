package com.rangs.hotellauncher

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import android.provider.Settings

/** Everything the launcher remembers on the TV. */
class Prefs(context: Context) {
    private val ctx = context.applicationContext
    private val sp: SharedPreferences = ctx.getSharedPreferences("launcher", Context.MODE_PRIVATE)
    private val cache: SharedPreferences = ctx.getSharedPreferences("guest_cache", Context.MODE_PRIVATE)

    var room: String
        get() = sp.getString("room", "") ?: ""
        set(v) = sp.edit().putString("room", v).apply()

    var serverUrl: String
        get() = sp.getString("serverUrl", BuildConfig.DEFAULT_SERVER) ?: ""
        set(v) = sp.edit().putString("serverUrl", v.trimEnd('/')).apply()

    var maxVolume: Int
        get() = sp.getInt("maxVolume", 100)
        set(v) = sp.edit().putInt("maxVolume", v.coerceIn(10, 100)).apply()

    var kiosk: Boolean
        get() = sp.getBoolean("kiosk", false)
        set(v) = sp.edit().putBoolean("kiosk", v).apply()

    /** Staff chose "স্থায়ীভাবে লঞ্চার বন্ধ": stay out of the way until re-enabled. */
    var permanentlyDisabled: Boolean
        get() = sp.getBoolean("permanentlyDisabled", false)
        set(v) = sp.edit().putBoolean("permanentlyDisabled", v).apply()

    /** Staff chose "অ্যাপ থেকে বের হন": forward Home to the stock launcher until this boot ends. */
    var exitedOnBoot: String
        get() = sp.getString("exitedOnBoot", "") ?: ""
        set(v) = sp.edit().putString("exitedOnBoot", v).apply()

    @SuppressLint("HardwareIds")
    val deviceId: String = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: "unknown"

    /** Identifies the current power-on, so a temporary exit ends at the next reboot. */
    fun bootId(): String {
        val count = Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT, -1)
        if (count >= 0) return "c$count"
        val bootedAt = (System.currentTimeMillis() - SystemClock.elapsedRealtime()) / 300_000L
        return "t$bootedAt"
    }

    fun cacheGet(key: String): String? = cache.getString(key, null)
    fun cacheSet(key: String, value: String) {
        if (value.isEmpty()) cache.edit().remove(key).apply() else cache.edit().putString(key, value).apply()
    }
}
