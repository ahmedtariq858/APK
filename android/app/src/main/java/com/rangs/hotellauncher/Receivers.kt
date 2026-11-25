package com.rangs.hotellauncher

import android.app.admin.DeviceAdminReceiver
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log

/** Opens the launcher when the TV finishes booting, and again after an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        if (prefs.permanentlyDisabled) return
        // A temporary exit ("অ্যাপ থেকে বের হন") lasts only until the TV restarts.
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) prefs.exitedOnBoot = ""
        Launcher.setHomeEnabled(context, true)
        try {
            context.startActivity(
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            // Android 10+ may block starts from the background; as the Home app it opens anyway.
            Log.i("HotelLauncher", "boot start skipped: ${e.message}")
        }
    }
}

/** Device Owner receiver. Enable once per TV with:
 *  adb shell dpm set-device-owner com.rangs.hotellauncher/.AdminReceiver */
class AdminReceiver : DeviceAdminReceiver()

/** Result of a PackageInstaller session started by [Updater]. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Not Device Owner: the TV shows Android's "Install?" screen.
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33)
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                confirm?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> Log.i("HotelUpdater", "update installed")
            else -> Log.w("HotelUpdater", "install status $status: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
        }
    }
}
