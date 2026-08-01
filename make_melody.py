#!/usr/bin/env python3
"""Generate a melodic, twinkly midwest-emo lead as a MIDI file (no deps).

Concept: instead of an arpeggio pattern, a *singing* lead line that leaps then
resolves by step, with grace-note ornaments (tapping feel), a triplet climax up
to the 9th, and a harmony guitar doubling everything a 3rd below (parallel
thirds -- the classic twin-guitar twinkly texture). 8 bars in E major over the
Emaj7 - C#m7 - Amaj7 - B7 loop.
"""
import struct

PPQ = 480
TEMPO = 128                 # a touch slower -> more lyrical
EIGHTH = 240
BAR = 960

# ---- low-level MIDI writers (stdlib only) ----
def varlen(v):
    out = [v & 0x7F]; v >>= 7
    while v:
        out.append((v & 0x7F) | 0x80); v >>= 7
    out.reverse()
    return bytes(out)
def note_on(ch, n, v):  return bytes([0x90 | ch, n, v])
def note_off(ch, n):    return bytes([0x80 | ch, n, 0])
def program(ch, p):     return bytes([0xC0 | ch, p])
def tempo_meta(bpm):
    us = int(60_000_000 / bpm)
    return bytes([0xFF, 0x51, 0x03, (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF])
def time_sig(n, d):     return bytes([0xFF, 0x58, 0x04, n, d, 24, 8])
def name(s):
    b = s.encode('ascii'); return bytes([0xFF, 0x03, len(b)]) + b
def eot():              return bytes([0xFF, 0x2F, 0x00])

class Track:
    def __init__(self): self.ev = []
    def add(self, tick, data): self.ev.append((tick, data))
    def build(self):
        prio = lambda d: 0 if (d[0] & 0xF0) == 0x80 else (1 if (d[0] & 0xF0) == 0x90 else 2)
        ev = sorted(self.ev, key=lambda x: (x[0], prio(x[1])))
        data, last = b'', 0
        for tick, d in ev:
            data += varlen(tick - last) + d; last = tick
        return b'MTrk' + struct.pack('>I', len(data)) + data + b'\x00' + eot()

# ---- the melody: (note, dur, vel). note=0 = rest. dur=50 = grace note ----
# Leaps are followed by stepwise resolution; color tones (9th F#, 7th D#)
# get emphasis; bars 1 & 3 open with a grace-note upper mordent.
MELODY = [
    # Bar1  Emaj7 -- grace D#5 -> E5, leap down to B4, rest (a question)
    (75,  50, 70), (76, 310, 95), (75, 120, 84), (71, 240, 80), (0, 240, 0),
    # Bar2  C#m7 -- step up to E5, hold the D#5 (7th tension)
    (73, 240, 88), (76, 240, 92), (75, 480, 90),
    # Bar3  Amaj7 -- grace G#4 -> A4, descending sigh
    (68,  50, 70), (69, 310, 95), (68, 120, 84), (66, 240, 80), (0, 240, 0),
    # Bar4  B7 -- turn around B (chord tones F# A B A)
    (66, 240, 84), (69, 240, 88), (71, 240, 92), (69, 240, 86),
    # Bar5  Emaj7 -- TRIPLET CLIMAX up to G#5 then step down (the twink peak)
    (71, 160, 90), (76, 160, 99), (80, 160, 103), (78, 160, 97), (76, 160, 92), (75, 160, 88),
    # Bar6  C#m7 -- descending answer, settling
    (73, 360, 92), (71, 120, 84), (69, 240, 82), (68, 240, 80),
    # Bar7  Amaj7 -- ascending phrase
    (66, 240, 84), (69, 240, 88), (73, 240, 92), (71, 240, 86),
    # Bar8  B7 -- cadence settling back to B (leads into a repeat)
    (71, 240, 88), (75, 240, 90), (73, 240, 86), (71, 240, 94),
]

# Harmony: parallel 3rd below, kept inside E major (m3 / M3 chosen per scale
# degree so every harmony note is a natural tone -- no clashes).
HARM_MAP = {76:73, 75:71, 71:68, 73:69, 69:66, 68:64, 66:63, 80:76, 78:75}

# Bass: root-fifth pulse with a leading-tone into the next chord on beat 4.
CHORDS = ['Emaj7', 'C#m7', 'Amaj7', 'B7']
BASS = {
    'Emaj7': [40, 47, 40, 47, 40, 47, 40, 39],   # ...D#2 -> C#2
    'C#m7':  [37, 44, 37, 44, 37, 44, 37, 44],   # ...G#2 -> A2
    'Amaj7': [45, 52, 45, 52, 45, 52, 45, 46],   # ...A#2 -> B2
    'B7':    [47, 54, 47, 54, 47, 54, 47, 39],   # ...D#2 -> E2
}

def melody_track(ch, loops=2):
    t = Track(); tick = 0
    for L in range(loops):
        for note, dur, vel in MELODY:
            if note:
                v = vel + (4 if L == 1 else 0)   # 2nd time slightly bolder
                t.add(tick, note_on(ch, note, min(v, 120)))
                t.add(tick + dur - 8, note_off(ch, note))
            tick += dur
    return t

def harmony_track(ch, loops=2):
    t = Track(); tick = 0
    for _ in range(loops):
        for note, dur, vel in MELODY:
            if note and dur > 60:                 # skip grace notes -> stays clean
                h = HARM_MAP[note]
                t.add(tick + 14, note_on(ch, h, 62))   # delayed, softer (2nd guitarist feel)
                t.add(tick + dur - 8, note_off(ch, h))
            tick += dur
    return t

def bass_track(loops=2):
    t = Track(); tick = 0
    for _ in range(loops):
        for chord in CHORDS:
            for i, n in enumerate(BASS[chord]):
                s = tick + i * EIGHTH
                v = 88 if i % 2 == 0 else 80
                if i == 7: v += 4                 # lean into the leading tone
                t.add(s, note_on(3, n, v))
                t.add(s + EIGHTH, note_off(3, n))
            tick += BAR
    return t

def conductor():
    t = Track()
    t.add(0, name('Midwest Emo Twinkly Lead'))
    t.add(0, tempo_meta(TEMPO))
    t.add(0, time_sig(4, 2))
    return t

g1 = melody_track(0); g1.add(0, name('Lead Guitar - Twink Melody')); g1.add(0, program(0, 27))
g2 = harmony_track(1); g2.add(0, name('Harmony Guitar - 3rds'));     g2.add(0, program(1, 27))
bs = bass_track();    bs.add(0, name('Bass'));                      bs.add(0, program(3, 33))

tracks = [conductor(), g1, g2, bs]
mid = (b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ)
       + b''.join(tr.build() for tr in tracks))
out = 'midwest_emo_twinkly.mid'
with open(out, 'wb') as f:
    f.write(mid)
print(f'wrote {out} ({len(mid)} bytes, {len(tracks)} tracks, {TEMPO} bpm, 16 bars)')
