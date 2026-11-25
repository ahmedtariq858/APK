package com.rangs.hotellauncher

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

/** Home-app role, Device Owner policies and the ways out of the launcher. */
object Launcher {
    private const val TAG = "HotelLauncher"

    /** Stock launchers to prefer when stepping aside, most common first. */
    private val STOCK_HOMES = listOf(
        "com.google.android.apps.tv.launcherx",
        "com.google.android.tvlauncher",
        "com.android.tv.launcher",
        "com.google.android.leanbacklauncher",
        "com.mediatek.wwtv.tvcenter",
        "com.android.launcher3"
    )

    fun homeAlias(c: Context) = ComponentName(c.packageName, "${c.packageName}.HomeAlias")
    fun admin(c: Context) = ComponentName(c, AdminReceiver::class.java)
    private fun dpm(c: Context) = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isDeviceOwner(c: Context) = dpm(c).isDeviceOwnerApp(c.packageName)

    fun isHomeEnabled(c: Context): Boolean =
        c.packageManager.getComponentEnabledSetting(homeAlias(c)) != PackageManager.COMPONENT_ENABLED_STATE_DISABLED

    fun setHomeEnabled(c: Context, enabled: Boolean) {
        c.packageManager.setComponentEnabledSetting(
            homeAlias(c),
            if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        )
    }

    /** Another Home app on the TV (the stock launcher), or null if this is the only one. */
    fun otherHomeIntent(c: Context): Intent? {
        val pm = c.packageManager
        val query = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val homes = pm.queryIntentActivities(query, PackageManager.MATCH_DISABLED_COMPONENTS or PackageManager.MATCH_ALL)
            .map { it.activityInfo }
            .filter { it.packageName != c.packageName && it.packageName != "com.android.settings" && it.packageName != "com.android.tv.settings" }
        val pick = homes.minByOrNull { STOCK_HOMES.indexOf(it.packageName).let { i -> if (i < 0) 99 else i } } ?: return null
        return Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            .setClassName(pick.packageName, pick.name)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    /** Device Owner only: make this the Home app without the chooser, and set the kiosk list. */
    fun applyOwnerPolicies(a: Activity, prefs: Prefs) {
        if (!isDeviceOwner(a)) return
        val dpm = dpm(a)
        try {
            if (!prefs.permanentlyDisabled) {
                val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    addCategory(Intent.CATEGORY_DEFAULT)
                }
                dpm.addPersistentPreferredActivity(admin(a), filter, homeAlias(a))
            }
            val allowed = mutableSetOf(a.packageName, "com.google.android.youtube.tv", "com.netflix.ninja")
            allowed += LIVE_TV_PACKAGES
            dpm.setLockTaskPackages(admin(a), allowed.filter { installed(a, it) }.toTypedArray())
            if (Build.VERSION.SDK_INT >= 28) {
                dpm.setLockTaskFeatures(admin(a), DevicePolicyManager.LOCK_TASK_FEATURE_HOME)
            }
        } catch (e: Exception) {
            Log.w(TAG, "owner policies", e)
        }
    }

    fun clearOwnerHome(c: Context) {
        if (!isDeviceOwner(c)) return
        try { dpm(c).clearPackagePersistentPreferredActivities(admin(c), c.packageName) } catch (e: Exception) { Log.w(TAG, "clear home", e) }
    }

    fun installed(c: Context, pkg: String) = try {
        c.packageManager.getPackageInfo(pkg, 0); true
    } catch (e: PackageManager.NameNotFoundException) { false }

    /** Tuner / live-TV apps found on common Android TV boards (MediaTek, Amlogic, Realtek, CVTE…). */
    val LIVE_TV_PACKAGES = listOf(
        "com.mediatek.wwtv.tvcenter",
        "com.droidlogic.tvinput",
        "com.droidlogic.tvsource",
        "com.realtek.tv",
        "com.cvte.tv.tvplayer",
        "com.tcl.tvweishi",
        "com.google.android.tv",
        "com.android.tv"
    )
}
