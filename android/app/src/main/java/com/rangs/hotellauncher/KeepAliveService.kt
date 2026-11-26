package com.rangs.hotellauncher

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Always-running service that keeps the hotel screen in front:
 *  - after a reboot (started by [BootReceiver]),
 *  - every time the TV wakes from standby (the remote's power button usually only sleeps the TV),
 *  - and keeps the built-in server (standalone mode) alive while YouTube/Netflix are open.
 *
 * Android 10+ only lets a background app open its screen if it is Device Owner or has the
 * "Display over other apps" permission — see [canAutoStart].
 */
class KeepAliveService : Service() {

    companion object {
        private const val TAG = "HotelKeepAlive"
        private const val CHANNEL = "hotel_launcher"
        const val EXTRA_WAKE = "wake"

        fun start(c: Context) {
            val i = Intent(c, KeepAliveService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
            } catch (e: Exception) {
                Log.w(TAG, "start", e)
            }
        }

        /** Can this app open its screen from the background (boot, wake)? */
        fun canAutoStart(c: Context): Boolean =
            Build.VERSION.SDK_INT < 29 || Launcher.isDeviceOwner(c) || android.provider.Settings.canDrawOverlays(c) || HomeGuardService.isEnabled(c)

        /** Bring the hotel screen to the front unless staff stepped out of the launcher. */
        fun bringToFront(c: Context, reason: String) {
            val prefs = Prefs(c)
            if (prefs.permanentlyDisabled || prefs.exitedOnBoot == prefs.bootId()) return
            try {
                c.startActivity(
                    Intent(c, MainActivity::class.java)
                        .putExtra(EXTRA_WAKE, reason)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                )
            } catch (e: Exception) {
                Log.w(TAG, "bringToFront($reason) blocked: ${e.message}")
            }
        }
    }

    private val main = Handler(Looper.getMainLooper())

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            // Give the TV a moment to finish waking (some boards switch to the last input first).
            main.postDelayed({ bringToFront(context, "screen_on") }, 400)
        }
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Hotel Launcher", NotificationManager.IMPORTANCE_MIN))
        }
        val n: Notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this))
            .setContentTitle("Hotel Launcher")
            .setContentText("চালু আছে")
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)

        registerReceiver(screenReceiver, IntentFilter(Intent.ACTION_SCREEN_ON).apply { addAction(Intent.ACTION_USER_PRESENT) })

        if (Prefs(this).standalone) {
            try { LocalServer.start(this) } catch (e: Exception) { Log.e(TAG, "local server", e) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        try { unregisterReceiver(screenReceiver) } catch (e: Exception) { /* not registered */ }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
