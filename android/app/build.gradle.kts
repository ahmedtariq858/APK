import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Optional release signing: create android/keystore.properties with
//   storeFile=/path/to/hotel.jks  storePassword=…  keyAlias=…  keyPassword=…
// (or set the same names as HOTEL_* environment variables in CI).
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
    System.getenv("HOTEL_STORE_FILE")?.let { setProperty("storeFile", it) }
    System.getenv("HOTEL_STORE_PASSWORD")?.let { setProperty("storePassword", it) }
    System.getenv("HOTEL_KEY_ALIAS")?.let { setProperty("keyAlias", it) }
    System.getenv("HOTEL_KEY_PASSWORD")?.let { setProperty("keyPassword", it) }
}
val hasReleaseKey = signing.getProperty("storeFile")?.let { file(it).exists() } == true

android {
    namespace = "com.rangs.hotellauncher"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.rangs.hotellauncher"
        minSdk = 24
        targetSdk = 34
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 4
        versionName = (project.findProperty("versionName") as String?) ?: "1.3.0"
        // Server the TV talks to before anyone sets it in the TV-admin menu.
        buildConfigField("String", "DEFAULT_SERVER", "\"${project.findProperty("defaultServer") ?: ""}\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    applicationVariants.all {
        val variant = this
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl).outputFileName =
                "hotel-launcher-${variant.versionName}-${variant.buildType.name}.apk"
        }
    }
}

// The guest screen lives in ../server/public/tv. Bundle a copy into the APK so the
// TV can show the welcome screen even when the server is unreachable at boot.
// The admin panel is bundled too, for standalone mode (the TV runs the server itself).
val copyGuestScreen by tasks.registering(Copy::class) {
    from(rootProject.file("../server/public")) { include("tv/**", "admin/**") }
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(copyGuestScreen) }
