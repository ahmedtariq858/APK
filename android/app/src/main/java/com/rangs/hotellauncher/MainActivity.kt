package com.rangs.hotellauncher

import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    companion object {
        private const val TAG = "HotelLauncher"
        const val ASSET_URL = "file:///android_asset/tv/index.html"
        private const val LOAD_TIMEOUT_MS = 10_000L
    }

    lateinit var prefs: Prefs
        private set
    lateinit var web: WebView
        private set
    private val main = Handler(Looper.getMainLooper())
    private var pageFinished = false
    private var usingFallback = false
    private lateinit var volumeGuard: VolumeGuard

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (forwardHomeIfExited(intent)) return

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0D1420"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                @Suppress("DEPRECATION")
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                allowFileAccess = true
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = true
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                useWideViewPort = true
                loadWithOverviewMode = true
                textZoom = 100
            }
            addJavascriptInterface(Bridge(this@MainActivity), "Android")
            webViewClient = Client()
        }
        setContentView(web)
        web.requestFocus()

        volumeGuard = VolumeGuard(applicationContext, prefs)
        volumeGuard.start()

        Launcher.applyOwnerPolicies(this, prefs)
        loadStartPage()
    }

    /** The server's live page when configured, otherwise the copy built into the APK. */
    fun loadStartPage() {
        if (prefs.standalone) {
            try { LocalServer.start(this) } catch (e: Exception) { Log.e(TAG, "local server", e) }
        }
        val server = prefs.effectiveServer
        pageFinished = false
        usingFallback = false
        if (server.isBlank()) {
            loadFallback()
            return
        }
        web.loadUrl("$server/tv/")
        main.postDelayed({ if (!pageFinished && !usingFallback) loadFallback() }, LOAD_TIMEOUT_MS)
    }

    private fun loadFallback() {
        if (usingFallback) return
        usingFallback = true
        Log.i(TAG, "server page unavailable, using built-in guest screen")
        web.stopLoading()
        web.loadUrl(ASSET_URL)
    }

    private inner class Client : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            pageFinished = false
        }

        override fun onPageFinished(view: WebView, url: String) {
            pageFinished = true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && !request.url.toString().startsWith("file:")) main.post { loadFallback() }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 400) main.post { loadFallback() }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            // Only the hotel's own pages may open inside the launcher.
            val server = prefs.effectiveServer
            val allowed = url.startsWith("file:///android_asset/") || (server.isNotBlank() && url.startsWith(server))
            if (allowed) {
                usingFallback = false
                pageFinished = false
            }
            return !allowed
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (forwardHomeIfExited(intent)) return
        // Home pressed while YouTube/Netflix (or a menu) was open: back to the welcome screen.
        if (::web.isInitialized) js("window.HotelTV && HotelTV.home()")
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if (::web.isInitialized) {
            web.onResume()
            if (prefs.kiosk) startKioskIfAllowed()
        }
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::volumeGuard.isInitialized) volumeGuard.stop()
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_ESCAPE) {
            // The guest can never back out of the launcher; the page closes its own screens.
            if (event.action == KeyEvent.ACTION_UP && ::web.isInitialized) js("window.HotelTV && HotelTV.back()")
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    @SuppressLint("MissingSuperCall")
    @Deprecated("Back is handled in dispatchKeyEvent")
    override fun onBackPressed() { /* never leave */ }

    fun js(code: String) = main.post { if (::web.isInitialized) web.evaluateJavascript(code, null) }

    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    /** After "অ্যাপ থেকে বের হন" the Home button goes to the stock launcher until the TV restarts. */
    private fun forwardHomeIfExited(intent: Intent?): Boolean {
        val isHome = intent?.hasCategory(Intent.CATEGORY_HOME) == true
        val exited = prefs.permanentlyDisabled || prefs.exitedOnBoot == prefs.bootId()
        if (!isHome || !exited) return false
        val other = Launcher.otherHomeIntent(this) ?: return false
        startActivity(other)
        finish()
        return true
    }

    // ---------------------------------------------------------------- kiosk

    fun startKioskIfAllowed() {
        if (!Launcher.isDeviceOwner(this)) return
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
            try { startLockTask() } catch (e: Exception) { Log.w(TAG, "startLockTask", e) }
        }
    }

    fun stopKiosk() {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        if (am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE) {
            try { stopLockTask() } catch (e: Exception) { Log.w(TAG, "stopLockTask", e) }
        }
    }

    /** Leave the launcher: temporarily (until reboot) or for good. */
    fun leave(permanent: Boolean) {
        stopKiosk()
        if (permanent) {
            prefs.permanentlyDisabled = true
            Launcher.clearOwnerHome(this)
            Launcher.setHomeEnabled(this, false)
        } else {
            prefs.exitedOnBoot = prefs.bootId()
        }
        val other = Launcher.otherHomeIntent(this)
        if (other != null) startActivity(other)
        else startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    fun reenable() {
        prefs.permanentlyDisabled = false
        prefs.exitedOnBoot = ""
        Launcher.setHomeEnabled(this, true)
        Launcher.applyOwnerPolicies(this, prefs)
    }

    fun restartApp() {
        val restart = Intent.makeRestartActivityTask(componentName)
        startActivity(restart)
        Runtime.getRuntime().exit(0)
    }

    val sdkInt get() = Build.VERSION.SDK_INT
}
