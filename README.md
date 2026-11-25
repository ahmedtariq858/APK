# হোটেল টিভি লঞ্চার

Android TV-র জন্য হোটেল লঞ্চার: টিভি চালু হলেই অতিথিকে নাম ধরে স্বাগত জানায়, আর রিসেপশনের অ্যাডমিন প্যানেল থেকে সব রুমের টিভি নিয়ন্ত্রণ করা যায়।

```
android/   টিভি অ্যাপ (APK) — Kotlin, WebView, Home লঞ্চার, JavaScript ব্রিজ
server/    হোটেলের সার্ভার — Node.js + SQLite, WebSocket
  public/tv/     অতিথির স্ক্রিন (APK-র ভেতরেও এর একটা কপি থাকে)
  public/admin/  অ্যাডমিন প্যানেল
```

## শুধু টিভি আর ফোন দিয়ে পরীক্ষা (একক মোড)

কোনো কম্পিউটার লাগবে না: টিভি অ্যাপের ভেতরেই সার্ভার চলে।

1. টিভিতে APK ইনস্টল করে Hotel Launcher খুলুন।
2. টিভি-অ্যাডমিন মেনুতে **সার্ভারের ঘর খালি রাখুন**, রুম `101`, তারপর **সেভ ও সংযোগ পরীক্ষা**। (মেনু খুলতে: ↑ ↑ ↓ ↓ ← → OK, পিন `1234`)
3. স্ক্রিনে একটা লিংক দেখাবে, যেমন `http://192.168.0.120:8080/admin/`। একই Wi-Fi-তে ফোনের ব্রাউজারে সেটা খুলুন, লগইন `admin` / `admin123`।

একক মোডে একটা টিভিই সার্ভার, তাই পুরো হোটেলের জন্য নিচের মতো আলাদা সার্ভার চালানোই ভালো। একক মোডে অ্যাডমিন প্যানেল থেকে APK আপডেট পাঠানো যায় না।

## ১. সার্ভার চালানো

হোটেলের ভেতরের একটি কম্পিউটারে (Mini PC বা Raspberry Pi), যার আইপি স্থির (যেমন `192.168.1.10`):

```bash
# Node.js 22.13 বা নতুন লাগবে
cd server
npm install
ADMIN_PASSWORD='একটা-শক্ত-পাসওয়ার্ড' npm start
```

- অ্যাডমিন প্যানেল: `http://192.168.1.10:8080/admin/` — প্রথম লগইন `admin` / `ADMIN_PASSWORD` (না দিলে `admin123`; লগইনের পর বদলান)।
- ব্রাউজারে অতিথির স্ক্রিন পরীক্ষা: `http://192.168.1.10:8080/tv/?room=101` (কিবোর্ডের তীর, Enter আর Esc রিমোটের মতো কাজ করে)।
- ডেটা থাকে `server/data/`-তে। প্রতিদিন `server/data/backups/`-এ ব্যাকআপ হয় (শেষ ১৪টি থাকে)।

সার্ভারের সেটিংস (environment variable):

| নাম | কাজ | ডিফল্ট |
|---|---|---|
| `PORT` | কোন পোর্টে চলবে | `8080` |
| `DATA_DIR` | ডেটাবেস, ছবি, APK কোথায় থাকবে | `server/data` |
| `ADMIN_PASSWORD` | প্রথমবার চালুর সময় `admin` ইউজারের পাসওয়ার্ড | `admin123` |
| `ADMIN_ALLOWED_CIDRS` | অ্যাডমিন প্যানেল শুধু এই নেটওয়ার্ক থেকে খুলবে, যেমন `192.168.10.0/24` | সব |
| `TV_ALLOWED_CIDRS` | টিভির API শুধু টিভির VLAN থেকে, যেমন `192.168.20.0/24` | সব |
| `BACKUP_COPY_DIR` | দৈনিক ব্যাকআপের একটা কপি এখানেও রাখবে (যেমন USB ড্রাইভ) | — |

কম্পিউটার চালু হলেই সার্ভার চালু করতে Linux-এ systemd সার্ভিস:

```ini
# /etc/systemd/system/hotel-tv.service
[Unit]
Description=Hotel TV server
After=network-online.target

[Service]
WorkingDirectory=/opt/hotel-tv/server
Environment=PORT=8080 ADMIN_ALLOWED_CIDRS=192.168.10.0/24
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now hotel-tv`

## ২. APK বানানো

```bash
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties
./gradlew assembleRelease -PdefaultServer=http://192.168.1.10:8080
```

APK তৈরি হবে `android/app/build/outputs/apk/release/`-এ। `-PdefaultServer` দিলে টিভিতে সার্ভারের ঠিকানা আগে থেকেই বসানো থাকে।
GitHub-এ push করলেও Actions নিজে APK বানিয়ে **Artifacts**-এ রাখে।

