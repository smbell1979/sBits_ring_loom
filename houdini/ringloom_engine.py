"""Ring Loom engine for Houdini: a port of the drawing maths in src/ring-loom.html.

The web page is the source of truth. This module reproduces its rings for any look or sequence,
but in 3D: rings come out in world space (after the page's view rotation) and the page's
perspective becomes a camera, instead of being flattened to the screen.

Parity with the page is checked by houdini/test_parity.py against numbers the page itself
computes (test/dump-golden.js). When the page's maths changes, re-run that check.

Arithmetic deliberately mirrors the JavaScript, including its quirks: Math.round rounds halves
up (Python's round() is banker's rounding) and % is a truncating remainder (math.fmod), so the
two agree to rounding error, not just approximately.

One intended difference: blends happen in 3D. The page blends two looks as flat pictures after
projecting them; here the 3D rings blend and the view (angles, camera distance, zoom) blends
separately. Results match the page exactly when both looks share a view and are flat.
"""
import json
import math
import re

import numpy as np

TAU = 2 * math.pi
D2R = math.pi / 180


def jsround(x):
    return math.floor(x + 0.5)


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, a, b):
    return min(b, max(a, v))


# 31 ellipses measured from the Two Lanes "Searching" cover (see the page for the method).
COVER_A = [0.91328, 0.88923, 0.90156, 0.914, 0.92694, 0.93658, 0.94651, 0.95447, 0.96266, 0.9692, 0.97286, 0.97891, 0.99275, 0.98776, 0.98695, 0.97448, 0.97259, 0.964, 0.93834, 0.91339, 0.88916, 0.86564, 0.84284, 0.82075, 0.79937, 0.77871, 0.75877, 0.73954, 0.72102, 0.70322, 0.68613]
COVER_B = [0.87574, 0.85447, 0.80034, 0.7488, 0.69965, 0.6537, 0.61028, 0.56943, 0.53113, 0.49505, 0.46126, 0.42959, 0.39968, 0.37196, 0.34598, 0.32166, 0.29877, 0.27712, 0.25672, 0.23746, 0.21912, 0.20181, 0.1852, 0.16938, 0.15434, 0.13983, 0.1258, 0.1123, 0.09915, 0.08645, 0.0739]
# Rings 0 and 1 use fitted angles, not the measured -59.32 and 10.84: see the page's COVER_PSI.
COVER_PSI = [17.18, 16.24, 14.94, 14.2, 12.84, 11.25, 9.51, 7.81, 6.07, 4.35, 2.66, 1.04, -0.56, -2.17, -3.65, -5.19, -6.62, -8.05, -9.52, -10.88, -12.25, -13.49, -14.73, -15.89, -17.01, -18.03, -19.1, -19.94, -20.64, -21.37, -21.92]
COVER_MEAN_A = sum(COVER_A) / len(COVER_A)
COVER_SCALE = 1.05

PALETTES = {
    "ice": ["#8fb8ff", "#dce9ff", "#ffffff"],
    "spectrum": None,
    "dusk": ["#ff2e88", "#ff8a3d", "#ffe36b"],
    "acid": ["#c4ff3d", "#35ffd2", "#3d7bff"],
    "ember": ["#ff2a00", "#ffae00", "#fff0c2"],
    "ultra": ["#6b00ff", "#ff00d4", "#00e0ff"],
    "infrared": ["#6a00c8", "#ff0040", "#ff9100", "#ffff66", "#ffffff"],
    "aurora": ["#39ff8f", "#1de9b6", "#2979ff", "#b388ff"],
    "vapor": ["#ff71ce", "#b967ff", "#01cdfe", "#05ffa1"],
    "cyber": ["#fcee0a", "#ff003c", "#00f0ff"],
    "fireice": ["#ff3d00", "#ffab91", "#ffffff", "#80d8ff", "#00b0ff"],
    "gold": ["#b87800", "#ffc400", "#fff3b0", "#ffffff"],
    "deepsea": ["#2449ff", "#00b4d8", "#90e0ef", "#e0fbff"],
    "candy": ["#ff9cee", "#b28dff", "#85e3ff", "#aff8db"],
    "magma": ["#7a1fa2", "#d13d7a", "#fc8961", "#fcfdbf"],
    "viridis": ["#6a4fb0", "#3f78b5", "#2a9d9a", "#35b779", "#90d743", "#fde725"],
    "rose": ["#c9707d", "#f0a8a0", "#ffd6c9", "#fff4ef"],
    "sunset": ["#7b2ff7", "#f107a3", "#ff6a00", "#ffd000"],
    "custom": None,
}
GEN_ALIASES = {"mobius": "loxo"}  # "Moebius spiral" became "Loxodromic spiral" (page GEN_ALIASES)
GENS = ["cover", "sphere", "again", "blend", "harmono", "slinky", "hopf", "spiro", "pendulum", "loxo", "strip"]
BASES = ["circle", "polygon", "star", "flower", "heart", "infinity", "super"]

