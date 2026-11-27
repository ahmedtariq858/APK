# টিউটোরিয়াল ভিডিও আবার বানানো

ইন্টারফেস বদলালে এই স্ক্রিপ্ট দিয়ে নতুন ভিডিও বানানো যায় (Node.js, Playwright আর ffmpeg লাগবে):

```bash
cd server && DATA_DIR=/tmp/tutorial-data PORT=8099 npm start   # নতুন খালি ডেটা দিয়ে
cd tools/tutorial-video && npm install playwright && node record.js
ffmpeg -ss 1.6 -i tutorial.webm -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart rangs-hotel-tv-tutorial.mp4
```