**রিলিজ সাইনিং:** `android/keystore.properties` ফাইলে `storeFile`, `storePassword`, `keyAlias`, `keyPassword` দিন (GitHub-এ secrets: `HOTEL_KEYSTORE_B64`, `HOTEL_STORE_PASSWORD`, `HOTEL_KEY_ALIAS`, `HOTEL_KEY_PASSWORD`)। না দিলে debug key দিয়ে সাইন হয়, যা পরীক্ষার জন্য ঠিক আছে, কিন্তু পরে আসল key-তে বদলালে টিভি থেকে আগের অ্যাপ মুছে নতুন করে বসাতে হবে। তাই হোটেলে বসানোর আগে একটা key বানিয়ে নিরাপদে রাখুন:

```bash
keytool -genkeypair -v -keystore hotel.jks -alias hotel -keyalg RSA -keysize 2048 -validity 10000
```

## ৩. টিভিতে বসানো

1. টিভিতে Settings → Device Preferences → Security → **Unknown sources** চালু করুন।
2. APK পেনড্রাইভে এনে File Manager দিয়ে ইনস্টল করুন, অথবা `adb install hotel-launcher-*.apk`।
3. Home চাপলে কোন লঞ্চার চান জিজ্ঞেস করলে **Hotel Launcher → Always** বাছুন।
4. প্রথমবার খুললে টিভি-অ্যাডমিন মেনু সরাসরি আসে: রুম নম্বর আর সার্ভারের ঠিকানা দিয়ে **সেভ ও সংযোগ পরীক্ষা** চাপুন।
5. টিভি রিস্টার্ট করে দেখুন লঞ্চার নিজে খোলে কি না, আর অ্যাডমিন ড্যাশবোর্ডে রুমটা সবুজ হয় কি না।

### টিভির মূল স্ক্রিন ও নিজে থেকে চালু হওয়া

ইনস্টলের পর অ্যাপটি **একবার নিজে খুলুন** (Android নতুন অ্যাপকে নিজে থেকে চালু হতে দেয় না)। প্রথমবার খুললে:

- Android জিজ্ঞেস করবে Hotel Launcher-কে Home অ্যাপ বানাবেন কি না — হ্যাঁ দিন।
- টিভি-অ্যাডমিন স্ক্রিনে একটা চেকলিস্ট দেখাবে। দুটোই ✔ হতে হবে:
  - **Home অ্যাপ:** Home বোতাম চাপলে হোটেল স্ক্রিন আসে।
  - **টিভি চালু হলে নিজে খুলবে:** “Display over other apps” অনুমতি। Android 10 বা নতুন টিভিতে এটা ছাড়া পাওয়ার অন করলে হোটেল স্ক্রিন নিজে আসে না।

রিমোটের পাওয়ার বোতাম বেশিরভাগ টিভিকে শুধু ঘুম পাড়ায়, বন্ধ করে না। অ্যাপের একটা সার্ভিস সারাক্ষণ চলে, আর টিভি জাগলেই হোটেল স্ক্রিন সামনে আনে; পুরো রিস্টার্টের পরও খোলে।

কোনো টিভিতে সেটিংসের বোতাম কাজ না করলে, ADB দিয়ে একবার:

```bash
adb shell appops set com.rangs.hotellauncher SYSTEM_ALERT_WINDOW allow
adb shell cmd package set-home-activity com.rangs.hotellauncher/.HomeAlias
```

Google TV-র কিছু মডেলে Home বোতাম সবসময় Google-এর নিজের হোমে যায়। সেখানে নির্ভরযোগ্য উপায় হলো নিচের Device Owner।

### Device Owner (প্রস্তাবিত)

চেক-আউটে YouTube/Netflix-এর লগইন মোছা, নিঃশব্দ আপডেট, Kiosk লক আর “Always” না চেপেই Home অ্যাপ হওয়ার জন্য টিভিটিকে Device Owner করুন। এটা শুধু **নতুন বা ফ্যাক্টরি রিসেট করা টিভিতে, কোনো Google অ্যাকাউন্ট যোগ করার আগে** হয়:

```bash
adb connect 192.168.1.55
adb install hotel-launcher.apk
adb shell dpm set-device-owner com.rangs.hotellauncher/.AdminReceiver
```

পরে সরাতে চাইলে: টিভি-অ্যাডমিন মেনু → স্থায়ীভাবে লঞ্চার বন্ধ, তারপর ফ্যাক্টরি রিসেট।

## ৪. টিভি থেকে অ্যাপ বন্ধ করা

