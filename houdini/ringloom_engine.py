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
COVER_PSI = [-59.32, 10.84, 14.94, 14.2, 12.84, 11.25, 9.51, 7.81, 6.07, 4.35, 2.66, 1.04, -0.56, -2.17, -3.65, -5.19, -6.62, -8.05, -9.52, -10.88, -12.25, -13.49, -14.73, -15.89, -17.01, -18.03, -19.1, -19.94, -20.64, -21.37, -21.92]
COVER_MEAN_A = sum(COVER_A) / len(COVER_A)
COVER_SCALE = 1.05

PALETTES = {
    "ice": ["#8fb8ff", "#dce9ff", "#ffffff"],
    "spectrum": None,
    "dusk": ["#ff2e88", "#ff8a3d", "#ffe36b"],
    "acid": ["#c4ff3d", "#35ffd2", "#3d7bff"],
    "ember": ["#ff2a00", "#ffae00", "#fff0c2"],
    "ultra": ["#6b00ff", "#ff00d4", "#00e0ff"],
    "custom": None,
}
GENS = ["cover", "sphere", "again", "blend", "harmono", "slinky"]
BASES = ["circle", "polygon", "star", "flower", "heart", "infinity"]

# (id, type, default, min, max) for numbers; (id, type, default, options) for menus. Order and
# values must match the page's SCHEMA -- test_parity.py compares them.
SCHEMA = [
    ("gen", "select", "cover", GENS),
    ("base", "select", "circle", BASES),
    ("sides", "range", 5, 3, 16),
    ("depth", "range", 0.45, 0, 0.9),
    ("superexp", "range", 2, 0.4, 5),
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
    ("tilt", "range", 75, 0, 90),
    ("speed", "range", 1, 0, 3),
    ("drift", "range", 0.3, 0, 2),
    ("rotate", "range", 0, -180, 180),
    ("spin", "range", 0, -60, 60),
    ("yaw", "range", 0, -180, 180),
    ("pitch", "range", 0, -89, 89),
    ("persp", "range", 0, 0, 1),
    ("zoom", "range", 0.95, 0.3, 2.5),
    ("palette", "select", "ice", list(PALETTES)),
    ("colorA", "color", "#ff2e88"),
    ("colorB", "color", "#35ffd2"),
    ("spread", "range", 1, 0, 3),
    ("cycle", "range", 0, -120, 120),
    ("width", "range", 1.1, 0.25, 5),
    ("alphaL", "range", 0.85, 0.05, 1),
    ("glow", "range", 4, 0, 40),
    ("trails", "range", 0, 0, 0.97),
    ("mirror", "range", 1, 1, 12),
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


def make_color_fn(p, time):
    shift = time * p["cycle"] / 360
    if p["palette"] == "spectrum":
        return lambda u: hsl_to_rgb((u * p["spread"] + shift) * 300, 0.95, 0.62)
    stops = [hex_to_rgb(h) for h in ([p["colorA"], p["colorB"]] if p["palette"] == "custom" else PALETTES[p["palette"]])]

    def fn(u):
        x = u * p["spread"] + shift
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


def view_matrix(pitch, yaw, rot):
    return mat3(mat3(rx3(pitch), ry3(yaw)), rz3(rot))


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
        turn = p["turn"] + p["drift"] * 3 * math.sin(time * 0.7)
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
            l = u ** p["ease"]
            mats.append(tuple(lerp(M0[i], M1[i], l) for i in range(4)))
    return mats


def js_mod_pos(th, seg):
    # The page writes ((th % seg) + seg) % seg; keep the double remainder for identical rounding.
    return np.fmod(np.fmod(th, seg) + seg, seg)


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
    if e == 1:
        return c, s
    return np.sign(c) * np.abs(c) ** e, np.sign(s) * np.abs(s) ** e


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
        R = rot_axis([math.sin(a), 0, math.cos(a)], (-p["sweep"] * u - p["drift"] * 18 * time) * D2R)
        x, y, z = R[0] * px + R[1] * py, R[3] * px + R[4] * py, R[6] * px + R[7] * py
    elif g == "harmono":
        A = 1 - p["decay"] * u
        hpx = TAU * p["phaseStep"] * k + p["drift"] * time * 0.6
        x = A * np.sin(p["fx"] * th + hpx) * rr
        y = A * np.sin(p["fy"] * th + math.pi / 2) * rr
        z = np.zeros_like(x)
    else:  # slinky
        ph = TAU * p["loops"] * u + p["drift"] * time * 0.4
        tl = p["tilt"] * D2R
        cc, ss = math.cos(ph), math.sin(ph)
        e1 = (cc, ss, 0)
        e2 = (-ss * math.cos(tl), cc * math.cos(tl), math.sin(tl))
        r = p["ringR"]
        x = p["orbitR"] * cc + r * (px * e1[0] + py * e2[0])
        y = p["orbitR"] * ss + r * (px * e1[1] + py * e2[1])
        z = r * (px * e1[2] + py * e2[2])
    return np.stack([x, y, z], axis=1)


def look3d(p, time, M=None):
    """A look at one moment: rings before the view rotation, plus view and drawing settings."""
    N = jsround(p["rings"])
    M = M or jsround(p["res"])
    mats = linear_mats(p, N, time) if p["gen"] in ("cover", "again", "blend") else None
    color = make_color_fn(p, time)
    pre = np.stack([ring_world(p, k, N, M, time, mats) for k in range(N)])
    rgb = np.array([color(k / (N - 1) if N > 1 else 0) for k in range(N)], dtype=np.float64)
    m = jsround(p["mirror"])
    return {
        "pre": pre, "rgb": rgb, "w": np.ones(N),
        "view": {"pitch": p["pitch"], "yaw": p["yaw"], "rot": p["rotate"] + p["spin"] * time,
                 "D": 2.4 + (1 - p["persp"]) * 40, "zoom": p["zoom"]},
        "copies": [(i / m * TAU, 1.0) for i in range(m)],
        "look": {"width": p["width"], "alpha": p["alphaL"], "glow": p["glow"], "trails": p["trails"],
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


def blend3d(A, B, t):
    n, ia, ib, wa, wb = pair_up(len(A["w"]), len(B["w"]))
    pa, pb = A["pre"][ia], B["pre"][ib]
    pre = pa + (pb - pa) * t
    rgb = A["rgb"][ia] + (B["rgb"][ib] - A["rgb"][ia]) * t
    w = np.array([lerp(A["w"][ia[i]] * wa[i], B["w"][ib[i]] * wb[i], t) for i in range(n)])
    cn, cia, cib, cwa, cwb = pair_up(len(A["copies"]), len(B["copies"]))
    copies = [(lerp(A["copies"][cia[i]][0], B["copies"][cib[i]][0], t),
               lerp(A["copies"][cia[i]][1] * cwa[i], B["copies"][cib[i]][1] * cwb[i], t)) for i in range(cn)]
    va, vb = A["view"], B["view"]
    view = {"pitch": lerp(va["pitch"], vb["pitch"], t), "yaw": _shortest(va["yaw"], vb["yaw"], t),
            "rot": _shortest(va["rot"], vb["rot"], t), "D": lerp(va["D"], vb["D"], t), "zoom": lerp(va["zoom"], vb["zoom"], t)}
    la, lb = A["look"], B["look"]
    look = {k: lerp(la[k], lb[k], t) for k in ("width", "alpha", "glow", "trails")}
    look["additive"] = la["additive"] if t < 0.5 else lb["additive"]
    look["bg"] = [lerp(la["bg"][c], lb["bg"][c], t) for c in range(3)]
    return {"pre": pre, "rgb": rgb, "w": w, "view": view, "copies": copies, "look": look}


def apply_view(frame):
    """Rings rotated into the page's view: world points a camera on +Z sees as the page does."""
    v = frame["view"]
    V = np.array(view_matrix(v["pitch"], v["yaw"], v["rot"])).reshape(3, 3)
    return frame["pre"] @ V.T


def project(frame, size):
    """The page's screen points (CSS px about the centre), for parity checks only."""
    P = apply_view(frame)
    v = frame["view"]
    S = size * 0.44 * v["zoom"]
    f = v["D"] / np.maximum(0.25, v["D"] - P[..., 2])
    return np.stack([P[..., 0] * f * S, -P[..., 1] * f * S], axis=-1)


# ---------- sequences ----------
EASES = {
    "smooth": lambda t: t * t * t * (t * (t * 6 - 15) + 10),
    "linear": lambda t: t,
    "in": lambda t: t * t * t,
    "out": lambda t: 1 - (1 - t) ** 3,
}


def clean_card(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("params"), dict):
        return None
    name = raw.get("name")
    card = {"name": name[:40] if isinstance(name, str) and name.strip() else "Look",
            "params": clean_params(raw["params"]), "hold": 3.0, "blend": 3.0, "ease": "smooth"}
    for key in ("hold", "blend"):
        try:
            v = float(raw.get(key))
            if math.isfinite(v):
                card[key] = clamp(v, 0, 60)
        except (TypeError, ValueError):
            pass
    if raw.get("ease") in EASES:
        card["ease"] = raw["ease"]
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
    return blend3d(look3d(a["params"], tau, m), look3d(b["params"], tau, m), at["e"]), "%s -> %s" % (a["name"], b["name"])


def world_rings(frame):
    """Final world-space rings for Houdini: view applied, kaleidoscope copies expanded.

    Returns a list of (points (M+1, 3), rgb 0-1, alpha). Copies turn about the camera axis; the
    page rotates the canvas (y down), which is a turn of -angle in y-up world space.
    """
    P = apply_view(frame)
    out = []
    alpha = frame["look"]["alpha"]
    for ang, cw in frame["copies"]:
        c, s = math.cos(-ang), math.sin(-ang)
        R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        Q = P @ R.T if ang else P
        for k in range(len(frame["w"])):
            out.append((Q[k], frame["rgb"][k] / 255.0, clamp(alpha * frame["w"][k] * cw, 0, 1)))
    return out
