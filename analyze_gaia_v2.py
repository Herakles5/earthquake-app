"""
GAIA v2 - Kp-Index vs. Earthquakes (M6.0+) - statistically clean re-test

Fixes compared to analyze_gaia.py:
  1. SAME Kp window for days AND earthquakes (before: earthquakes used max(today, yesterday),
     days used only today -> high-Kp bins were inflated).
  2. Aftershocks removed (Gardner-Knopoff declustering) -> only independent mainshocks count.
  3. Longer period (2005-2024 instead of 5 years) -> more statistical power.
  4. Lags 0..7 days tested (an effect, if any, would not be instantaneous).
  5. Significance by circular-shift permutation test (keeps Kp autocorrelation / 27-day
     solar rotation / solar cycle) -> tells us whether the 'multiplier' is real or noise.

Run:  python3 analyze_gaia_v2.py
"""
import urllib.request
import json
import datetime
import math
import random

START_YEAR = 2005
END_YEAR = 2024
MIN_MAG = 6.0
N_PERM = 2000


def fetch_json(url):
    print(f"Fetching {url[:90]}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Gaia-Analyzer/2.0'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"Error: {e}")
        return None


def load_kp():
    """daily max Kp {date: kp}"""
    kp = {}
    for y in range(START_YEAR, END_YEAR + 1):
        d = fetch_json(f"https://kp.gfz.de/app/json/?start={y}-01-01T00:00:00Z&end={y}-12-31T23:59:59Z&index=Kp")
        if d and 'datetime' in d and 'Kp' in d:
            for dt, v in zip(d['datetime'], d['Kp']):
                day = dt[:10]
                if day not in kp or v > kp[day]:
                    kp[day] = v
    return kp


def load_quakes():
    ev = []
    for y in range(START_YEAR, END_YEAR + 1):
        d = fetch_json("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                       f"&starttime={y}-01-01&endtime={y + 1}-01-01&minmagnitude={MIN_MAG}&orderby=time-asc")
        if d and 'features' in d:
            for f in d['features']:
                p = f['properties']
                c = f['geometry']['coordinates']
                if p['mag'] is None:
                    continue
                ev.append({'t': p['time'] / 1000.0, 'mag': p['mag'], 'lon': c[0], 'lat': c[1]})
    ev.sort(key=lambda e: e['t'])
    return ev


def hav(la1, lo1, la2, lo2):
    r = 6371.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dphi = p2 - p1
    dl = math.radians(lo2 - lo1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def gk_window(m):
    """Gardner & Knopoff (1974): (days, km)"""
    days = 10 ** (0.032 * m + 2.7) if m >= 6.5 else 10 ** (0.5409 * m - 0.547)
    km = 10 ** (0.1238 * m + 0.983)
    return days, km


def decluster(ev):
    """Remove every event that falls into the window of a larger earlier/later event."""
    n = len(ev)
    removed = [False] * n
    order = sorted(range(n), key=lambda i: -ev[i]['mag'])
    for i in order:
        if removed[i]:
            continue
        days, km = gk_window(ev[i]['mag'])
        for j in range(n):
            if j == i or removed[j] or ev[j]['mag'] >= ev[i]['mag']:
                continue
            if abs(ev[j]['t'] - ev[i]['t']) <= days * 86400 and hav(ev[i]['lat'], ev[i]['lon'], ev[j]['lat'], ev[j]['lon']) <= km:
                removed[j] = True
    return [e for e, r in zip(ev, removed) if not r]


def kp_bin(k):
    return 0 if k <= 3.0 else (1 if k <= 5.0 else 2)


BIN_NAMES = ["Low (<=3)", "Moderate (3-5)", "High (>5)"]


def build_series(kp_daily):
    d0 = datetime.date(START_YEAR, 1, 1)
    d1 = datetime.date(END_YEAR, 12, 31)
    days = []
    d = d0
    while d <= d1:
        days.append(d)
        d += datetime.timedelta(days=1)
    series = [kp_daily.get(x.isoformat(), None) for x in days]
    return days, series


def window_kp(series, idx, lag, width=2):
    """max Kp in [idx-lag-width+1 .. idx-lag] (width days), None if data missing"""
    vals = []
    for k in range(idx - lag - width + 1, idx - lag + 1):
        if 0 <= k < len(series) and series[k] is not None:
            vals.append(series[k])
    return max(vals) if vals else None


def stat_for(series, eq_idx, lag):
    """returns per-bin (days, quakes) and high/low rate ratio"""
    days_bin = [0, 0, 0]
    eq_bin = [0, 0, 0]
    for i in range(len(series)):
        k = window_kp(series, i, lag)
        if k is not None:
            days_bin[kp_bin(k)] += 1
    for i in eq_idx:
        k = window_kp(series, i, lag)
        if k is not None:
            eq_bin[kp_bin(k)] += 1
    return days_bin, eq_bin


def ratio_high_vs_all(days_bin, eq_bin):
    tot_d = sum(days_bin)
    tot_e = sum(eq_bin)
    if tot_d == 0 or tot_e == 0 or days_bin[2] == 0:
        return 0.0
    base = tot_e / tot_d
    return (eq_bin[2] / days_bin[2]) / base


def main():
    kp_daily = load_kp()
    print(f"Kp days: {len(kp_daily)}")
    ev = load_quakes()
    print(f"M{MIN_MAG}+ events (raw): {len(ev)}")
    main_ev = decluster(ev)
    print(f"After declustering (independent mainshocks): {len(main_ev)}")

    days, series = build_series(kp_daily)
    d0 = days[0]
    eq_idx = []
    for e in main_ev:
        dd = datetime.datetime.utcfromtimestamp(e['t']).date()
        eq_idx.append((dd - d0).days)

    print("\n=== Lag scan (same 2-day Kp window for days AND quakes) ===")
    results = {}
    for lag in range(0, 8):
        db, eb = stat_for(series, eq_idx, lag)
        results[lag] = (db, eb)
        tot_d, tot_e = sum(db), sum(eb)
        base = tot_e / tot_d
        line = f"lag {lag}d | base {base * 100:.2f}%/day | "
        for b in range(3):
            if db[b]:
                r = (eb[b] / db[b]) / base
                line += f"{BIN_NAMES[b]}: {db[b]}d/{eb[b]}eq -> {r:.2f}x   "
        print(line)

    # Permutation test on best lag by high-bin ratio (corrected for multiple lags by testing max over lags)
    print(f"\n=== Permutation test ({N_PERM} circular shifts, max over lags 0-7) ===")
    obs = max(ratio_high_vs_all(*results[l]) for l in range(8))
    best_lag = max(range(8), key=lambda l: ratio_high_vs_all(*results[l]))
    print(f"Observed best High-Kp multiplier: {obs:.2f}x at lag {best_lag}d")

    n = len(series)
    ge = 0
    rnd = random.Random(42)
    for _ in range(N_PERM):
        shift = rnd.randint(30, n - 30)
        shifted = series[shift:] + series[:shift]
        m = 0.0
        for lag in range(8):
            db, eb = stat_for(shifted, eq_idx, lag)
            m = max(m, ratio_high_vs_all(db, eb))
        if m >= obs:
            ge += 1
    p = (ge + 1) / (N_PERM + 1)
    print(f"p-value = {p:.3f}  ({'SIGNIFICANT' if p < 0.05 else 'NOT significant -> multiplier is within noise'})")

    # Recommendation for the app
    db, eb = results[best_lag]
    tot_d, tot_e = sum(db), sum(eb)
    base = tot_e / tot_d
    print("\n=== Suggested multipliers (shrunk towards 1.0 by Bayesian-style weighting) ===")
    for b in range(3):
        if db[b]:
            raw = (eb[b] / db[b]) / base
            # shrinkage: weight = events / (events + 30)
            w = eb[b] / (eb[b] + 30.0)
            print(f"{BIN_NAMES[b]}: raw {raw:.2f}x  ->  shrunk {1 + (raw - 1) * w:.2f}x  (n={eb[b]})")


if __name__ == "__main__":
    main()