# (id, type, default, min, max) for numbers; (id, type, default, options) for menus. Order and
# values must match the page's SCHEMA -- test_parity.py compares them.
SCHEMA = [
    ("gen", "select", "cover", GENS),
    ("base", "select", "circle", BASES),
    ("sides", "range", 5, 3, 16),
    ("depth", "range", 0.45, 0, 0.9),
    ("superexp", "range", 2, 0.4, 5),
    ("sfM", "range", 5, 0, 24),
    ("sfN1", "range", 2, 0.3, 20),
    ("sfN2", "range", 7, 0.2, 20),
    ("sfN3", "range", 7, 0.2, 20),
    ("rings", "range", 31, 2, 140),
    ("res", "range", 360, 48, 720),
    ("wobble", "range", 0, 0, 0.45),
    ("lobes", "range", 5, 0, 24),
    ("ringPhase", "range", 0.03, 0, 0.5),
    ("wobbleSpeed", "range", 0.8, -4, 4),
    ("flare", "range", 1, 0, 4),
    ("squash", "range", 1, 0.2, 1.6),
    ("twist", "range", 0, -180, 180),
    ("alpha", "range", 55, 0, 90),
    ("sweep", "range", 108, 0, 360),
    ("squashA", "range", 0.92, 0.8, 1),
    ("stretchA", "range", 0.992, 0.95, 1.05),
    ("turn", "range", -1.75, -12, 12),
    ("aspect0", "range", 0.96, 0.02, 1),
    ("angle0", "range", 10, -180, 180),
    ("aspect1", "range", 0.08, 0.02, 1),
    ("angle1", "range", -22, -180, 180),
    ("size1", "range", 0.8, 0.3, 1.6),
    ("phase", "range", 40, -180, 180),
    ("ease", "range", 0.8, 0.3, 3),
    ("fx", "range", 2, 1, 9),
    ("fy", "range", 3, 1, 9),
    ("phaseStep", "range", 0.012, 0, 0.25),
    ("decay", "range", 0.35, 0, 1),
    ("orbitR", "range", 0.38, 0, 0.9),
    ("ringR", "range", 0.5, 0.1, 1),
    ("loops", "range", 1, 0.1, 4),
    ("closed", "toggle", False),
    ("tilt", "range", 75, 0, 90),
    ("hopfLat", "range", 70, 5, 150),
    ("hopfSpread", "range", 60, 0, 150),
    ("hopfTurns", "range", 1, 0.1, 4),
    ("spMode", "select", "hypo", ["hypo", "epi"]),
    ("spLobes", "range", 5, 2, 16),
    ("spPen", "range", 0.8, 0, 3),
    ("spPenSpread", "range", 0.8, -2, 2),
    ("spTwist", "range", 1.5, -30, 30),
    ("spShrink", "range", 0.3, 0, 1),
    ("pwPeriod", "range", 30, 4, 720),
    ("pwSwings", "range", 8, 1, 60),
    ("pwSwing", "range", 50, 0, 180),
    ("pwAxis", "range", 0, 0, 90),
    ("pwShrink", "range", 0.55, 0, 1),
    ("mbSpread", "range", 7, 3, 12),
    ("mbTwist", "range", 1.2, -3, 3),
    ("mbSize", "range", 0.35, 0.05, 0.6),
    ("msRadius", "range", 0.62, 0.2, 1),
    ("msWidth", "range", 0.32, 0.05, 0.7),
    ("msFlat", "range", 0.3, 0, 1),
    ("msTwists", "range", 1, 0, 9),
    ("speed", "range", 1, 0, 3),
    ("drift", "range", 0.3, 0, 2),
    ("rotate", "range", 0, -180, 180),
    ("spin", "range", 0, -60, 60),
    ("yaw", "range", 0, -180, 180),
    ("pitch", "range", 0, -90, 90),
    ("roll", "range", 0, -180, 180),
    ("persp", "range", 0, 0, 1),
    ("zoom", "range", 0.95, 0.3, 2.5),
    # View motion (view_at), per axis: mode, swing amplitude, seconds per cycle.
    *[s for a in ("yaw", "pitch", "roll") for s in (
        (a + "Mode", "select", "off", ["off", "swing", "turn", "turnRev"]),
        (a + "Swing", "range", 30, 0, 180),
        (a + "Period", "range", 8, 0.5, 60))],
    ("palette", "select", "ice", list(PALETTES)),
    ("colorA", "color", "#ff2e88"),
    ("colorB", "color", "#35ffd2"),
    ("spread", "range", 1, 0, 3),
    ("loopColors", "toggle", False),
    ("cycle", "range", 0, -120, 120),
    ("draw", "select", "lines", ["lines", "dots"]),
    ("width", "range", 1.1, 0.25, 5),
    ("dotSize", "range", 3, 0.5, 12),
    ("alphaL", "range", 0.85, 0.05, 1),
    ("fade", "range", 0, 0, 1),
    ("fadeCurve", "range", 1, 0.2, 5),
    ("fadeFrom", "select", "last", ["last", "first", "ends", "middle"]),
    ("glow", "range", 4, 0, 40),
    ("trails", "range", 0, 0, 0.97),
    ("mirror", "range", 1, 1, 12),
    ("copySpan", "select", "full", ["full", "half"]),
    ("reflect", "toggle", False),
    ("additive", "toggle", True),
    ("bg", "color", "#000000"),
]
DEFAULTS = {s[0]: s[2] for s in SCHEMA}
_COLOR_RE = re.compile(r"^#[0-9a-f]{6}$", re.I)


def clean_params(raw):
    """Same rules as the page's cleanParams: defaults, then every valid value from raw."""
    p = dict(DEFAULTS)
    if not isinstance(raw, dict):
        return p
    if raw.get("gen") in GEN_ALIASES:  # renamed generators (page GEN_ALIASES)
        raw = dict(raw, gen=GEN_ALIASES[raw["gen"]])
    for s in SCHEMA:
        sid, typ = s[0], s[1]
        if sid not in raw or raw[sid] is None:
            continue
        v = raw[sid]
        if typ == "range":
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if math.isfinite(f):
                p[sid] = clamp(f, s[3], s[4])
        elif typ == "select":
            if isinstance(v, str) and v in s[3]:
                p[sid] = v
        elif typ == "color":
            if isinstance(v, str) and _COLOR_RE.match(v):
                p[sid] = v
        elif typ == "toggle":
            p[sid] = bool(v)
    return p


# ---------- colour ----------
def hex_to_rgb(h):
    n = int(h[1:], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]


# Blends between looks mix colours in OKLCH (OKLab lightness, chroma, hue the short way round), as
# the page's mixColour does; see its comment for the measurements behind that choice. Arrays of
# 0-255 sRGB colours, shape (..., 3).
_LMS = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                 [0.2119034982, 0.6806995451, 0.1073969566],
                 [0.0883024619, 0.2817188376, 0.6299787005]])
_LAB = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                 [1.9779984951, -2.4285922050, 0.4505937099],
                 [0.0259040371, 0.7827717662, -0.8086757660]])
_LMS_INV = np.array([[1.0, 0.3963377774, 0.2158037573],
                     [1.0, -0.1055613458, -0.0638541728],
                     [1.0, -0.0894841775, -1.2914855480]])
_RGB = np.array([[4.0767416621, -3.3077115913, 0.2309699292],
                 [-1.2684380046, 2.6097574011, -0.3413193965],
                 [-0.0041960863, -0.7034186147, 1.7076147010]])


def rgb_to_oklab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.cbrt(lin @ _LMS.T) @ _LAB.T


def _oklab_to_linear(lab):
    return ((np.asarray(lab, dtype=np.float64) @ _LMS_INV.T) ** 3) @ _RGB.T


def _linear_to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return 255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def oklab_to_rgb(lab):
    return _linear_to_srgb(_oklab_to_linear(lab))


GREY_CHROMA = 1e-4   # below this a colour's hue is rounding noise; the page's GREY_CHROMA


