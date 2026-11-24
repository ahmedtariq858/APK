# LOST RELIC: THE INFINITE CHASE

An endless 3D runner for Android. A treasure hunter takes the Golden Relic from a forgotten temple and wakes its stone Guardian. The Guardian chases you through four zones that keep cycling: the Whispering Jungle, the Ancient Temple, the Abandoned City and the Underground Tunnels.

**Download:** [`release/LostRelic-v1.0.apk`](release/LostRelic-v1.0.apk). It needs Android 7.0 or newer. Enable "Install unknown apps" for your file manager or browser, then open the APK.

## Gameplay
| Action | Touch | Keyboard |
|---|---|---|
| Change lane | Swipe left / right | ← → / A D |
| Turn at a corner | Swipe toward the glowing arrow | ← → |
| Jump (logs, low walls, broken floor) | Swipe up | ↑ / W / Space |
| Slide (beams, fire traps) | Swipe down | ↓ / S |
| Pause | Pause button / Back | P / Esc |

* **Coins** pay for new explorers and power-up upgrades in the Treasure Shop.
* **Power-ups:** Coin Magnet, Relic Shield (saves you from one deadly hit) and Double Gold.
* **Stumbling:** if you bump into an obstacle the Guardian closes in. Stumble again before it falls back and you're caught.
* **Explorers:** Rex, Maya, Kai, Zara and Aurum. Each one gives a higher score multiplier.
* **Revive:** spend coins to keep a run going after you die (up to 3 times).
* The game saves your progress on the device.

## Project layout
```
app/src/main/assets/www/   the game (HTML5 + three.js, procedural art, synthesized audio)
app/src/main/java/...      MainActivity: fullscreen WebView + save/vibration bridge
release/                   prebuilt APK
```

## Build
Requires JDK 17+ and the Android SDK (platform 34, build-tools 34).
```
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```
The release build is signed with the debug key so you can sideload it directly. Before publishing on Google Play, set up your own `signingConfig`.

To play in a browser, serve `app/src/main/assets/www/` with any static server (for example `python3 -m http.server`) and open `index.html`.
