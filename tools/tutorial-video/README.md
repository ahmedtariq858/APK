# টিউটোরিয়াল ভিডিও (বাংলা ভয়েস-ওভারসহ) আবার বানানো

Node.js, Playwright, Python, `pip install edge-tts` আর ffmpeg লাগবে।

```bash
python3 voice/make_voice.py                    # voice/narration.json থেকে বাংলা ভয়েস (নারী: Nabanita)
# পুরুষ কণ্ঠ চাইলে: python3 voice/make_voice.py bn-BD-PradeepNeural
cd ../../server && DATA_DIR=/tmp/tutorial-data PORT=8099 npm start   # অন্য টার্মিনালে, খালি ডেটা দিয়ে
cd tools/tutorial-video && npm install playwright && node record.js # প্রতিটি ধাপ তার কথা শেষ হওয়া পর্যন্ত অপেক্ষা করে
python3 mix.py                                  # ভয়েস মিলিয়ে rangs-hotel-tv-tutorial-voice.mp4
```

কথা বদলাতে `voice/narration.json` এডিট করুন (চাবি = ভিডিওর ক্যাপশনের শিরোনাম)।
