package com.rangs.hotellauncher

import android.content.Context
import android.database.ContentObserver
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings

/** Keeps the TV's media volume at or below the maximum set in the admin panel, in every app. */
class VolumeGuard(private val ctx: Context, private val prefs: Prefs) {
    private val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) = enforce(ctx, prefs)
    }

    fun start() {
        ctx.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, observer)
        enforce(ctx, prefs)
    }

    fun stop() = ctx.contentResolver.unregisterContentObserver(observer)

    companion object {
        fun enforce(ctx: Context, prefs: Prefs) {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val limit = (max * prefs.maxVolume / 100.0).toInt().coerceAtLeast(1)
            try {
                if (am.getStreamVolume(AudioManager.STREAM_MUSIC) > limit) {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, limit, AudioManager.FLAG_SHOW_UI)
                }
            } catch (e: SecurityException) {
                // Do-not-disturb policy can block volume changes; nothing else to do.
            }
        }
    }
}
