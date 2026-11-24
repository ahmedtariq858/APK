# IR Universal Remote (Android)

A universal remote control app for Android phones that have a built-in **IR blaster**
(Xiaomi / Redmi / POCO, Huawei, Honor, some Samsung, TCL, Realme and others).

## Features

- **Unlimited IR codes per button.** Put 20, 50 or more codes on any button.
  - **Send all:** each press fires every code one after another, with a delay you set.
    One button can switch on many brands of TV at once.
  - **Cycle:** each press sends the next code in the list, and the button shows which one is next.
    Use this to find which code works on an unknown device.
  - **Repeat each code:** send each frame 1–20 times, for devices that need a longer press.
- **Clone any code by typing or pasting it.**
  - Protocol plus hex code: NEC, NEC Extended, Samsung32, Sony SIRC 12/15/20, Philips RC5, Philips RC6,
    Panasonic (Kaseikyo), JVC and LG 28-bit.
    - Enter a **full code** such as `0x20DF10EF` and leave the address empty.
    - Or enter an **address and a command** such as `04` + `08` (the Flipper Zero / IRDB style).
  - Pronto Hex (`0000 006D 0022 …`) and raw timings are also accepted.
  - **Paste many:** paste dozens of codes at once, one per line, for example:
    ```
    NEC 0x20DF10EF        # LG
    SAMSUNG E0E040BF      # Samsung
    SONY12 A90            # Sony
    RC5 00 0C             # Philips
    PRONTO 0000 006D 0022 0002 0157 00AC ...
    ```
  - Every code can be **tested** on its own, and the editor checks codes as you type.
- **Templates:** TV, air conditioner, set-top box, fan, audio / sound bar, projector, or an empty custom remote.
  You can add, rename, delete, duplicate and reorder buttons, and set the grid to 2–5 columns.
- **Backup:** export all remotes to a JSON file and import them on another phone.
- Works offline. No ads, no internet permission.

> Phone IR blasters can only **send**, not receive. That is a hardware limit, so no app can learn
> codes by pointing the original remote at the phone. You get codes from code lists or databases
> (IRDB, Flipper-IRDB, LIRC, remotecentral, …) and enter them here.

## Download the APK

Each push to GitHub builds the app automatically:

1. Open the repository's **Actions** tab and select the latest **Build APK** run.
2. Download the **IR-Universal-Remote-APK** artifact (a zip file).
3. Unzip it and install `app-release.apk` on your phone. You may need to allow
   "install unknown apps".

## Build it yourself

You need Android Studio, or JDK 17 and the Android SDK:

```bash
./gradlew assembleRelease     # APK ends up in app/build/outputs/apk/release/
./gradlew testDebugUnitTest   # runs the IR encoder unit tests
```

## Project layout

```
app/src/main/java/com/universal/irremote/
  ir/IrProtocol.kt        supported protocols and their input hints
  ir/IrEncoder.kt         protocol + hex  ->  carrier frequency + mark/space timings
  ir/IrTransmitter.kt     wrapper for Android's ConsumerIrManager (the IR blaster)
  data/Models.kt          Remote, RemoteButton (holds many IrCodes), IrCode
  data/CodeParser.kt      "Paste many" parser
  data/RemoteRepository.kt  JSON storage and backup import/export
  data/Templates.kt       TV / AC / set-top box / fan / ... layouts
  ui/                     Jetpack Compose screens
```
