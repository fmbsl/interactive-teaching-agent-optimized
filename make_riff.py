#!/usr/bin/env python3
"""Generate a midwest-emo twinkly guitar riff as a MIDI file (no deps)."""
import struct

PPQ = 480
SIXTEENTH = PPQ // 4        # 120
EIGHTH = PPQ // 2           # 240
WHOLE = PPQ * 4             # 1920
TEMPO = 140                 # bpm
ARP_DUR = 200               # let 16th arpeggio notes ring (~8th)

# ---- low-level MIDI writers ----
def varlen(v):
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
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
            data += varlen(tick - last) + d
            last = tick
        return b'MTrk' + struct.pack('>I', len(data)) + data + b'\x00' + eot()

# ---- riff: high-pedal arpeggio (the 7th twinkles above the chord tones) ----
def pedal_arp(notes):
    n1, n2, n3, n4 = notes   # n4 = highest (the 7th) -> pedal
    return [n4,n1,n4,n2,n4,n3,n4,n2,  n4,n1,n4,n2,n4,n3,n4,n2]

# lead voicings (sit ~E4-E5 for that shimmering consistency)
CHORDS = {
    'Emaj7': [64, 68, 71, 75],   # E4 G#4 B4 D#5
    'C#m7':  [61, 64, 68, 71],   # C#4 E4 G#4 B4
    'Amaj7': [57, 61, 64, 68],   # A3 C#4 E4 G#4
    'B7':    [59, 63, 66, 69],   # B3 D#4 F#4 A4  (dominant pull back to E)
}
# harmony guitar: parallel thirds below the lead (twin-guitar interlock)
HARM = {
    'Emaj7': [61, 64, 68, 71],
    'C#m7':  [57, 61, 64, 68],
    'Amaj7': [54, 57, 61, 64],
    'B7':    [56, 59, 63, 66],
}
# bass: root/fifth 8th-note pulse
BASS = {
    'Emaj7': (40, 47),   # E2 B2
    'C#m7':  (37, 44),   # C#2 G#2
    'Amaj7': (45, 52),   # A2 E3
    'B7':    (47, 54),   # B2 F#3
}
PROG = ['Emaj7', 'C#m7', 'Amaj7', 'B7']

def vel(i, pedal):
    v = 74
    if pedal: v += 7            # accent the high pedal note
    if i % 4 == 0: v += 5       # gentle downbeat accent
    return min(v, 110)

def guitar_track(ch, prog, table, loops, start_loop=0):
    t = Track(); tick = 0
    for loop in range(loops):
        for chord in PROG:
            if loop >= start_loop:
                seq = pedal_arp(table[chord])
                for i, n in enumerate(seq):
                    s = tick + i * SIXTEENTH
                    t.add(s, note_on(ch, n, vel(i, True)))
                    t.add(s + ARP_DUR, note_off(ch, n))
            tick += WHOLE
    return t

def bass_track():
    t = Track(); tick = 0
    for _ in range(2):
        for chord in PROG:
            root, fifth = BASS[chord]
            for i in range(8):
                s = tick + i * EIGHTH
                n = root if i % 2 == 0 else fifth
                t.add(s, note_on(3, n, 88))
                t.add(s + EIGHTH, note_off(3, n))
            tick += WHOLE
    return t

def conductor():
    t = Track()
    t.add(0, name('Midwest Emo Riff'))
    t.add(0, tempo_meta(TEMPO))
    t.add(0, time_sig(4, 2))     # 4/4
    return t

g1 = guitar_track(0, 27, CHORDS, loops=2, start_loop=0)
g1.add(0, name('Guitar 1 - Twinkle Lead')); g1.add(0, program(0, 27))
g2 = guitar_track(1, 27, HARM,  loops=2, start_loop=1)   # harmony enters 2nd loop
g2.add(0, name('Guitar 2 - Harmony'));    g2.add(0, program(1, 27))
bs = bass_track(); bs.add(0, name('Bass')); bs.add(0, program(3, 33))

tracks = [conductor(), g1, g2, bs]
mid = (b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), PPQ)
       + b''.join(tr.build() for tr in tracks))
out = 'midwest_emo_riff.mid'
with open(out, 'wb') as f:
    f.write(mid)
print(f'wrote {out} ({len(mid)} bytes, {len(tracks)} tracks, {TEMPO} bpm, 8 bars)')
