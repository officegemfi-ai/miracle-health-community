# The community's ground: soft felt, drawn on black (the owner, November 23: "can the community page
# background be a cosy texture?"). Soft clouds you'd feel under a hand, a fibre in them and a fine
# grain, seamless (blurred with wrap-around), as a 512px grayscale tile of about 25 KB.
# Usage: python3 scripts/draw_ground.py   (writes web/img/ground.jpg)
import numpy as np
from PIL import Image
import os
rng = np.random.default_rng(23)
def periodic_blur(a, sx, sy):
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * np.pi**2 * ((fx * sx)**2 + (fy * sy)**2))))
def norm(a): a = a - a.mean(); return a / (a.std() + 1e-9)
M = 512
clouds = norm(periodic_blur(rng.standard_normal((M, M)), 14, 14))
fibre = norm(periodic_blur(rng.standard_normal((M, M)), 1.2, 1.2))
fine = norm(rng.standard_normal((M, M)))
mu, c, f, g = 0.036, 0.022, 0.014, 0.010          # the grain's light on black: about 4% on average
a = np.clip(mu + c * clouds + f * fibre + g * fine, 0, 1)
v = np.round(a * 255).astype(np.uint8)
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'ground.jpg')
Image.fromarray(v, 'L').save(out, quality=82, optimize=True, progressive=True)
print('wrote', os.path.normpath(out), os.path.getsize(out), 'bytes')
