# -*- coding: utf-8 -*-
"""为「拼音王国」生成真音频包（base64 内嵌到单独的 audio.js）。

为什么需要它（2026-09-14 实测）：原先拼音只靠浏览器语音合成（speechSynthesis），
而**不是所有浏览器都有这个接口** —— 联想小新 Pad 上就是 `speechSynthesis` 不存在、
`SpeechSynthesisUtterance` 不存在，于是"听读音"彻底哑掉，页面还查不出原因。
装一套真音频之后：离线可用、发音统一、任何浏览器都能出声；
语音合成退化成"没有音频条目时"的兜底。

流程（与数独那套一致）：edge-tts 48kbps mp3 -> miniaudio 重采样 22.05kHz 单声道
                      -> lameenc 32kbps 重编码 -> base64 写进 audio.js

输出：modules/pinyin-1/audio.js     window.XYB_PINYIN_AUDIO = { '爸爸': 'data:audio/mpeg;base64,…' }
      _build/pinyin_audio.log       体积与时长明细
"""
import asyncio
import base64
import json
import os
import re
import sys

import edge_tts
import lameenc
import miniaudio

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODULE = os.path.join(ROOT, 'modules', 'pinyin-1', 'index.html')
OUT_JS = os.path.join(ROOT, 'modules', 'pinyin-1', 'audio.js')
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pinyin_audio.log')

VOICE = 'zh-CN-XiaoyiNeural'   # 与工作台里数独旁白同一个音色，保持一致
RATE = '-10%'                  # 拼音要听得清，再慢一点
SAMPLE_RATE = 22050
BITRATE = 32
CONCURRENCY = 4
RETRY = 3

OUT = []


def log(s=''):
    OUT.append(str(s))
    print(s)


def collect_texts():
    """从模块里抽出所有需要发音的文本：示例词 word + 例字 sylWord。
       直接解析源码，避免"改了 LETTERS 忘了改音频"这种不同步。"""
    src = open(MODULE, encoding='utf-8').read()
    words = re.findall(r"word:\s*'([^']+)'", src)
    syls = re.findall(r"sylWord:\s*'([^']+)'", src)
    if not words or not syls:
        raise SystemExit('没能从模块里解析出 word / sylWord，检查 LETTERS 的写法')
    ordered = []
    for t in words + syls:
        if t not in ordered:
            ordered.append(t)
    return ordered


def reencode(src_mp3: bytes):
    dec = miniaudio.decode(src_mp3, output_format=miniaudio.SampleFormat.SIGNED16,
                           nchannels=1, sample_rate=SAMPLE_RATE)
    dur_ms = int(len(dec.samples) / SAMPLE_RATE * 1000)
    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(3)
    out = enc.encode(dec.samples.tobytes()) + enc.flush()
    return out, dur_ms


async def synth_one(text, sem, results):
    async with sem:
        for attempt in range(1, RETRY + 1):
            try:
                com = edge_tts.Communicate(text, VOICE, rate=RATE)
                raw = b''.join([c['data'] async for c in com.stream() if c['type'] == 'audio'])
                if len(raw) < 500:
                    raise RuntimeError('音频过短')
                mp3, dur_ms = reencode(raw)
                results[text] = {'mp3': mp3, 'dur_ms': dur_ms}
                log('  ✓ %-6s %5dms %5dB' % (text, dur_ms, len(mp3)))
                return
            except Exception as e:                      # noqa: BLE001
                if attempt == RETRY:
                    log('  ✗ %-6s 失败: %s' % (text, e))
                    results[text] = None
                else:
                    await asyncio.sleep(1.5 * attempt)


async def main():
    texts = collect_texts()
    log('需要发音的文本 %d 条：%s' % (len(texts), '、'.join(texts)))
    sem = asyncio.Semaphore(CONCURRENCY)
    results = {}
    await asyncio.gather(*[synth_one(t, sem, results) for t in texts])

    ok = [t for t in texts if results.get(t)]
    if len(ok) != len(texts):
        missing = [t for t in texts if not results.get(t)]
        log('\n有 %d 条没合成成功：%s' % (len(missing), '、'.join(missing)))

    total = sum(results[t]['mp3'].__len__() for t in ok)
    log('\n成功 %d / %d 条，mp3 共 %.0f KB，base64 后约 %.0f KB'
        % (len(ok), len(texts), total / 1024, total * 4 / 3 / 1024))

    items = []
    for t in texts:
        r = results.get(t)
        if not r:
            continue
        b64 = base64.b64encode(r['mp3']).decode('ascii')
        items.append('  %s: "data:audio/mpeg;base64,%s"'
                     % (json.dumps(t, ensure_ascii=False), b64))

    js = ('/* 拼音王国 · 发音音频包（自动生成，勿手改）\n'
          '   生成：_build/build_pinyin_audio.py，音色 %s，语速 %s\n'
          '   共 %d 条：23 个声母的示例词 + 23 个例字\n'
          '   为什么要有它：不是所有浏览器都提供 speechSynthesis（例如联想小新 Pad），\n'
          '   真音频离线可用、发音统一，语音合成退化为兜底。 */\n'
          'window.XYB_PINYIN_AUDIO = {\n%s\n};\n'
          % (VOICE, RATE, len(ok), ',\n'.join(items)))
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write(js)
    log('已写出 %s（%.0f KB）' % (OUT_JS, os.path.getsize(OUT_JS) / 1024))
    log('平均每条 %.1f KB / %.2f 秒'
        % (total / max(len(ok), 1) / 1024,
           sum(results[t]['dur_ms'] for t in ok) / max(len(ok), 1) / 1000))

    with open(LOG, 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))
    if len(ok) != len(texts):
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