def oklch_to_rgb(L, C, h):
    """OKLCH arrays -> 0-255 sRGB. A colour the screen can't show is pulled toward the grey of the
    same lightness along a straight line in linear light, just far enough to fit (page oklchToRgb,
    which explains why this rather than clipping or keeping hue exactly)."""
    L = np.clip(np.asarray(L, dtype=np.float64), 0, 1)
    C, h = np.asarray(C, dtype=np.float64), np.asarray(h, dtype=np.float64)
    lin = _oklab_to_linear(np.stack([L, C * np.cos(h), C * np.sin(h)], axis=-1))
    g = (L ** 3)[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        over = np.where(lin > 1, (1 - g) / (lin - g), 1.0)
        under = np.where(lin < 0, g / (g - lin), 1.0)
    s = np.minimum(1.0, np.minimum(over, under).min(axis=-1))[..., None]
    return _linear_to_srgb(g + s * (lin - g))


def mix_colour(ca, cb, t):
    """ca mixed t of the way to cb in OKLCH; t may be one value per colour. Ends returned exactly."""
    ca, cb = np.asarray(ca, dtype=np.float64), np.asarray(cb, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    A, B = rgb_to_oklab(ca), rgb_to_oklab(cb)
    Ca, Cb = np.hypot(A[..., 1], A[..., 2]), np.hypot(B[..., 1], B[..., 2])
    ha, hb = np.arctan2(A[..., 2], A[..., 1]), np.arctan2(B[..., 2], B[..., 1])
    ha = np.where(Ca < GREY_CHROMA, hb, ha)
    hb = np.where(Cb < GREY_CHROMA, ha, hb)
    dh = np.arctan2(np.sin(hb - ha), np.cos(hb - ha))
    mixed = oklch_to_rgb(A[..., 0] + (B[..., 0] - A[..., 0]) * t, Ca + (Cb - Ca) * t, ha + dh * t)
    tt = t[..., None] if t.ndim else t
    return np.where(tt <= 0, ca, np.where(tt >= 1, cb, mixed))


def hsl_to_rgb(h, s, l):
    h = math.fmod(math.fmod(h, 360) + 360, 360)
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs(math.fmod(h / 60, 2) - 1))
    m = l - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255]


def colour_u(p, k, N):
    """Ring k's place along the colours (page colourU): k / N round a loop, else 0 -> 1."""
    return k / N if p["loopColors"] else (k / (N - 1) if N > 1 else 0)


def make_color_fn(p, time):
    """Page makeColorFn, including Loop colours (out and back over the loop; Spectrum once round)."""
    shift = time * p["cycle"] / 360
    if p["palette"] == "spectrum":
        if p["loopColors"]:
            return lambda u: hsl_to_rgb((u + shift) * 360, 0.95, 0.62)
        return lambda u: hsl_to_rgb((u * p["spread"] + shift) * 300, 0.95, 0.62)
    stops = [hex_to_rgb(h) for h in ([p["colorA"], p["colorB"]] if p["palette"] == "custom" else PALETTES[p["palette"]])]

    def fn(u):
        x = 2 * (u + shift) if p["loopColors"] else u * p["spread"] + shift
        t = x - math.floor(x)
        if math.floor(x) % 2 == 1:  # ping-pong so cycling has no seam
            t = 1 - t
        f = t * (len(stops) - 1)
        i = min(len(stops) - 2, math.floor(f))
        w = f - i
        a, b = stops[i], stops[i + 1]
        return [lerp(a[0], b[0], w), lerp(a[1], b[1], w), lerp(a[2], b[2], w)]
    return fn


# ---------- matrices (row-major, as on the page) ----------
def mat2(a, b):
    return (a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3])


def rot2(deg):
    c, s = math.cos(deg * D2R), math.sin(deg * D2R)
    return (c, -s, s, c)


def diag2(x, y):
    return (x, 0, 0, y)


def mat3(a, b):
    return [a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] for r in range(3) for c in range(3)]


def rx3(d):
    c, s = math.cos(d * D2R), math.sin(d * D2R)
    return [1, 0, 0, 0, c, -s, 0, s, c]


def ry3(d):
    c, s = math.cos(d * D2R), math.sin(d * D2R)
    return [c, 0, s, 0, 1, 0, -s, 0, c]


def rz3(d):
    c, s = math.cos(d * D2R), math.sin(d * D2R)
    return [c, -s, 0, s, c, 0, 0, 0, 1]


def rot_axis(ax, ang):
    x, y, z = ax
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
            y * x * C + z * s, c + y * y * C, y * z * C - x * s,
            z * x * C - y * s, z * y * C + x * s, c + z * z * C]


def view_matrix(pitch, yaw, rot, roll=0.0):
    # Roll is applied last: it turns the finished view about the viewing direction.
    return mat3(rz3(roll), mat3(mat3(rx3(pitch), ry3(yaw)), rz3(rot)))


def linear_mats(p, N, time):
    mats = []
    if p["gen"] == "cover":
        L = len(COVER_A) - 1
        for k in range(N):
            u = k / (N - 1) if N > 1 else 0
            f = u * L
            i = min(L - 1, math.floor(f))
            t = f - i
            a = lerp(COVER_A[i], COVER_A[i + 1], t)
            b = lerp(COVER_B[i], COVER_B[i + 1], t)
            psi = lerp(COVER_PSI[i], COVER_PSI[i + 1], t)
            a = COVER_MEAN_A + (a - COVER_MEAN_A) * p["flare"]
            b *= p["squash"]
            psi += p["twist"] * u + p["drift"] * 25 * math.sin(time * 0.6 + u * TAU)
            mats.append(mat2(rot2(psi), diag2(a * COVER_SCALE, b * COVER_SCALE)))
    elif p["gen"] == "again":
        # One full turn: 360 / N per ring, held exact (page linearMats).
        turn = 360 / N if p["closed"] else p["turn"] + p["drift"] * 3 * math.sin(time * 0.7)
        A = mat2(rot2(turn), diag2(p["stretchA"], p["squashA"]))
        M = (1, 0, 0, 1)
        for _ in range(N):
            mats.append(M)
            M = mat2(A, M)
    elif p["gen"] == "blend":
        M0 = mat2(rot2(p["angle0"]), diag2(1, p["aspect0"]))
        M1 = mat2(mat2(rot2(p["angle1"]), diag2(p["size1"], p["size1"] * p["aspect1"])), rot2(p["phase"] + p["drift"] * time * 30))
        for k in range(N):
            u = k / (N - 1) if N > 1 else 0
            # Below 1, the mirror of the curve above 1 (page linearMats: u ** ease orphaned the
            # first ring there).
            l = u ** p["ease"] if p["ease"] >= 1 else 1 - (1 - u) ** (1 / p["ease"])
            mats.append(tuple(lerp(M0[i], M1[i], l) for i in range(4)))
    return mats


