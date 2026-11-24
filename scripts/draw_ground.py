# The community's ground: fine grain on black (the owner, November 23: "can the community page
# background be a cosy texture?", then option 1, grain, of the three tried: grain, felt and linen).
# One-pixel grain, about 3% light on average with a 2.2% spread, as a seamless 256px grayscale tile
# (random grain tiles without a seam). Change the two numbers below to make it lighter or stronger.
# Usage: python3 scripts/draw_ground.py   (writes web/img/ground.png)
import os
import numpy as np
from PIL import Image

MEAN, SPREAD = 0.032, 0.022
rng = np.random.default_rng(23)
g = rng.standard_normal((256, 256))
g = (g - g.mean()) / g.std()
v = np.round(np.clip(MEAN + SPREAD * g, 0, 1) * 255).astype(np.uint8)
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'img', 'ground.png')
os.makedirs(os.path.dirname(out), exist_ok=True)
Image.fromarray(v, 'L').save(out, optimize=True)
print('wrote', os.path.normpath(out), os.path.getsize(out), 'bytes')
