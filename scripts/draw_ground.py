# The community's ground: Alcantara on black (the owner, November 23: "can the community page background
# be a cosy texture?", then "lets try alcantara"). A suede microfibre: its fine fuzz, short fibres lying
# every way, soft patches where the nap lies one way or the other and, brushed, the faint strokes of a
# hand across it. Seamless (every blur wraps around the tile), a 512px grayscale tile of about 27 KB.
# BRUSHED = False draws the soft suede without the strokes; the grain tried first was one-pixel noise
# at 3.2% light with a 2.2% spread.
# Usage: python3 scripts/draw_ground.py   (writes web/img/ground.jpg)
import os
import numpy as np
from PIL import Image, ImageDraw

BRUSHED = True
M = 512
rng = np.random.default_rng(7)

def oriented_blur(a, sx, sy, angle_deg=0.0):
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    t = np.deg2rad(angle_deg)
    u = fx * np.cos(t) + fy * np.sin(t); v = -fx * np.sin(t) + fy * np.cos(t)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * np.pi**2 * ((u * sx)**2 + (v * sy)**2))))

def norm(a):
    a = a - a.mean(); return a / (a.std() + 1e-9)

def fibres(n=26000, ss=2):
    # short fibres in every direction, drawn twice the size with wrap-around, then shrunk
    S = M * ss; im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im)
    xs = rng.uniform(0, S, n); ys = rng.uniform(0, S, n); ang = rng.uniform(0, np.pi, n)
    ln = rng.uniform(3, 9, n) * ss; br = rng.uniform(60, 255, n)
    for x, y, a, l, b in zip(xs, ys, ang, ln, br):
        dx, dy = np.cos(a) * l / 2, np.sin(a) * l / 2
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                if -l < x + ox < S + l and -l < y + oy < S + l:
                    d.line((x + ox - dx, y + oy - dy, x + ox + dx, y + oy + dy), fill=int(b), width=1)
    return norm(np.asarray(im.resize((M, M), Image.BOX), dtype=np.float64))

fuzz = norm(oriented_blur(rng.standard_normal((M, M)), 0.8, 0.8))
fib = norm(oriented_blur(fibres(), 0.5, 0.5))
patches = norm(oriented_blur(rng.standard_normal((M, M)), 46, 46))
nap = norm(oriented_blur(rng.standard_normal((M, M)), 16, 16))
strokes = norm(oriented_blur(rng.standard_normal((M, M)), 34, 3.2, 28))
if BRUSHED:
    a = 0.042 + 0.009 * patches + 0.005 * nap + 0.010 * strokes + 0.007 * fuzz + 0.008 * fib
else:
    a = 0.042 + 0.010 * patches + 0.006 * nap + 0.008 * fuzz + 0.009 * fib
v = np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'ground.jpg')
os.makedirs(os.path.dirname(out), exist_ok=True)
Image.fromarray(v, 'L').save(out, quality=86, optimize=True, progressive=True)
print('wrote', os.path.normpath(out), os.path.getsize(out), 'bytes')