- হোম স্ক্রিনে রিমোটে ↑ ↑ ↓ ↓ ← → OK চাপুন (অথবা ⚙ সেটিংস টাইল), তারপর পিন। ডিফল্ট পিন `1234`; অ্যাডমিন প্যানেল → টিভি নিয়ন্ত্রণ থেকে অবশ্যই বদলান। ৫ বার ভুল হলে ৫ মিনিট লক হয় আর ড্যাশবোর্ডে সতর্কবার্তা যায়।
- **অ্যাপ থেকে বের হন:** স্বাভাবিক Android TV হোম খোলে; টিভি রিস্টার্ট হলে লঞ্চার ফিরে আসে।
- **স্থায়ীভাবে লঞ্চার বন্ধ:** লঞ্চার আর Home অ্যাপ থাকে না। আবার চালু করতে অ্যাপ তালিকা থেকে Hotel Launcher খুলে টিভি-অ্যাডমিন → লঞ্চার আবার চালু।
- **জরুরি (ADB):**

```bash
adb shell am force-stop com.rangs.hotellauncher
adb shell am start -a android.settings.SETTINGS
adb uninstall com.rangs.hotellauncher   # Device Owner হলে আগে: adb shell dpm remove-active-admin com.rangs.hotellauncher/.AdminReceiver (শুধু test-only বিল্ডে কাজ করে; নইলে ফ্যাক্টরি রিসেট)
```

## JavaScript ব্রিজ (`window.Android`)

| HTML থেকে কল | কাজ |
|---|---|
| `Android.launchApp('com.google.android.youtube.tv')` | YouTube খোলে |
| `Android.launchApp('com.netflix.ninja')` | Netflix খোলে |
| `Android.openLiveTv(pkg)` | টিভির টিউনার অ্যাপ; `pkg` খালি হলে পরিচিত বোর্ডগুলোর প্যাকেজ খুঁজে নেয় |
| `Android.openSettings()` / `openNetworkSettings()` | টিভির Settings / Wi-Fi |
| `Android.exitLauncher()` / `disableLauncherPermanently()` / `enableLauncher()` | লঞ্চার থেকে বের হওয়া / স্থায়ী বন্ধ / আবার চালু |
| `Android.clearGuestData('["com.netflix.ninja"]')` | চেক-আউটে লগইন মোছে (Device Owner, Android 9+) |
| `Android.installUpdate(url, versionCode, sha256)` | নতুন APK নামিয়ে ইনস্টল করে |
| `Android.applyTvSettings('{"maxVolume":80,"kiosk":false}')` | সর্বোচ্চ ভলিউম ও Kiosk লক |
| `Android.getConfig()` / `setConfig(json)` | রুম নম্বর, সার্ভার, ভার্সন, ডিভাইস আইডি |
| `Android.storeGet(k)` / `storeSet(k, v)` | অফলাইন ক্যাশ (টিভির মেমোরিতে) |

টিভির লাইভ টিভি অ্যাপের প্যাকেজ নাম জানতে: `adb shell pm list packages | grep -i tv`, তারপর অ্যাডমিন প্যানেল → কনটেন্ট → লাইভ টিভি-তে বসান।

## কীভাবে কাজ করে

- টিভি সার্ভারের সাথে WebSocket সংযোগ রাখে; না থাকলে প্রতি ৩০ সেকেন্ডে জিজ্ঞেস করে। প্রতি ১ মিনিটে “আমি চালু আছি” সংকেত পাঠায়; ২.৫ মিনিট না এলে ড্যাশবোর্ডে লাল।
- সার্ভার না পেলে টিভি APK-র ভেতরের কপি আর শেষ সেভ করা তথ্য দিয়ে ওয়েলকাম স্ক্রিন দেখায়; সার্ভার ফিরলে নিজে থেকে লাইভ পাতায় চলে যায়।
- সংযোগ না থাকলে অর্ডার টিভিতে জমা থাকে (“পাঠানোর অপেক্ষায়”), সংযোগ ফিরলে চলে যায়; একই অর্ডার দুবার যায় না।
- অফলাইন টিভির জন্য নির্দেশ (রিস্টার্ট, আপডেট, লগইন মোছা) সার্ভারে জমা থাকে, টিভি ফিরলে পায়। সার্ভার রিস্টার্ট হলে এই জমা নির্দেশ মুছে যায়।

## রোল

| রোল | অনুমতি |
|---|---|
| রিসেপশন | ড্যাশবোর্ড, চেক-ইন, চেক-আউট, বার্তা পাঠানো, অর্ডার দেখা |
| কিচেন / রুম সার্ভিস | অর্ডার গ্রহণ ও অবস্থা বদলানো, খাবারের মেনু আর দাম |
| ম্যানেজার | সব কিছু: কনটেন্ট, রুমের তালিকা, রিপোর্ট, ইউজার, লগ |
| টেকনিশিয়ান | টিভি রিস্টার্ট, অ্যাপ আপডেট, ভলিউম সীমা, টিভি-অ্যাডমিন পিন |

## পরীক্ষা

```bash
cd server && npm test
```
