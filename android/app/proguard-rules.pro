# Keep the JavaScript bridge methods called from the guest screen.
-keepclassmembers class com.rangs.hotellauncher.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