def js_mod_pos(th, seg):
    # The page writes ((th % seg) + seg) % seg; keep the double remainder for identical rounding.
    return np.fmod(np.fmod(th, seg) + seg, seg)


SUPER_SAMPLES = 1440


def super_r(a, p):
    """Superformula radius (page superR): (|cos(m a/4)|^n2 + |sin(m a/4)|^n3)^(-1/n1), 0 where
    that overflows."""
    x = jsround(p["sfM"]) * np.asarray(a, dtype=np.float64) / 4
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        b = np.abs(np.cos(x)) ** p["sfN2"] + np.abs(np.sin(x)) ** p["sfN3"]
        r = b ** (-1 / p["sfN1"])
    return np.where(np.isfinite(r), r, 0.0)


def super_shape(p):
    """(largest radius over both turns, whether the outline goes round twice) -- page superShape:
    odd symmetry with Shape A != Shape B only closes without a kink over two turns."""
    m = jsround(p["sfM"])
    rmax = float(np.max(super_r(2 * TAU * np.arange(SUPER_SAMPLES) / SUPER_SAMPLES, p)))
    return (rmax if rmax > 0 else 1.0), (m % 2 == 1 and p["sfN2"] != p["sfN3"])


def base_xy(th, c, s, p, e):
    n = jsround(p["sides"])
    b = p["base"]
    if b == "polygon":
        seg = TAU / n
        a = js_mod_pos(th, seg) - seg / 2
        r = math.cos(math.pi / n) / np.cos(a)
        return c * r, s * r
    if b == "star":
        seg = TAU / n
        h = seg / 2
        a = js_mod_pos(th, seg)
        a = np.where(a > h, seg - a, a)
        ri = 1 - p["depth"]
        dx, dy = ri * math.cos(h) - 1, ri * math.sin(h)
        r = dy / (np.cos(a) * dy - np.sin(a) * dx)
        return c * r, s * r
    if b == "flower":
        r = 1 - p["depth"] * (0.5 - 0.5 * np.cos(n * th))
        return c * r, s * r
    if b == "heart":
        x = 16 * s * s * s
        y = 13 * c - 5 * np.cos(2 * th) - 2 * np.cos(3 * th) - np.cos(4 * th)
        return x / 17, (y + 2.5) / 17
    if b == "infinity":
        d = 1 + s * s
        return c / d, (s * c) / d * 1.4
    if b == "super":
        smax, twice = super_shape(p)
        a = 2 * th if twice else th
        r = super_r(a, p) / smax
        return np.cos(a) * r, np.sin(a) * r
    if e == 1:
        return c, s
    return np.sign(c) * np.abs(c) ** e, np.sign(s) * np.abs(s) ** e


HOPF_SCALE = 0.45
LOXO_SCALE = 0.7  # Loxodromic spiral poles at +-LOXO_SCALE (page explains)


def dot_oversample(M):
    """How many times finer a ring is sampled before its dots are spaced (page dotOversample)."""
    return max(4, min(16, jsround(2880 / M)))


def resample_ring(src, M):
    """M points evenly spaced by distance along the closed polyline src ((n + 1, 3), last point
    repeating the first), the first kept, the last repeating it: the page's resampleRing, with the
    same running sums and the same segment for each target distance."""
    n = src.shape[0] - 1
    cum = np.zeros(n + 1)
    for i in range(n):  # a plain running sum, in the page's order, for identical rounding
        d = src[i + 1] - src[i]
        cum[i + 1] = cum[i] + math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
    total = cum[n]
    out = np.zeros((M + 1, 3))
    if not total > 0:
        out[:] = src[0]
        return out
    i = 0
    for j in range(M):
        s = total * j / M
        while i + 1 < n and cum[i + 1] <= s:
            i += 1
        seg = cum[i + 1] - cum[i]
        t = (s - cum[i]) / seg if seg > 0 else 0.0
        out[j] = src[i] + t * (src[i + 1] - src[i])
    out[M] = out[0]
    return out


