"""
HOTSPOT MODEL - backtest & tuning (Python reference implementation of the model in hotspots.js)

Question we answer with REAL data: does each ingredient (long-term rate, plate boundaries,
recurrence 'routine', Omori/aftershock trigger) really improve the prediction of WHERE the next
M5+ happens? Walk-forward test: at each time T only data < T is used, then we look at what
happened in [T, T+7d).

Run:  python3 hotspot_backtest.py
"""
import urllib.request
import json
import math
import datetime
import os
import re
import sys
import statistics

CACHE = "hotspot_catalog_cache.json"
START = 2012
END = 2025
CELL = 4.0           # grid size in degrees
R_EARTH = 6371.0


# ---------------------------------------------------------------- data
def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Gaia-Backtest/1.0'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


def load_catalog():
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            return json.load(f)
    ev = []
    for y in range(START, END + 1):
        for q in range(4):
            a = datetime.date(y, 1 + q * 3, 1)
            b = datetime.date(y + (1 if q == 3 else 0), 1 if q == 3 else 4 + q * 3, 1)
            url = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                   f"&starttime={a}&endtime={b}&minmagnitude=4.5&orderby=time-asc&limit=20000")
            try:
                d = fetch(url)
            except Exception as e:
                print("ERR", url, e)
                continue
            for f_ in d['features']:
                p = f_['properties']
                c = f_['geometry']['coordinates']
                if p['mag'] is None:
                    continue
                ev.append([p['time'] / 1000.0, p['mag'], c[1], c[0]])
            print(f"{a} -> {b}: total {len(ev)}")
    ev.sort()
    with open(CACHE, 'w') as f:
        json.dump(ev, f)
    return ev


def load_plates():
    """plates.js -> list of (lon1, lat1, lon2, lat2)"""
    txt = open("plates.js").read()
    nums = re.findall(r'\[\s*(-?\d+\.?\d*(?:e-?\d+)?)\s*,\s*(-?\d+\.?\d*(?:e-?\d+)?)\s*,\s*(-?\d+\.?\d*(?:e-?\d+)?)\s*,\s*(-?\d+\.?\d*(?:e-?\d+)?)\s*\]', txt)
    return [tuple(map(float, n)) for n in nums]


# ---------------------------------------------------------------- geometry
def hav(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(a)))


def gk_window(m):
    days = 10 ** (0.032 * m + 2.7) if m >= 6.5 else 10 ** (0.5409 * m - 0.547)
    km = 10 ** (0.1238 * m + 0.983)
    return days * 86400.0, km


def causal_decluster(ev):
    """flag 'is_main'. An event is an aftershock if an EARLIER, larger event's G-K window covers it."""
    main = [True] * len(ev)
    active = []   # (t_end, km, lat, lon, mag)
    for i, (t, m, la, lo) in enumerate(ev):
        active = [a for a in active if a[0] > t]
        for (te, km, ala, alo, am) in active:
            if am >= m and hav(la, lo, ala, alo) <= km:
                main[i] = False
                break
        w, km = gk_window(m)
        active.append((t + w, km, la, lo, m))
    return main


# ---------------------------------------------------------------- grid
LATS = [-78 + CELL * i for i in range(int(156 / CELL) + 1)]
LONS = [-180 + CELL / 2 + CELL * j for j in range(int(360 / CELL))]
CELLS = [(la, lo) for la in LATS for lo in LONS]


