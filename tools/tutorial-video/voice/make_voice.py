"""Bengali narration clips with Microsoft's bn-BD neural voice (pip install edge-tts)."""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
voice = sys.argv[1] if len(sys.argv) > 1 else 'bn-BD-NabanitaNeural'  # or bn-BD-PradeepNeural
os.makedirs(os.path.join(here, 'clips'), exist_ok=True)
out = {}
for i, (k, text) in enumerate(json.load(open(os.path.join(here, 'narration.json'))).items()):
    f = os.path.join(here, 'clips', f'{i:02d}.mp3')
    subprocess.run(['edge-tts', '--voice', voice, '--rate', '+5%', '--text', text, '--write-media', f], check=True)
    d = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
    out[k] = {'file': f, 'dur': round(d, 2)}
json.dump(out, open(os.path.join(here, 'durations.json'), 'w'), ensure_ascii=False, indent=1)