def ring_world(p, k, N, M, time, mats):
    """One ring's points before the view rotation, shape (M + 1, 3); the last point repeats the first."""
    u = k / (N - 1) if N > 1 else 0
    th = np.arange(M + 1, dtype=np.float64) / M * TAU
    th[M] = 0
    c, s = np.cos(th), np.sin(th)
    e = 2 / p["superexp"]
    lobes = jsround(p["lobes"])
    wph = TAU * p["ringPhase"] * k + p["wobbleSpeed"] * time
    bx, by = base_xy(th, c, s, p, e)
    rr = 1 + p["wobble"] * np.sin(lobes * th + wph)
    px, py = bx * rr, by * rr
    g = p["gen"]
    if mats is not None:
        m = mats[k]
        x, y, z = m[0] * px + m[1] * py, m[2] * px + m[3] * py, np.zeros_like(px)
    elif g == "sphere":
        a = p["alpha"] * D2R
        sweep_k = 360 * k / N if p["closed"] else p["sweep"] * u  # One full turn (page ringPre)
        R = rot_axis([math.sin(a), 0, math.cos(a)], (-sweep_k - p["drift"] * 18 * time) * D2R)
        x, y, z = R[0] * px + R[1] * py, R[3] * px + R[4] * py, R[6] * px + R[7] * py
    elif g == "harmono":
        A = 1 - p["decay"] * u
        hpx = TAU * (k / N if p["closed"] else p["phaseStep"] * k) + p["drift"] * time * 0.6
        x = A * np.sin(p["fx"] * th + hpx) * rr
        y = A * np.sin(p["fy"] * th + math.pi / 2) * rr
        z = np.zeros_like(x)
    elif g == "hopf":
        # Hopf fibre over (latitude, longitude) of the 2-sphere, stereographically projected from
        # (0, 0, 0, 1): an exact circle; every pair links once (page ringPre, which explains the
        # latitude cap at 150). Base shape and wobble are ignored.
        lat = min(max(p["hopfLat"] + p["hopfSpread"] * (u - 0.5), 3), 150) * D2R / 2
        hc, hs = math.cos(lat), math.sin(lat)
        az = TAU * p["hopfTurns"] * k / N + p["drift"] * time * 0.4
        d = HOPF_SCALE / (1 - hs * np.sin(th + az))
        x, y, z = hc * c * d, hc * s * d, hs * np.cos(th + az) * d
    elif g == "spiro":
        # Pen on a wheel of radius 1/n rolling inside (hypo) or outside (epi) the unit ring; every
        # ring divided by the largest reach so the biggest touches the unit circle (page ringPre).
        n = jsround(p["spLobes"])
        sg = 1 if p["spMode"] == "epi" else -1
        pen = lambda v: max(0.0, p["spPen"] + p["spPenSpread"] * (v - 0.5))
        reach = 1 + sg / n + max(pen(0), pen(1)) / n
        R = 1 + sg / n
        d = pen(u) / n
        S = (1 - p["spShrink"] * u) / reach
        a = p["spTwist"] * k * D2R
        ca, sa = math.cos(a), math.sin(a)
        w = R * n * th + p["drift"] * time * 0.8
        qx = (R * c - sg * d * np.cos(w)) * S * rr
        qy = (R * s - d * np.sin(w)) * S * rr
        x, y, z = ca * qx - sa * qy, sa * qx + ca * qy, np.zeros_like(qx)
    elif g == "pendulum":
        # Ring k swings Swings + k times per Period, so all are level and in line at every whole
        # period (page ringPre).
        ang = p["pwSwing"] * math.sin(TAU * (jsround(p["pwSwings"]) + k) * time / p["pwPeriod"]) * D2R
        t = p["pwAxis"] * D2R
        sc = 1 - p["pwShrink"] * u
        R = [v * sc for v in rot_axis([math.cos(t), 0, math.sin(t)], ang)]
        x, y, z = R[0] * px + R[1] * py, R[3] * px + R[4] * py, R[6] * px + R[7] * py
    elif g == "strip":
        # Rings round a loop, each across the band, long axis turning Half twists x angle / 2: half a
        # turn per trip for the Moebius strip (page ringPre).
        ph = TAU * k / N + p["drift"] * time * 0.3
        a = jsround(p["msTwists"]) * ph / 2
        cr, sr, ca, sa = math.cos(ph), math.sin(ph), math.cos(a), math.sin(a)
        w, d = p["msWidth"], p["msWidth"] * p["msFlat"]
        out = w * px * ca - d * py * sa
        x = p["msRadius"] * cr + out * cr
        y = p["msRadius"] * sr + out * sr
        z = w * px * sa + d * py * ca
    elif g == "loxo":
        # In w the map is multiplication by e^(t + i Twist t); z = (w + 1) / (w - 1) carries its
        # fixed points 0 and infinity to the poles -1 and +1. Rings sit evenly in t across Spread and
        # cycle round it with Drift (page ringPre, which explains the huge arcs near z's pole w = 1).
        L = p["mbSpread"]
        tt = -L / 2 + loxo_slot(p, k, N, time)
        gm, ph = math.exp(tt), p["mbTwist"] * tt
        lr, li = gm * math.cos(ph), gm * math.sin(ph)
        ar, ai = p["mbSize"] * px - 1, p["mbSize"] * py
        wr, wi = lr * ar - li * ai, lr * ai + li * ar
        dr = wr - 1
        den = dr * dr + wi * wi
        x = LOXO_SCALE * (wr * wr + wi * wi - 1) / den
        y = -2 * LOXO_SCALE * wi / den
        z = np.zeros_like(x)
    else:  # slinky
        # One full turn: spaced 360/N, so the last ring stops a gap short of the first (page ringPre).
        ph = (TAU * k / N if p["closed"] else TAU * p["loops"] * u) + p["drift"] * time * 0.4
        tl = p["tilt"] * D2R
        cc, ss = math.cos(ph), math.sin(ph)
        e1 = (cc, ss, 0)
        e2 = (-ss * math.cos(tl), cc * math.cos(tl), math.sin(tl))
        r = p["ringR"]
        x = p["orbitR"] * cc + r * (px * e1[0] + py * e2[0])
        y = p["orbitR"] * ss + r * (px * e1[1] + py * e2[1])
        z = r * (px * e1[2] + py * e2[2])
    return np.stack([x, y, z], axis=1)


# Camera parameters driven by the SOP's detail attributes (sop_glue), for make_example_hip.py and
# update_hip_code.py: (camera parm, detail attribute).
CAMERA_EXPRESSIONS = [("tz", "cam_distance"), ("focal", "cam_focal"), ("aperture", "cam_aperture"),
                      ("projection", "cam_ortho"), ("orthowidth", "cam_orthowidth"), ("far", "cam_far")]


def camera_projection(P, tz, focal, aperture, ortho, orthowidth, res):
    """Where a Houdini camera on +Z (these parameter values) puts world points P, in pixels about
    the centre of a square res x res frame, y down -- to compare with project(frame, res)."""
    if ortho:
        s = res / orthowidth
        return np.stack([P[:, 0] * s, -P[:, 1] * s], axis=1)
    s = (focal / aperture) * res / (tz - P[:, 2])
    return np.stack([P[:, 0] * s, -P[:, 1] * s], axis=1)


def persp_k(p):
    """Perspective strength, 1 / camera distance (page perspK): the old distance 2.4 + 40 (1 - p)
    from p = 0.3 up, easing to exactly 0 -- orthographic -- at p = 0."""
    x = min(1.0, p / 0.3)
    return x * x * (3 - 2 * x) / (2.4 + (1 - p) * 40)


def persp_f(k, z):
    """Screen scale for depth z at strength k: 1 / (1 - k z), floored (page perspF); 1 when k = 0."""
    return 1 / np.maximum(0.25 * k, 1 - k * z)


def kaleido_copies(p):
    """Page kaleidoCopies: (angle, weight, sx) per copy, over a full or half circle, each followed
    by its left-right reflected twin (sx -1) with Mirror copies."""
    m = jsround(p["mirror"])
    span = math.pi if p["copySpan"] == "half" else TAU
    out = []
    for i in range(m):
        out.append((i / m * span, 1.0, 1.0))
        if p["reflect"]:
            out.append((i / m * span, 1.0, -1.0))
    return out


def loxo_slot(p, k, N, time):
    """Where ring k sits along the Loxodromic spiral, 0 to Spread (page loxoSlot)."""
    L = p["mbSpread"]
    return math.fmod(math.fmod((k + 0.5) * L / N + p["drift"] * time * 0.25, L) + L, L)


