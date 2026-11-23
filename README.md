# Simple App (Kotlin)

A minimal Android counter app written in Kotlin.

## Download
- `dist/SimpleApp.apk` in this repo, or
- the **simple-app-apks** artifact from the latest run under the repo's **Actions** tab (built by `.github/workflows/build-apk.yml` on every push).

## Build locally
Requires JDK 17+ and the Android SDK (platform 35).
```
./gradlew assembleRelease
```
Output: `app/build/outputs/apk/release/app-release.apk`
