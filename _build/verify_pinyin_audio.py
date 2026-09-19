# -*- coding: utf-8 -*-
"""把拼音音频包里的 mp3 真的解码一遍，确认每一条都是"能播的声音"，
   而不是一段长度不对的字节。输出 _build/pinyin_audio_verify.log"""
import base64
import io
import os
import re

import miniaudio

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AUDIO_JS = os.path.join(ROOT, 'modules', 'pinyin-1', 'audio.js')
MODULE = os.path.join(ROOT, 'modules', 'pinyin-1', 'index.html')

OUT = []


def log(s=''):
    OUT.append(str(s))
    print(s)


src = open(AUDIO_JS, encoding='utf-8').read()
items = re.findall(r'^ {2}"([^"]+)": "data:audio/mpeg;base64,([A-Za-z0-9+/=]+)"', src, re.M)
log('音频条目：%d 条' % len(items))

bad = []
total_b, total_ms = 0, 0
for text, b64 in items:
    try:
        mp3 = base64.b64decode(b64)
    except Exception as e:                                   # noqa: BLE001
        bad.append('%s: base64 解不开（%s）' % (text, e))
        continue
    try:
        dec = miniaudio.decode(mp3, output_format=miniaudio.SampleFormat.SIGNED16,
                              nchannels=1, sample_rate=22050)
        dur = int(len(dec.samples) / 22050 * 1000)
    except Exception as e:                                   # noqa: BLE001
        bad.append('%s: 解不出音频（%s）' % (text, e))
        continue
    if dur < 400:
        bad.append('%s: 只有 %dms，太短' % (text, dur))
        continue
    if len(set(dec.samples)) < 50:
        bad.append('%s: 波形几乎不变，像是静音' % text)
        continue
    total_b += len(mp3)
    total_ms += dur
    log('  ✓ %-6s %5dms %5dB' % (text, dur, len(mp3)))

# 模块里要发音的词，必须都在音频包里（否则会静默退回语音合成）
mod = open(MODULE, encoding='utf-8').read()
need = []
for t in re.findall(r"(?:word|sylWord):\s*'([^']+)'", mod):
    if t not in need:
        need.append(t)
have = [t for t, _ in items]
missing = [t for t in need if t not in have]
extra = [t for t in have if t not in need]

log('')
log('模块需要发音 %d 个词，音频夹覆盖 %d 个，覆盖不到 %d 个' % (len(need), len(need) - len(missing), len(missing)))
if missing:
    log('  缺：' + '、'.join(missing))
if extra:
    log('  多余的条目（不影响使用）：' + '、'.join(extra))
log('音频总时长 %.1f 秒，mp3 共 %.0f KB，文件 %.0f KB'
    % (total_ms / 1000, total_b / 1024, os.path.getsize(AUDIO_JS) / 1024))
log('')
if bad or missing:
    log('结论：有问题 ❌（%d 条坏音频 / %d 个缺词）' % (len(bad), len(missing)))
    for b in bad:
        log('  - ' + b)
else:
    log('结论：%d/%d 条音频都能正常解码播放，覆盖模块全部发音词 ✅' % (len(items), len(items)))

with io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pinyin_audio_verify.log'),
             'w', encoding='utf-8') as f:
    f.write('\n'.join(OUT))