def cell_index(lat, lon):
    i = int(round((lat + 78) / CELL))
    j = int((lon + 180) // CELL)
    return max(0, min(len(LATS) - 1, i)), max(0, min(len(LONS) - 1, j % len(LONS)))


def plate_prior(plates):
    """per cell: exp(-d/150km) where d = distance to the nearest plate-boundary segment midpoint"""
    mids = [((l[1] + l[3]) / 2, (l[0] + l[2]) / 2) for l in plates]
    # thin out for speed
    mids = mids[::2]
    prior = []
    for (la, lo) in CELLS:
        best = 1e9
        for (ma, mo) in mids:
            if abs(ma - la) > 12:
                continue
            d = hav(la, lo, ma, mo)
            if d < best:
                best = d
        prior.append(math.exp(-best / 150.0))
    return prior


KERNEL_SIGMA = 250.0   # km
_BASE = {}


_FOOT = {}


def footprint(lat, lon, sigma):
    key = (round(lat, 2), round(lon, 2), round(sigma))
    f = _FOOT.get(key)
    if f is not None:
        return f
    ci, cj = cell_index(lat, lon)
    reach = int(math.ceil(3 * sigma / (CELL * 111.0))) + 1
    f = []
    for di in range(-reach, reach + 1):
        i = ci + di
        if i < 0 or i >= len(LATS):
            continue
        for dj in range(-reach * 2, reach * 2 + 1):
            j = (cj + dj) % len(LONS)
            d = hav(lat, lon, LATS[i], LONS[j])
            if d < 3 * sigma:
                f.append((i * len(LONS) + j, math.exp(-0.5 * (d / sigma) ** 2)))
    if len(_FOOT) > 400000:
        _FOOT.clear()
    _FOOT[key] = f
    return f


def kernel_add(field, lat, lon, w, sigma=KERNEL_SIGMA):
    for idx, k in footprint(lat, lon, sigma):
        field[idx] += w * k


_NEIGH = {}


def neighbours(ci, radius=350.0):
    n = _NEIGH.get(ci)
    if n is None:
        la, lo = CELLS[ci]
        i0, j0 = divmod(ci, len(LONS))
        n = []
        for di in range(-3, 4):
            for dj in range(-6, 7):
                ii, jj = i0 + di, (j0 + dj) % len(LONS)
                if 0 <= ii < len(LATS) and hav(la, lo, LATS[ii], LONS[jj]) < radius:
                    n.append((ii, jj))
        _NEIGH[ci] = n
    return n


def normalize(field):
    s = sum(field)
    return [v / s for v in field] if s > 0 else field


# ---------------------------------------------------------------- the model
def forecast(ev, main, idx_hi, T, plates_prior, opts):
    """ev: sorted catalog, idx_hi = number of events with t < T. returns normalised field"""
    day = 86400.0
    n = len(CELLS)
    # --- long-term rate: independent M5+ mainshocks of the last `win` days (shared between variants)
    win = opts.get('win', 365)
    sigma = opts.get('sigma', KERNEL_SIGMA)
    bkey = (idx_hi, win, sigma)
    if _BASE.get('key') != bkey:
        long_f = [0.0] * n
        short_f = [0.0] * n
        lo_i = idx_hi
        while lo_i > 0 and ev[lo_i - 1][0] > T - win * day:
            lo_i -= 1
        m5_main = []
        for i in range(lo_i, idx_hi):
            t, m, la, lo = ev[i]
            if m >= 5.0 and main[i]:
                kernel_add(long_f, la, lo, 1.0, sigma)
                m5_main.append(i)
            if t > T - 30 * day and main[i]:
                kernel_add(short_f, la, lo, 1.0, sigma)
        _BASE.update(key=bkey, long=long_f, short=short_f, m5=m5_main)
    long_f, short_f, m5_main = _BASE['long'], _BASE['short'], _BASE['m5']
    rs = opts.get('recent_share', 0.4)
    rate = [(1 - rs) * a + rs * b for a, b in zip(normalize(long_f), normalize(short_f))]
    if opts.get('static_only'):
        rate = normalize(long_f)
    if opts.get('recent_only'):
        rate = normalize(short_f)


    field = rate[:]
    # --- plate prior (fills gaps where the last year had no events)
    if opts.get('plates'):
        pp = normalize(plates_prior)
        field = [0.8 * f + 0.2 * p for f, p in zip(field, pp)]

    # --- recurrence ('routine'): cells whose local rhythm says 'due'
    if opts.get('recur'):
        by_cell = {}
        for i in m5_main:
            by_cell.setdefault(cell_index(ev[i][2], ev[i][3]), []).append(ev[i][0])
        for ci in range(n):
            if field[ci] < 1e-6:
                continue
            times = []
            for key in neighbours(ci):
                if key in by_cell:
                    times += by_cell[key]
            if len(times) >= 4:
                times.sort()
                gaps = [b - a for a, b in zip(times, times[1:])]
                med = statistics.median(gaps)
                if med > 0:
                    r = (T - times[-1]) / med
                    due = math.exp(-((r - 1.1) / 0.6) ** 2)
                    field[ci] *= 1.0 + opts.get('recur_w', 0.6) * due * min(1.0, len(times) / 8.0)

    # --- Markov transitions: 'after a quake HERE, the next M5+ mainshock was usually THERE'
    if opts.get('markov'):
        mwin = opts.get('mwin', 1095)
        lo = idx_hi
        while lo > 0 and ev[lo - 1][0] > T - mwin * day:
            lo -= 1
        seq = [i for i in range(lo, idx_hi) if ev[i][1] >= 5.0 and main[i]]
        if len(seq) >= 5:
            by_src = {}
            for a, b in zip(seq, seq[1:]):
                src = cell_index(ev[a][2], ev[a][3])
                by_src.setdefault(src, []).append(cell_index(ev[b][2], ev[b][3]))
            tr = [0.0] * n
            nlast = opts.get('mlast', 3)
            tau = opts.get('mtau', 10.0)
            for i in seq[-nlast:]:
                age = (T - ev[i][0]) / day
                wgt = math.exp(-age / tau)
                if wgt < 0.02:
                    continue
                counts = {}
                for key in neighbours(cell_index(ev[i][2], ev[i][3]) [0] * len(LONS) + cell_index(ev[i][2], ev[i][3])[1]):
                    for tgt in by_src.get(key, []):
                        counts[tgt] = counts.get(tgt, 0) + 1
                tot = sum(counts.values())
                if tot < 3:
                    continue
                for (ti, tj), c in counts.items():
                    kernel_add(tr, LATS[ti], LONS[tj], wgt * c / tot, opts.get('msigma', 200.0))
            s = sum(tr)
            if s > 0:
                mw = opts.get('markov_w', 0.3)
                tr = [v / s for v in tr]
                tot = sum(field)
                field = [(1 - mw) * f + mw * v * tot for f, v in zip(field, tr)]

    # --- Omori / aftershock triggering
    if opts.get('omori'):
        trig = [0.0] * n
        i = idx_hi - 1
        while i >= 0 and ev[i][0] > T - 14 * day:
            t, m, la, lo = ev[i]
            if m >= 5.5:
                td = (T - t) / day
                w = 10 ** (0.8 * (m - 5.5)) / (td + 0.05)
                _, km = gk_window(m)
                kernel_add(trig, la, lo, w, sigma=max(60.0, km / 2))
            i -= 1
        s = sum(trig)
        if s > 0:
            tw = opts.get('omori_w', 1.0)
            trig = [v / s for v in trig]
            tot = sum(field)
            field = [f + tw * v * tot * 0.5 for f, v in zip(field, trig)]
    return normalize(field)


def top_k(field, k, sep=800.0):
    order = sorted(range(len(field)), key=lambda i: -field[i])
    out = []
    for i in order:
        la, lo = CELLS[i]
        if all(hav(la, lo, CELLS[j][0], CELLS[j][1]) > sep for j in out):
            out.append(i)
            if len(out) >= k:
                break
    return out


# ---------------------------------------------------------------- backtest
def run():
    ev = load_catalog()
    print("catalog:", len(ev))
    mcache = CACHE + ".main"
    if os.path.exists(mcache):
        main = json.load(open(mcache))
    else:
        main = causal_decluster(ev)
        json.dump(main, open(mcache, 'w'))
    print("mainshocks:", sum(main))
    plates = load_plates()
    print("plate segments:", len(plates))
    prior = plate_prior(plates)

    if os.environ.get('VARIANTS') == 'markov':
        variants = {
            'BASE static 3y s250':             dict(static_only=True, win=1095, sigma=250),
            'S6 3y + 10% recent':              dict(win=1095, recent_share=0.1),
            'M1 S6 + markov w0.2':             dict(win=1095, recent_share=0.1, markov=True, markov_w=0.2),
            'M2 S6 + markov w0.4':             dict(win=1095, recent_share=0.1, markov=True, markov_w=0.4),
            'M3 S6 + markov w0.4 last1':       dict(win=1095, recent_share=0.1, markov=True, markov_w=0.4, mlast=1),
            'M4 S6 + markov w0.4 6y hist':     dict(win=1095, recent_share=0.1, markov=True, markov_w=0.4, mwin=2190),
        }
    elif os.environ.get('VARIANTS') == 'tune':
        variants = {
            'S1 static 1y  s250':              dict(static_only=True, win=365, sigma=250),
            'S2 static 3y  s250':              dict(static_only=True, win=1095, sigma=250),
            'S3 static 6y  s250':              dict(static_only=True, win=2190, sigma=250),
            'S4 static 3y  s150':              dict(static_only=True, win=1095, sigma=150),
            'S5 static 3y  s400':              dict(static_only=True, win=1095, sigma=400),
            'S6 3y + 10% recent':              dict(win=1095, recent_share=0.1),
            'S7 3y + 25% recent':              dict(win=1095, recent_share=0.25),
            'S8 3y + 10% rec + Omori w0.15':   dict(win=1095, recent_share=0.1, omori=True, omori_w=0.15),
            'S9 3y + 10% rec + plates':        dict(win=1095, recent_share=0.1, plates=True),
        }
    else:
        variants = {
            'A static (1y M5 rate)':          dict(static_only=True),
            'B recent (30d only)':            dict(recent_only=True),
            'C blend (1y+30d)':               dict(),
            'D C + plates':                   dict(plates=True),
            'E D + recurrence':               dict(plates=True, recur=True),
            'F E + Omori trigger':            dict(plates=True, recur=True, omori=True),
            'G C + Omori (no plates/recur)':  dict(omori=True),
        }
    res = {k: {'hit': 0, 'n': 0, 'hit_main': 0, 'n_main': 0} for k in variants}

    day = 86400.0
    t0 = datetime.datetime(int(os.environ.get('T0', START + 2)), 1, 1).timestamp()
    t1 = datetime.datetime(END, 12, 1).timestamp()
    step = 7 * day
    K = int(os.environ.get('K', 5))
    RAD = float(os.environ.get('RAD', 300))
    T = t0
    steps = 0
    idx_hi = 0
    while T < t1:
        while idx_hi < len(ev) and ev[idx_hi][0] < T:
            idx_hi += 1
        targets = [i for i in range(idx_hi, len(ev)) if ev[i][0] < T + 7 * day and ev[i][1] >= 5.0]
        if targets:
            for name, opts in variants.items():
                fld = forecast(ev, main, idx_hi, T, prior, opts)
                tops = top_k(fld, K)
                for i in targets:
                    t, m, la, lo = ev[i]
                    hit = any(hav(la, lo, CELLS[c][0], CELLS[c][1]) <= RAD for c in tops)
                    res[name]['n'] += 1
                    res[name]['hit'] += hit
                    if main[i]:
                        res[name]['n_main'] += 1
                        res[name]['hit_main'] += hit
        T += step
        steps += 1
        if steps % 40 == 0:
            print("..", datetime.datetime.fromtimestamp(T).date(), file=sys.stderr)

    area = K * math.pi * RAD ** 2 / (4 * math.pi * R_EARTH ** 2)
    print(f"\nK={K} hotspots, radius {RAD:.0f} km, 7-day horizon | random-pick expectation ~{area * 100:.2f}% of the globe")
    print(f"{'variant':34s} {'M5+ all':>14s} {'M5+ mainshocks':>18s}")
    for name, r in res.items():
        a = 100 * r['hit'] / max(1, r['n'])
        b = 100 * r['hit_main'] / max(1, r['n_main'])
        print(f"{name:34s} {a:6.1f}% ({r['hit']:>4}/{r['n']:<5}) {b:6.1f}% ({r['hit_main']:>4}/{r['n_main']:<5})")


if __name__ == "__main__":
    run()
