# টিভি সেটআপ (Windows, ADB দিয়ে)

প্রতিটি টিভিতে একবার। ফ্যাক্টরি রিসেট লাগে না।

## যা লাগবে
- ল্যাপটপে Google-এর **platform-tools** (adb): https://developer.android.com/tools/releases/platform-tools
- এই ফোল্ডারের `setup-tv.bat` আর `restore-tv.bat`, আর সর্বশেষ APK (নাম `hotel` দিয়ে শুরু, যেমন `hotel-launcher-1.1.0.apk`) — সব **platform-tools ফোল্ডারে** রাখুন।
- টিভি আর ল্যাপটপ একই Wi-Fi-তে।

## টিভিতে
Settings → System → About → **Build** ৭ বার → Developer options → **Wireless debugging** চালু।

## ১. প্রথমবার pair করা
Wireless debugging → **Pair device with pairing code**, তারপর ল্যাপটপে:
```
adb pair <IP:pairing-port>
```
৬ অঙ্কের কোড দিন। (এক ল্যাপটপ-টিভি জোড়ার জন্য একবারই)

## ২. setup-tv.bat চালান
ডাবল-ক্লিক করুন, Wireless debugging-এর মূল পাতার **IP address & port** দিন (pairing port নয়)। স্ক্রিপ্ট নিজে:
1. APK ইনস্টল করে
2. “টিভি চালু হলে নিজে খুলবে” আর Home বোতামের অনুমতি দেয় (রিস্টার্টের পরও অ্যাপ নিজে আবার চালু করে নেয়)
3. টিভির নিজের হোম স্ক্রিন বন্ধ করে (Google TV-তে রিপেয়ার স্ক্রিনটাও, নইলে কালো পর্দা আসে)
4. Hotel Launcher-কে Home অ্যাপ বানায়, আর কী কী বন্ধ করেছে তা `disabled-<IP>.txt`-এ সেভ রাখে

শেষে একটা চেক দেখায়, তারপর টিভি রিস্টার্ট করতে চায়।

## ৩. আগের মতো করতে: restore-tv.bat
বন্ধ করা সব অ্যাপ আবার চালু করে (টিভি বিক্রি, সার্ভিস, বা হোটেল মোড পুরো সরাতে)। চাইলে Hotel Launcher মুছেও দেয়।

## সমস্যা হলে
- টিভির পর্দা কালো আর port জানা নেই: ল্যাপটপে `adb mdns services` চালান, অথবা মূল README-র PowerShell port খোঁজার কোড।
- `more than one device`: স্ক্রিপ্ট সবসময় `-s IP:port` ব্যবহার করে, তাই এটা হবে না।
- টিভির রিস্টার্টের পর port বদলায় — `adb devices` বা `adb mdns services` দিয়ে নতুনটা দেখুন।
