# -*- coding: utf-8 -*-
"""
为一句话（旁白）批量生成甜美童声音频。

流程：edge-tts 合成 48kbps mp3  ->  miniaudio 解码并重采样到 22.05kHz 单声道
      -> lameenc 以 32kbps 重编码（体积约降 1/3）

输出：
  audio/NNN.mp3        每条台词一个文件
  audio_map.json       [{text, tts, file, dur_ms, bytes}]  供注入 HTML 使用
"""
import asyncio
import json
import os
import sys

import edge_tts
import lameenc
import miniaudio

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'audio')
MAP_PATH = os.path.join(HERE, 'audio_map.json')
TEXT_PATH = os.path.join(HERE, 'narrations.json')

VOICE = 'zh-CN-XiaoyiNeural'   # 晓伊：活泼甜美，适合儿童内容
RATE = '-8%'                   # 语速放慢一点，孩子听得清
VOLUME = '+0%'
PITCH = '+0Hz'

SAMPLE_RATE = 22050
BITRATE = 32
CONCURRENCY = 4
RETRY = 3


def normalize(t: str) -> str:
    """把符号改成更适合朗读的形式（只影响发音，不改动页面显示文本）。"""
    s = t
    # 破折号 / 省略号 -> 停顿
    s = s.replace('——', '，').replace('—', '，')
    s = s.replace('……', '，').replace('…', '，')
    # 圈码 -> 汉字，避免读成"第 1 步"
    for a, b in zip('①②③④⑤⑥⑦⑧⑨', '一二三四五六七八九'):
        s = s.replace(a, b)
    # 装饰性符号与引号：去掉
    for ch in '★☆「」『』':
        s = s.replace(ch, '')
    # 连续标点收敛
    while '，，' in s:
        s = s.replace('，，', '，')
    return s.strip()


def reencode(src_mp3: bytes):
    """解码 -> 重采样 -> 32kbps 单声道重编码，返回 (mp3_bytes, duration_ms)"""
    dec = miniaudio.decode(
        src_mp3,
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=1,
        sample_rate=SAMPLE_RATE,
    )
    pcm = dec.samples.tobytes()
    dur_ms = int(len(dec.samples) / SAMPLE_RATE * 1000)

    enc = lameenc.Encoder()
    enc.set_bit_rate(BITRATE)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(3)
    out = enc.encode(pcm) + enc.flush()
    return out, dur_ms


async def synth_one(idx, text, sem, results):
    tts = normalize(text)
    async with sem:
        for attempt in range(1, RETRY + 1):
            try:
                com = edge_tts.Communicate(tts, VOICE, rate=RATE, volume=VOLUME, pitch=PITCH)
                raw = b''.join([c['data'] async for c in com.stream() if c['type'] == 'audio'])
                if len(raw) < 500:
                    raise RuntimeError('音频过短')
                mp3, dur_ms = reencode(raw)
                fn = '%03d.mp3' % idx
                with open(os.path.join(OUT_DIR, fn), 'wb') as f:
                    f.write(mp3)
                results[idx] = {
                    'text': text, 'tts': tts, 'file': fn,
                    'dur_ms': dur_ms, 'bytes': len(mp3),
                    'raw_bytes': len(raw),
                }
                print('  [%2d] %5dms %6dB  %s' % (idx, dur_ms, len(mp3), text[:26]))
                return
            except Exception as e:                     # noqa: BLE001
                if attempt == RETRY:
                    print('  [%2d] 失败: %s  <- %s' % (idx, e, text[:26]))
                    results[idx] = {'text': text, 'tts': tts, 'file': None,
                                    'dur_ms': 0, 'bytes': 0, 'error': str(e)}
                else:
                    await asyncio.sleep(1.5 * attempt)


async def main():
    data = json.load(open(TEXT_PATH, encoding='utf-8'))
    texts = data['texts']
    # 兜底语句：当前分支虽不可达，仍生成音频，避免以后改动后变哑巴
    for extra in ['这是题目给的数字，不能擦哦。']:
        if extra not in texts:
            texts.append(extra)

    os.makedirs(OUT_DIR, exist_ok=True)
    # 清理旧文件
    for f in os.listdir(OUT_DIR):
        if f.endswith('.mp3'):
            os.remove(os.path.join(OUT_DIR, f))

    print('共 %d 条台词，音色 %s，语速 %s' % (len(texts), VOICE, RATE))
    sem = asyncio.Semaphore(CONCURRENCY)
    results = {}
    await asyncio.gather(*[synth_one(i, t, sem, results) for i, t in enumerate(texts)])

    ordered = [results[i] for i in sorted(results)]
    total_b = sum(r['bytes'] for r in ordered)
    total_ms = sum(r['dur_ms'] for r in ordered)
    ok = sum(1 for r in ordered if r['file'])
    json.dump(ordered, open(MAP_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print()
    print('成功 %d / %d 条' % (ok, len(ordered)))
    print('音频总时长 %.1f 分钟，总体积 %.0f KB（base64 后约 %.0f KB）'
          % (total_ms / 60000, total_b / 1024, total_b * 4 / 3 / 1024))
    print('平均每条 %.1f KB / %.2f 秒' % (total_b / max(ok, 1) / 1024, total_ms / max(ok, 1) / 1000))
    if ok < len(ordered):
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