def fade_weights(p, N, time):
    """Ring fade (page fadeWeight): each ring's brightness, 1 - fade * x ** curve, x running 0 -> 1
    toward the faded end. On the Loxodromic spiral x follows where the ring is along the spiral, and
    the ring wrapping from one pole to the other crossfades (page explains)."""
    u = np.arange(N) / (N - 1) if N > 1 else np.zeros(N)
    edge = np.ones(N)
    if p["gen"] == "loxo":
        u = np.array([loxo_slot(p, k, N, time) for k in range(N)]) / p["mbSpread"]
        edge = np.clip(u * N, 0, 1) * np.clip((1 - u) * N, 0, 1)
    if not p["fade"]:
        return edge
    x = {"first": 1 - u, "ends": np.abs(2 * u - 1), "middle": 1 - np.abs(2 * u - 1)}.get(p["fadeFrom"], u)
    return edge * (1 - p["fade"] * x ** p["fadeCurve"])


def look3d(p, time, M=None):
    """A look at one moment: rings before the view rotation, plus view and drawing settings."""
    N = jsround(p["rings"])
    M = M or jsround(p["res"])
    mats = linear_mats(p, N, time) if p["gen"] in ("cover", "again", "blend") else None
    color = make_color_fn(p, time)
    if p["draw"] == "dots":  # dots spaced evenly along each ring (page look3d / resampleRing)
        pre = np.stack([resample_ring(ring_world(p, k, N, dot_oversample(M) * M, time, mats), M) for k in range(N)])
    else:
        pre = np.stack([ring_world(p, k, N, M, time, mats) for k in range(N)])
    rgb = np.array([color(colour_u(p, k, N)) for k in range(N)], dtype=np.float64)
    m = jsround(p["mirror"])
    return {
        "pre": pre, "rgb": rgb, "w": fade_weights(p, N, time),
        # rotate and spin are kept apart (with time) for blends; rot is the angle actually used.
        "view": dict(view_at(p, time), rot=p["rotate"] + p["spin"] * time,
                     rotate=p["rotate"], spin=p["spin"], time=time, k=persp_k(p["persp"]), zoom=p["zoom"]),
        "copies": kaleido_copies(p),
        "look": {"width": p["width"], "alpha": p["alphaL"], "glow": p["glow"], "trails": p["trails"],
                 # dots: 1 drawn as dots, 0 as lines, between in a blend (page look3d / blendFrames)
                 "dots": 1.0 if p["draw"] == "dots" else 0.0, "dot": p["dotSize"],
                 "additive": bool(p["additive"]), "bg": [float(v) for v in hex_to_rgb(p["bg"])]},
    }


def pair_up(na, nb):
    """Same pairing as the page: the longer list sets the count, shared elements split brightness."""
    n = max(na, nb)

    def mp(ns, i):
        return i if ns == n else jsround((i / (n - 1) if n > 1 else 0) * (ns - 1))
    ia = [mp(na, i) for i in range(n)]
    ib = [mp(nb, i) for i in range(n)]
    da, db = [0] * na, [0] * nb
    for i in range(n):
        da[ia[i]] += 1
        db[ib[i]] += 1
    return n, ia, ib, [1 / da[k] for k in ia], [1 / db[k] for k in ib]


def _shortest(a, b, t):
    d = math.fmod(math.fmod(b - a, 360) + 540, 360) - 180
    return a + d * t


def ring_progress(u, n, stagger, ease):
    """Each ring's eased progress through a blend (page ringProgress). u is the raw 0-1 time.

    Stagger s delays ring i by s * i / (n - 1) of the blend (the last ring first when negative),
    and every ring still runs 0 -> 1, over the remaining 1 - s.
    """
    f = EASES[ease]
    s = clamp(abs(stagger), 0, MAX_STAGGER)
    if not s:
        return np.full(n, f(u))
    out = np.empty(n)
    for i in range(n):
        pos = i / (n - 1) if n > 1 else 0.0
        if stagger < 0:
            pos = 1 - pos
        out[i] = f(clamp((u - s * pos) / (1 - s), 0, 1))
    return out


MATCH_TIE = 1e-9


