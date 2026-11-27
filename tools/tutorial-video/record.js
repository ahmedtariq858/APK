const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const B = 'http://localhost:8099';
const OUT = __dirname;
const studioHtml = fs.readFileSync(path.join(OUT, 'studio.html'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: path.join(OUT, 'raw'), size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const VOICE = JSON.parse(fs.readFileSync(path.join(OUT, 'voice/durations.json'), 'utf8'));
  const timeline = [];
  let narrEnd = 0;
  const narrDone = async (extra = 0) => { const left = narrEnd - Date.now(); if (left > 0) await page.waitForTimeout(left); if (extra) await page.waitForTimeout(extra); };
  const narrate = async (k) => {
    const v = VOICE[k];
    if (!v) { console.warn('no voice for', k); return; }
    await narrDone(350);
    timeline.push({ key: k, t: (Date.now() - t0) / 1000, file: v.file });
    narrEnd = Date.now() + v.dur * 1000;
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/studio.html', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: studioHtml }));
  await page.goto(B + '/studio.html');
  await page.waitForTimeout(1500);

  const S = async (fn, ...a) => { if (fn === 'cap') await narrate(a[1]); return page.evaluate(([f, args]) => window.studio[f](...args), [fn, a]); };
  const wait = (ms) => page.waitForTimeout(ms);
  const admin = () => page.frame({ name: 'admin' });
  const tv = () => page.frame({ name: 'tv' });
  const go = async (hash) => { await admin().evaluate((h) => { location.hash = h; }, hash); await wait(900); };
  const press = (k) => tv().evaluate((key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })), k);
  const key = async (k, pause = 650) => { await S('key', k); await press(k); await wait(pause); };
  const typeIn = async (sel, text) => { const l = admin().locator(sel); await l.click(); await l.fill(''); await l.pressSequentially(text, { delay: 70 }); };
  const tvText = (sel) => tv().locator(sel).first();

  // ------------------------------------------------------------ intro
  await narrate('intro1');
  await S('card', `<div class="kicker">RANGS HOTEL TV</div><h1>হোটেল মোড টিউটোরিয়াল</h1>
    <p>অ্যাডমিন প্যানেলে (ব্যাকএন্ড) কিছু বদলালে কীভাবে সাথে সাথে টিভির অ্যাপে চলে যায় — আর হোটেল মোডের মূল ফিচারগুলো</p>`);
  await narrate('intro2');
  await S('card', `<h1 style="font-size:64px">যা দেখবেন</h1><ul>
    <li>চেক-ইন: টিভিতে অতিথির নাম</li><li>কনটেন্ট বদলানো: হোটেলের নাম, Wi-Fi</li>
    <li>চলমান নোটিশ ও পপ-আপ বার্তা</li><li>রিমোট দিয়ে রুম সার্ভিস অর্ডার → কিচেন</li>
    <li>মেনু, ভাষা, টিভি-অ্যাডমিন পিন</li><li>ড্যাশবোর্ড, রিপোর্ট, টিভি নিয়ন্ত্রণ ও চেক-আউট</li></ul>`);
  await narrDone(600);
  await S('card', '');
  await wait(800);

  // ------------------------------------------------------------ 1. empty room
  await S('cap', 1, 'অতিথি আসার আগে টিভি', 'টিভি চালু হলেই হোটেল মোড খোলে। রুমে কেউ না থাকলে “সম্মানিত অতিথি” দেখায়, নিচে ৮টি মেনু।');
  await S('hot', 'tv');
  await wait(5500);

  // ------------------------------------------------------------ 2. login
  await S('cap', 2, 'রিসেপশনে অ্যাডমিন প্যানেলে লগইন', 'ব্রাউজারে সার্ভারের ঠিকানা/admin খুলে ইউজারনেম আর পাসওয়ার্ড দিন।');
  await S('hot', 'admin');
  await typeIn('input[name=username]', 'admin');
  await typeIn('input[name=password]', 'admin123');
  await wait(400);
  await admin().locator('#login-form button').click();
  await admin().waitForSelector('.rooms');
  await wait(3000);

  // ------------------------------------------------------------ 3. check-in
  await S('cap', 3, 'চেক-ইন → টিভিতে অতিথির নাম', 'রুম, অতিথির নাম, ভাষা আর চেক-আউটের সময় দিয়ে সেভ করুন।');
  await go('checkin');
  await admin().selectOption('select[name=room]', '101');
  await typeIn('input[name=guestName]', 'জনাব করিম');
  await wait(600);
  await admin().locator('#ci button.primary').click();
  await S('flow', true);
  await tv().waitForFunction(() => document.querySelector('.welcome h1').textContent.includes('করিম'), null, { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 3, 'সেভ করার সাথে সাথে টিভিতে নাম', 'সার্ভার কয়েক সেকেন্ডের মধ্যে রুম ১০১-এর টিভিতে নাম পাঠিয়ে দিয়েছে — টিভিতে কিছু চাপতে হয়নি।');
  await wait(1200); await S('flow', false);
  await wait(4500);

  // ------------------------------------------------------------ 4. content
  await S('cap', 4, 'কনটেন্ট বদলান — হোটেলের নাম ও Wi-Fi', 'হোটেলের নাম, লোগো, ব্যাকগ্রাউন্ড, Wi-Fi, সেবার সময় — সব এক জায়গা থেকে।');
  await S('hot', 'admin');
  await go('content');
  await typeIn('input[name=hotelName_bn]', 'Rangs গ্র্যান্ড হোটেল');
  await typeIn('input[name=hotelName_en]', 'Rangs Grand Hotel');
  await typeIn('input[name=wifi_ssid]', 'Rangs-Guest');
  await admin().locator('#cf button.primary').scrollIntoViewIfNeeded();
  await wait(500);
  await admin().locator('#cf button.primary').click();
  await S('flow', true);
  await tv().waitForFunction(() => document.querySelector('.brand .name').textContent.includes('গ্র্যান্ড'), null, { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 4, 'সব টিভিতে নতুন নাম ও Wi-Fi', 'একবার সেভ করলেই হোটেলের সব টিভিতে একসাথে বদলে যায়।');
  await wait(1200); await S('flow', false);
  await wait(4000);

  // ------------------------------------------------------------ 5. notices
  await S('cap', 5, 'চলমান নোটিশ পাঠান', 'সব টিভি, একটা ফ্লোর বা একটা রুমে — শুরু আর শেষের সময়ও দেওয়া যায়।');
  await S('hot', 'admin');
  await go('notices');
  await typeIn('textarea[name=textBn]', 'আজ রাত ৮টায় ছাদে বারবিকিউ ডিনার — সবাই আমন্ত্রিত');
  await typeIn('textarea[name=textEn]', 'BBQ dinner on the rooftop tonight at 8 pm');
  await admin().locator('#nf button.primary').click();
  await S('flow', true);
  await tv().waitForSelector('#ticker:not(.hidden)', { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 5, 'টিভির নিচে চলমান নোটিশ', 'অতিথি যা-ই দেখুন, নিচের বারে নোটিশ চলতে থাকে।');
  await wait(1000); await S('flow', false);
  await wait(4500);

  await S('cap', 6, 'জরুরি বার্তা: পুরো পর্দার পপ-আপ', 'গুরুত্বপূর্ণ খবরের জন্য “পুরো পর্দার পপ-আপ” বাছুন।');
  await S('hot', 'admin');
  await typeIn('textarea[name=textBn]', 'সুইমিং পুল আজ বিকেল ৪টা পর্যন্ত রক্ষণাবেক্ষণের জন্য বন্ধ');
  await typeIn('textarea[name=textEn]', 'The pool is closed until 4 pm today');
  await admin().selectOption('select[name=style]', 'popup');
  await wait(500);
  await admin().locator('#nf button.primary').click();
  await S('flow', true);
  await tv().waitForSelector('#popup:not(.hidden)', { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 6, 'টিভিতে পপ-আপ — অতিথি OK চাপলে বন্ধ', 'প্রতিটি পপ-আপ অতিথি একবারই দেখেন।');
  await wait(1000); await S('flow', false);
  await wait(3500);
  await S('remote', 'অতিথি রিমোটে OK চাপলেন');
  await key('Enter', 1500);

  // ------------------------------------------------------------ 7. room service from the TV
  await S('cap', 7, 'অতিথি রিমোট দিয়ে রুম সার্ভিস অর্ডার দেন', 'তীর বোতাম দিয়ে “রুম সার্ভিস”-এ গিয়ে OK, তারপর খাবার বেছে + চাপুন।');
  await S('remote', 'রুম সার্ভিস খোলা হচ্ছে…');
  for (let i = 0; i < 3; i++) await key('ArrowRight');
  await key('Enter', 1500);
  await S('remote', '+ চেপে খাবার যোগ');
  await key('ArrowRight'); // first focusable is "+" of the first dish
  await key('Enter'); await key('Enter');
  await key('ArrowDown'); await key('ArrowDown');
  await key('Enter', 900);
  await S('remote', 'অর্ডার পাঠান বোতামে গিয়ে OK');
  await key('ArrowRight', 900);
  const onSend = await tv().evaluate(() => document.querySelector('.focus')?.dataset.act === 'send');
  if (onSend) { await key('Enter', 1500); } else { await tv().locator('[data-act=send]').click(); await wait(1500); }

  await S('cap', 8, 'অর্ডার সোজা রিসেপশন ও কিচেনে', 'নতুন অর্ডার এলে অ্যাডমিন প্যানেলে শব্দ হয় আর তালিকায় চলে আসে।');
  await S('hot', 'admin');
  await S('flow', true);
  await go('orders');
  await admin().waitForSelector('.order');
  await wait(1000); await S('flow', false);
  await wait(3500);
  await S('cap', 8, 'কিচেন অবস্থা বদলায় → অতিথি টিভিতে দেখেন', '“তৈরি শুরু” চাপলে টিভিতে অর্ডারের পাশে “তৈরি হচ্ছে” দেখায়।');
  await admin().locator('[data-st=preparing]').first().click();
  await S('flow', true);
  await tv().waitForSelector('.st-preparing', { timeout: 8000 });
  await S('hot', 'tv');
  await wait(1200); await S('flow', false);
  await wait(3500);
  await S('hot', 'admin');
  await go('orders');
  await admin().locator('[data-st=delivered]').first().click();
  await S('flow', true);
  await tv().waitForSelector('.st-delivered', { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 8, 'খাবার পৌঁছানো হয়েছে', 'অর্ডারের পুরো অবস্থা: নতুন → তৈরি হচ্ছে → পৌঁছানো।');
  await wait(1200); await S('flow', false);
  await wait(3000);

  // ------------------------------------------------------------ 9. menu availability
  await S('cap', 9, 'মেনু ও দাম — খাবার শেষ হলে এক ক্লিকে', 'কিচেন বা ম্যানেজার খাবার যোগ/বাদ, দাম, ছবি আর “এখন পাওয়া যাচ্ছে না” ঠিক করেন।');
  await S('hot', 'admin');
  await go('menu');
  await wait(1200);
  await admin().locator('[data-toggle="3"]').click();
  await S('flow', true);
  await tv().waitForFunction(() => document.querySelectorAll('.item.na').length > 0, null, { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 9, 'টিভিতে কাচ্চি বিরিয়ানি এখন অর্ডার করা যায় না', 'বদলানোর সাথে সাথে টিভির মেনুতে দেখা যায়।');
  await wait(1200); await S('flow', false);
  await wait(4000);

  // ------------------------------------------------------------ 10. language
  await S('cap', 10, 'বাংলা ↔ English', 'চেক-ইনে বেছে নেওয়া ভাষায় টিভি শুরু হয়; অতিথি নিজেও বদলাতে পারেন।');
  await S('remote', 'Back চেপে হোম, তারপর “English”');
  await key('Escape', 1200);
  for (let i = 0; i < 6; i++) await key('ArrowRight', 450);
  await key('Enter', 3500);
  await key('Enter', 2500); // back to বাংলা

  // ------------------------------------------------------------ 11. TV admin
  await S('cap', 11, 'স্টাফের জন্য লুকানো টিভি-অ্যাডমিন', 'রিমোটে ↑ ↑ ↓ ↓ ← → OK চাপলে পিন চায়। অতিথি অ্যাপ থেকে বের হতে পারেন না।');
  await S('remote', 'লুকানো কম্বিনেশন: ↑ ↑ ↓ ↓ ← → OK');
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']) await key(k, 450);
  await tv().waitForSelector('.pin');
  await wait(1200);
  await S('remote', 'পিন দেওয়া হচ্ছে');
  for (const d of '1234') { await press(d); await wait(500); }
  await tv().waitForSelector('#in-room');
  await S('cap', 11, 'টিভি-অ্যাডমিন মেনু', 'রুম নম্বর, সার্ভারের ঠিকানা, Wi-Fi, টিভির সেটিংস আর অ্যাপ থেকে বের হওয়া — সব এখানে।');
  await wait(5500);
  await key('Escape', 1200);

  // ------------------------------------------------------------ 12. dashboard & reports
  await S('cap', 12, 'ড্যাশবোর্ড: সব রুম এক নজরে', 'সবুজ = টিভি চালু, লাল = অফলাইন। অতিথির নাম আর চলমান অর্ডারও দেখা যায়।');
  await S('hot', 'admin');
  await go('dashboard');
  await wait(5000);
  await S('cap', 12, 'রিপোর্ট', 'দিনে কত অর্ডার ও কত টাকা, কোন খাবার বেশি চলে, কোন টিভি কতক্ষণ অফলাইন ছিল।');
  await go('reports');
  await wait(4500);

  // ------------------------------------------------------------ 13. TV control & app update
  await S('cap', 13, 'টিভি নিয়ন্ত্রণ ও অ্যাপ আপডেট', 'সর্বোচ্চ ভলিউম, পিন বদলানো, অ্যাপ রিস্টার্ট — আর নতুন APK আপলোড করে “নতুন ভার্সন পাঠান”।');
  await go('tv');
  await wait(2500);
  await admin().locator('#ts input[name=maxVolume]').fill('60');
  await admin().locator('#ts input[name=maxVolume]').dispatchEvent('input');
  await wait(1200);
  await admin().locator('#apkf').scrollIntoViewIfNeeded();
  await S('cap', 13, 'নতুন ভার্সন সব টিভিতে একসাথে', 'APK আপলোড করে রুম বেছে “নতুন ভার্সন পাঠান” চাপলে টিভি নিজে নামিয়ে ইনস্টল করে।');
  await wait(5500);

  // ------------------------------------------------------------ 14. check-out
  await S('cap', 14, 'চেক-আউট: এক ক্লিকে রুম রিসেট', 'রুম সার্ভিসের বিল দেখায়, তারপর রিসেট করলে টিভি আবার “সম্মানিত অতিথি”, আর Netflix/YouTube লগইন মুছে যায়।');
  await go('checkout');
  await admin().selectOption('#co-room', '101');
  await admin().waitForSelector('#co-btn');
  await wait(3500);
  await admin().locator('#co-btn').click();
  await wait(1200);
  await admin().locator('#dlg-form button[value=ok]').click();
  await S('flow', true);
  await tv().waitForFunction(() => document.querySelector('.welcome h1').textContent.includes('সম্মানিত'), null, { timeout: 8000 });
  await S('hot', 'tv');
  await S('cap', 14, 'পরের অতিথির জন্য তৈরি', 'অতিথির নাম, অর্ডার আর পপ-আপ সব মুছে টিভি নতুন অতিথির অপেক্ষায়।');
  await wait(1200); await S('flow', false);
  await wait(4500);

  // ------------------------------------------------------------ outro
  await narrate('outro');
  await S('card', `<div class="kicker">RANGS HOTEL TV</div><h1>সব কিছু এক জায়গা থেকে</h1>
    <p>অ্যাডমিন প্যানেলে বদলান — হোটেলের সব টিভিতে কয়েক সেকেন্ডে পৌঁছে যায়।<br>ইন্টারনেট চলে গেলেও হোটেলের ভেতরের সার্ভারে সব চলে।</p>`);
  await narrDone(1800);
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));

  const video = page.video();
  await context.close();
  const p = await video.path();
  fs.renameSync(p, path.join(OUT, 'tutorial.webm'));
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'RECORDED OK');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
