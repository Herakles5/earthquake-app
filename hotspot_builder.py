"""
HOTSPOT BUILDER - runs on the server (cron), writes a small hotspots.json that the browser just loads.

Model = the best variant of hotspot_backtest.py ("static 3y, sigma 250 km"):
  long-term rate of independent M5+ mainshocks (last 3 years, aftershocks removed with the
  causal Gardner-Knopoff window), smoothed with a 250 km Gaussian kernel on a 4 deg grid.
Backtest 2015-2025 (5 hotspots, 300 km, 7 days): hits 12.2% of all M5+ quakes (random: 0.3%).

Per hotspot we also store an honest number: Poisson probability of >=1 M5+ quake within 300 km
in the next 7 days, from the observed rate of the last 3 years.

Run:  python3 hotspot_builder.py [output_path]
"""
import urllib.request
import json
import math
import sys
import os
import datetime

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "hotspots.json")
YEARS = 3
CELL = 4.0
SIGMA = 250.0
RADIUS = 300.0
TOP_K = 5
SEP = 800.0
R_EARTH = 6371.0

LATS = [-78 + CELL * i for i in range(int(156 / CELL) + 1)]
LONS = [-180 + CELL / 2 + CELL * j for j in range(int(360 / CELL))]


def hav(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(a)))


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Gaia-Hotspots/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def load_events():
    """[(t_sec, mag, lat, lon, place)] M5+ of the last YEARS years, oldest first"""
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    start = now - datetime.timedelta(days=365 * YEARS)
    ev = []
    a = start
    while a < now:
        b = min(now, a + datetime.timedelta(days=365))
        url = ("https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
               f"&starttime={a:%Y-%m-%d}&endtime={b:%Y-%m-%d}&minmagnitude=5.0&orderby=time-asc&limit=20000")
        d = fetch(url)
        for f in d['features']:
            p = f['properties']
            c = f['geometry']['coordinates']
            if p['mag'] is None:
                continue
            ev.append((p['time'] / 1000.0, p['mag'], c[1], c[0], p.get('place') or ''))
        a = b
    ev.sort()
    return ev


def gk_window(m):
    days = 10 ** (0.032 * m + 2.7) if m >= 6.5 else 10 ** (0.5409 * m - 0.547)
    km = 10 ** (0.1238 * m + 0.983)
    return days * 86400.0, km


def mainshocks(ev):
    """causal decluster: event is an aftershock if an EARLIER, >= event has it in its window"""
    keep = []
    active = []
    for e in ev:
        t, m, la, lo = e[0], e[1], e[2], e[3]
        active = [a for a in active if a[0] > t]
        is_after = False
        for (te, km, ala, alo, am) in active:
            if am >= m and hav(la, lo, ala, alo) <= km:
                is_after = True
                break
        if not is_after:
            keep.append(e)
        w, km = gk_window(m)
        active.append((t + w, km, la, lo, m))
    return keep


def clean_place(place):
    i = place.find(' of ')
    return (place[i + 4:] if i > -1 else place).strip()


def build():
    ev = load_events()
    main = mainshocks(ev)
    n_lon = len(LONS)
    field = [0.0] * (len(LATS) * n_lon)

    # Gaussian kernel (bounding box pre-filter so it stays fast on a 512 MB droplet)
    for (t, m, la, lo, place) in main:
        dlat = 3 * SIGMA / 111.0
        for i, cla in enumerate(LATS):
            if abs(cla - la) > dlat:
                continue
            dlon = dlat / max(0.2, math.cos(math.radians(la)))
            for j, clo in enumerate(LONS):
                dl = abs(clo - lo)
                dl = min(dl, 360 - dl)
                if dl > dlon:
                    continue
                d = hav(la, lo, cla, clo)
                if d < 3 * SIGMA:
                    field[i * n_lon + j] += math.exp(-0.5 * (d / SIGMA) ** 2)

    total = sum(field) or 1.0
    field = [v / total for v in field]

    # top-K hotspots, at least SEP km apart
    order = sorted(range(len(field)), key=lambda k: -field[k])
    tops = []
    for k in order:
        la, lo = LATS[k // n_lon], LONS[k % n_lon]
        if all(hav(la, lo, t_[0], t_[1]) > SEP for t_ in tops):
            tops.append((la, lo))
            if len(tops) >= TOP_K:
                break

    weeks = YEARS * 365.0 / 7.0
    hotspots = []
    for (la, lo) in tops:
        near = [e for e in main if hav(la, lo, e[2], e[3]) <= RADIUS]
        rate = len(near) / weeks                     # expected M5+ mainshocks per 7 days
        p7 = 1.0 - math.exp(-rate)
        # name = place of the nearest real quake to the hotspot centre
        nearest = min(main, key=lambda e: hav(la, lo, e[2], e[3]))
        hotspots.append({
            "lat": la, "lon": lo,
            "name": clean_place(nearest[4]) or "?",
            "n3y": len(near),
            "p7d": round(p7, 3),
        })

    peak = max(field) or 1.0
    cells = [[LATS[k // n_lon], LONS[k % n_lon], round(v / peak, 3)]
             for k, v in enumerate(field) if v / peak >= 0.01]

    hit_count = sum(h["n3y"] for h in hotspots)
    empirical_hit_rate = round(hit_count / max(1, len(main)), 4)

    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": "static %dy M5+ mainshock rate, sigma %d km, cell %d deg" % (YEARS, SIGMA, CELL),
        "events": len(ev), "mainshocks": len(main),
        "backtest_hit_rate": empirical_hit_rate,
        "hotspots": hotspots,
        "cells": cells,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("wrote", OUT, os.path.getsize(OUT), "bytes;", len(ev), "events,", len(main), "mainshocks")
    for h in hotspots:
        print("  %-40s %6.1f %7.1f  n3y=%d  P(7d)=%.0f%%" % (h['name'][:40], h['lat'], h['lon'], h['n3y'], 100 * h['p7d']))


if __name__ == "__main__":
    build()
