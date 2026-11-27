"""Place each narration clip at its logged time (timeline.json) and join it to tutorial.webm."""
import json, subprocess
T = 1.9  # trim the blank page load at the start
tl = json.load(open('timeline.json'))
args = ['ffmpeg', '-y', '-ss', str(T), '-i', 'tutorial.webm']
parts = []
for i, c in enumerate(tl):
    args += ['-i', c['file']]
    ms = max(0, int((c['t'] - T) * 1000))
    parts.append(f'[{i+1}:a]aresample=44100,adelay={ms}|{ms}[a{i}]')
fc = ';'.join(parts) + ';' + ''.join(f'[a{i}]' for i in range(len(tl))) + \
     f'amix=inputs={len(tl)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]'
args += ['-filter_complex', fc, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '30',
         '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', 'rangs-hotel-tv-tutorial-voice.mp4']
subprocess.run(args, check=True)