def ring_match(A, B, M):
    """Renumbering of ring B's points that least moves them from ring A's (page ringMatch, which
    explains why): (k, dir) meaning B point (dir * j + k) mod M partners A point j, or None for
    the original numbering. Same candidates, same order and same tie rule as the page, so both
    pick the same one."""
    S = max(1, M // 90)
    A, B = A[:M], B[:M]

    def pick(cands, step):
        j = np.arange(0, M, step)
        idx = np.array([(d * j + k) % M for k, d in cands])
        diff = A[j][None, :, :] - B[idx]
        costs = np.sum(diff * diff, axis=(1, 2))
        least = costs.min()
        return cands[int(np.argmax(costs <= least * (1 + MATCH_TIE)))]

    coarse = [(0, 1)] + [(k, d) for d in (1, -1) for k in range(0, M, S) if d == -1 or k]
    k0, d0 = pick(coarse, S)
    fine = [(0, 1)] + [((k0 + d) % M, d0) for d in range(-S, S + 1) if d0 == -1 or (k0 + d) % M]
    k, d = pick(fine, 1)
    return None if (k, d) == (0, 1) else (k, d)


def ring_matches(pa, pb, tau0, M):
    """Point numbering for every ring pair of a blend from look pa to pb that began at clock tau0."""
    fa, fb = look3d(pa, tau0, M), look3d(pb, tau0, M)
    n, ia, ib, _, _ = pair_up(len(fa["w"]), len(fb["w"]))
    Mp = fa["pre"].shape[1] - 1
    return [ring_match(fa["pre"][ia[i]], fb["pre"][ib[i]], Mp) for i in range(n)]


def _renumber(pre, match):
    """Ring points (M + 1, 3) renumbered by match; the closing point repeats the new first one."""
    if match is None:
        return pre
    k, d = match
    M = pre.shape[0] - 1
    idx = (d * np.arange(M) + k) % M
    return pre[np.append(idx, idx[0])]


def view_at(p, time):
    """View motion (page viewAt): yaw, pitch and roll at clock time, with pitch_turns marking a pitch
    that turns on past +-90."""
    v = {}
    for a in ("yaw", "pitch", "roll"):
        mode, ph = p[a + "Mode"], time / p[a + "Period"]
        off = p[a + "Swing"] * math.sin(TAU * ph) if mode == "swing" else 360 * ph if mode == "turn" else -360 * ph if mode == "turnRev" else 0
        v[a] = p[a] + off
    v["pitch_turns"] = p["pitchMode"] in ("turn", "turnRev")
    return v


def angle_mix(a, b, a0, b0, t, turns=0):
    """Page angleMix: a to b, t of the way (t may be per-ring), the way round chosen from a0, b0
    (where the angles stood when the blend began) and kept, plus whole extra turns."""
    g0 = b0 - a0
    way = g0 - (math.fmod(math.fmod(g0, 360) + 540, 360) - 180)
    return a + t * (b - a - way + 360 * turns)


def rot_between(va, vb, time, tau0, t):
    """The in-plane angle (Rotate + spin x clock) t of the way from look a to b (page rotBetween):
    each look keeps its own spin, and the gap between them closes the short way round, the way
    chosen from the gap at tau0 (the clock when the blend began) and kept for the whole blend."""
    g0 = vb["rotate"] - va["rotate"] + (vb["spin"] - va["spin"]) * tau0
    way = g0 - (math.fmod(math.fmod(g0, 360) + 540, 360) - 180)
    return va["rotate"] + va["spin"] * time + t * (vb["rotate"] - va["rotate"] + (vb["spin"] - va["spin"]) * time - way)


def blend3d(A, B, u, turns=0, stagger=0.0, swirl=0.0, ease="linear", tau0=None, matches=None, views0=None):
    """A morphing into B at raw blend time u, with the card's ease, extra roll turns, stagger and
    swirl (page morphFrame, blendFrames). Ring shapes, colours and view angles follow each ring's
    own progress; the camera (distance, zoom) and drawing settings follow the overall eased
    progress. Rotate and spin follow rot_between; tau0 is the clock when the blend began (the
    frames' own time if None). matches: each ring pair's point numbering (ring_matches), or None
    to pair point j with point j."""
    t = EASES[ease](u)
    n, ia, ib, wa, wb = pair_up(len(A["w"]), len(B["w"]))
    te = ring_progress(u, n, stagger, ease)
    pa = A["pre"][ia]
    pb = np.stack([_renumber(B["pre"][ib[i]], matches[i] if matches else None) for i in range(n)])
    pre = pa + (pb - pa) * te[:, None, None]
    rgb = mix_colour(A["rgb"][ia], B["rgb"][ib], te)
    w = np.array([lerp(A["w"][ia[i]] * wa[i], B["w"][ib[i]] * wb[i], te[i]) for i in range(n)])
    cn, cia, cib, cwa, cwb = pair_up(len(A["copies"]), len(B["copies"]))
    copies = [(lerp(A["copies"][cia[i]][0], B["copies"][cib[i]][0], t),
               lerp(A["copies"][cia[i]][1] * cwa[i], B["copies"][cib[i]][1] * cwb[i], t),
               lerp(A["copies"][cia[i]][2], B["copies"][cib[i]][2], t)) for i in range(cn)]
    va, vb = A["view"], B["view"]
    # Angles per ring (arrays), so staggered rings turn into place one after another.
    # views0: both looks' view_at when the blend began (their angles keep moving with View motion);
    # without it, the frames' own angles.
    a0, b0 = views0 if views0 else (va, vb)
    pitch_turns = va.get("pitch_turns") or vb.get("pitch_turns")
    view = {"pitch": angle_mix(va["pitch"], vb["pitch"], a0["pitch"], b0["pitch"], te) if pitch_turns
                     else va["pitch"] + (vb["pitch"] - va["pitch"]) * te,
            "yaw": angle_mix(va["yaw"], vb["yaw"], a0["yaw"], b0["yaw"], te),
            "roll": angle_mix(va["roll"], vb["roll"], a0["roll"], b0["roll"], te, turns),
            "rot": rot_between(va, vb, va["time"], va["time"] if tau0 is None else tau0, te),
            # Perspective mixes as strength, not camera distance (page blendFrames).
            "k": lerp(va["k"], vb["k"], t), "zoom": lerp(va["zoom"], vb["zoom"], t)}
    la, lb = A["look"], B["look"]
    look = {k: lerp(la[k], lb[k], t) for k in ("width", "alpha", "glow", "trails", "dots", "dot")}
    look["additive"] = la["additive"] if t < 0.5 else lb["additive"]
    look["bg"] = [float(v) for v in mix_colour(la["bg"], lb["bg"], t)]
    frame = {"pre": pre, "rgb": rgb, "w": w, "view": view, "copies": copies, "look": look}
    if swirl:
        # Peak twist mid-blend, back to none as each ring arrives.
        frame["swirl"] = swirl * np.sin(math.pi * te)
    return frame


def apply_view(frame):
    """Rings rotated into the page's view: world points a camera on +Z sees as the page does.

    View angles are one set for a look, or one per ring during a blend. A blend's swirl then turns
    points about the camera axis, as the page turns its finished picture; its angle falls off with
    the point's distance from the centre as the page measures it on screen (in units of
    0.44 x frame size), so perspective and zoom are included.
    """
    v = frame["view"]
    n = frame["pre"].shape[0]
    per_ring = [np.broadcast_to(np.asarray(v[k], dtype=float), (n,)) for k in ("pitch", "yaw", "rot", "roll")]
    if all(np.all(a == a[0]) for a in per_ring):
        V = np.array(view_matrix(*(float(a[0]) for a in per_ring))).reshape(3, 3)
        P = frame["pre"] @ V.T
    else:
        Vs = np.array([view_matrix(*(float(a[i]) for a in per_ring)) for i in range(n)]).reshape(n, 3, 3)
        P = np.einsum("nmj,nij->nmi", frame["pre"], Vs)
    amp = frame.get("swirl")
    if amp is None:
        return P
    f = persp_f(v["k"], P[..., 2])
    rn = np.hypot(P[..., 0], P[..., 1]) * f * v["zoom"]
    deg = amp[:, None] / (1 + rn * rn)
    c, s = np.cos(deg * D2R), np.sin(deg * D2R)
    out = P.copy()
    out[..., 0] = c * P[..., 0] - s * P[..., 1]
    out[..., 1] = s * P[..., 0] + c * P[..., 1]
    return out


def project(frame, size):
    """The page's screen points (CSS px about the centre), for parity checks only."""
    P = apply_view(frame)
    v = frame["view"]
    S = size * 0.44 * v["zoom"]
    f = persp_f(v["k"], P[..., 2])
    return np.stack([P[..., 0] * f * S, -P[..., 1] * f * S], axis=-1)


# ---------- sequences ----------
EASES = {
    "smooth": lambda t: t * t * t * (t * (t * 6 - 15) + 10),
    "linear": lambda t: t,
    "in": lambda t: t * t * t,
    "out": lambda t: 1 - (1 - t) ** 3,
}


MAX_TURNS = 10
MAX_STAGGER = 0.9   # at 1 each ring would get no time at all to blend, so it would jump
MAX_SWIRL = 720


def clean_card(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("params"), dict):
        return None
    name = raw.get("name")
    card = {"name": name[:40] if isinstance(name, str) and name.strip() else "Look",
            "params": clean_params(raw["params"]), "hold": 3.0, "blend": 3.0, "ease": "smooth",
            "turns": 0, "stagger": 0.0, "swirl": 0.0}
    for key in ("hold", "blend", "turns", "stagger", "swirl"):
        try:
            v = float(raw.get(key))
            if not math.isfinite(v):
                continue
            if key == "turns":
                # Whole turns only, as on the page, so a blend always lands on the next look's roll.
                card[key] = clamp(jsround(v), -MAX_TURNS, MAX_TURNS)
            elif key == "stagger":
                card[key] = clamp(v, -MAX_STAGGER, MAX_STAGGER)
            elif key == "swirl":
                card[key] = clamp(v, -MAX_SWIRL, MAX_SWIRL)
            else:
                card[key] = clamp(v, 0, 60)
        except (TypeError, ValueError):
            pass
    if raw.get("ease") in EASES:
        card["ease"] = raw["ease"]
    card["match"] = raw.get("match") is not False  # on unless the file says false, as on the page
    return card


def load_sequence(text, fallback_name="Ring Loom"):
    """Parse a .ringloom.json sequence or a pasted settings code. Raises ValueError with a reason.

    Returns (name, cards, skipped). Unreadable looks are counted, never dropped silently.
    """
    try:
        obj = json.loads(text)
    except ValueError:
        raise ValueError("The file isn't a Ring Loom sequence: it isn't JSON.")
    if not isinstance(obj, dict):
        raise ValueError("The file isn't a Ring Loom sequence.")
    if isinstance(obj.get("sequence"), list) and obj["sequence"]:
        cards = [c for c in (clean_card(r) for r in obj["sequence"]) if c]
        skipped = len(obj["sequence"]) - len(cards)
        if not cards:
            raise ValueError("None of the %d looks in the file could be read." % len(obj["sequence"]))
    elif isinstance(obj.get("params"), dict):
        cards, skipped = [clean_card({"params": obj["params"], "name": "Look"})], 0
    else:
        raise ValueError("The file has no sequence or look in it.")
    name = obj.get("name") if isinstance(obj.get("name"), str) and obj["name"].strip() else fallback_name
    return name[:60], cards, skipped


def total_length(cards):
    return sum(c["hold"] + c["blend"] for c in cards)


def seq_at(cards, t):
    """Where the sequence is at clock t: same rules as the page's seqAt, or None for a single look."""
    n, total = len(cards), total_length(cards)
    if n < 2 or total <= 0:
        return None
    r = math.fmod(math.fmod(t, total) + total, total)
    for i, c in enumerate(cards):
        if r < c["hold"]:
            return {"i": i, "j": i, "u": 0, "e": 0}
        r -= c["hold"]
        if r < c["blend"]:
            u = r / c["blend"]
            return {"i": i, "j": (i + 1) % n, "u": u, "e": EASES[c["ease"]](u)}
        r -= c["blend"]
    return {"i": n - 1, "j": 0, "u": 0, "e": 0}


def _speed_at(cards, clock):
    at = seq_at(cards, clock)
    if not at:
        return cards[0]["params"]["speed"]
    si = cards[at["i"]]["params"]["speed"]
    return lerp(si, cards[at["j"]]["params"]["speed"], at["e"]) if at["u"] > 0 else si


def anim_time(cards, clock, step=1 / 120):
    """The shared animation clock (the page's tau): Time speed integrated over the sequence.

    The page accumulates this per drawn frame; integrating it here makes any frame computable on
    its own, which Houdini needs. The two agree closely, not bit for bit.
    """
    if clock <= 0:
        return clock * _speed_at(cards, 0)
    n = int(clock / step)
    tau = 0.0
    for i in range(n):
        tau += _speed_at(cards, (i + 0.5) * step) * step
    rem = clock - n * step
    return tau + _speed_at(cards, n * step + rem / 2) * rem


def evaluate(cards, clock, M=None):
    """The frame at clock seconds into the sequence (or a single look), in 3D.

    Returns the frame dict plus a label describing what is on screen.
    """
    at = seq_at(cards, clock)
    if not at:
        p = cards[0]["params"]
        return look3d(p, clock * p["speed"], M), cards[0]["name"]
    tau = anim_time(cards, clock)
    a = cards[at["i"]]
    if at["u"] <= 0:
        return look3d(a["params"], tau, M), a["name"]
    b = cards[at["j"]]
    m = M or max(jsround(a["params"]["res"]), jsround(b["params"]["res"]))
    # The clock when this blend began: its way round (rot_between) and point numbering are chosen then.
    tau0 = anim_time(cards, clock - at["u"] * a["blend"])
    matches = ring_matches(a["params"], b["params"], tau0, m) if a["match"] else None
    return (blend3d(look3d(a["params"], tau, m), look3d(b["params"], tau, m), at["u"],
                    a["turns"], a["stagger"], a["swirl"], a["ease"], tau0, matches,
                    (view_at(a["params"], tau0), view_at(b["params"], tau0))),
            "%s -> %s" % (a["name"], b["name"]))


def world_rings(frame):
    """Final world-space rings for Houdini: view applied, kaleidoscope copies expanded.

    Returns a list of (points (M+1, 3), rgb 0-1, alpha). Copies turn about the camera axis; the
    page rotates the canvas (y down), which is a turn of -angle in y-up world space. A mirrored
    twin (sx -1, or between while turning over) first scales x by sx: screen and world x point the
    same way, so the flip carries over unchanged.
    """
    P = apply_view(frame)
    out = []
    alpha = frame["look"]["alpha"]
    for ang, cw, sx in frame["copies"]:
        c, s = math.cos(-ang), math.sin(-ang)
        R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        Q = P * np.array([sx, 1.0, 1.0]) if sx != 1 else P
        Q = Q @ R.T if ang else Q
        for k in range(len(frame["w"])):
            out.append((Q[k], frame["rgb"][k] / 255.0, clamp(alpha * frame["w"][k] * cw, 0, 1)))
    return out
