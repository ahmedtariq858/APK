# Sky Dodger (Unity starter game)

Slide the paddle left/right (touch or drag; arrow keys in the editor) to dodge falling blocks.
Score rises over time, blocks speed up, best score is saved. Tap to restart after a hit.

- Unity 6000.6.10f1, Built-in render pipeline, no extra packages.
- `Assets/Scripts/SkyDodger.cs`: all gameplay (objects are created in code).
- `Assets/Editor/CIBuild.cs`: creates `Assets/Scenes/Main.unity` if missing, sets Android player
  settings (package `com.startergames.skydodger`, portrait, IL2CPP, ARM64, min API 26) and builds.

Build (needs an activated Unity license):

    ../scripts/build_apk.sh . Builds/SkyDodger.apk

Or open the project in Unity and use the **Build > Android APK** menu.
