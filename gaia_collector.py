import urllib.request
import json
import datetime
import os
import csv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(BASE_DIR, "gaia_archive.csv")      # one row per day (sums)
EVENTS_FILE = os.path.join(BASE_DIR, "gaia_events.csv")    # one row per M5+ quake (for own analyses)


def fetch_json(url):
    print(f"Fetching {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Gaia-Collector/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None


def day_already_archived(date_str):
    if not os.path.isfile(CSV_FILE):
        return False
    with open(CSV_FILE, newline='') as f:
        for row in csv.reader(f):
            if row and row[0] == date_str:
                return True
    return False


def known_event_ids():
    ids = set()
    if os.path.isfile(EVENTS_FILE):
        with open(EVENTS_FILE, newline='') as f:
            for row in csv.reader(f):
                if row:
                    ids.add(row[0])
    return ids


def main():
    # We always analyze "yesterday" to ensure full 24h data is available
    today = datetime.datetime.utcnow().date()
    yesterday = today - datetime.timedelta(days=1)
    date_str = yesterday.strftime("%Y-%m-%d")

    if day_already_archived(date_str):
        print(f"{date_str} already archived, nothing to do.")
        return

    # 1. Fetch Kp Index from GFZ Potsdam (reliable historical API, 8 values of 3 h per day)
    start_time = f"{date_str}T00:00:00Z"
    end_time = f"{date_str}T23:59:59Z"
    kp_url = f"https://kp.gfz.de/app/json/?start={start_time}&end={end_time}&index=Kp"

    kp_data = fetch_json(kp_url)
    kp_list = []
    max_kp = 0.0
    if kp_data and 'Kp' in kp_data and kp_data['Kp']:
        kp_list = kp_data['Kp']
        max_kp = max(kp_list)
    else:
        print("Warning: Could not fetch Kp data, defaulting to 0")

    # 2. Fetch Earthquakes from USGS (M3+ for the daily sums)
    usgs_url = (f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson"
                f"&starttime={start_time}&endtime={end_time}&minmagnitude=3.0")
    eq_data = fetch_json(usgs_url)

    total_m3 = 0
    total_m5 = 0
    total_m6 = 0
    total_deep = 0
    max_mag = 0.0
    events = []

    if eq_data and 'features' in eq_data:
        features = eq_data['features']
        total_m3 = len(features)
        for eq in features:
            props = eq['properties']
            coords = eq['geometry']['coordinates']
            mag = props['mag'] or 0
            depth = coords[2] or 0

            if mag >= 5.0:
                total_m5 += 1
            if mag >= 6.0:
                total_m6 += 1
            if depth >= 150.0:
                total_deep += 1
            if mag > max_mag:
                max_mag = mag

            if mag >= 5.0:
                t = datetime.datetime.utcfromtimestamp(props['time'] / 1000.0)
                # Kp slot of this quake (3-hour blocks), only if the day has all 8 values
                kp_at = ''
                if len(kp_list) == 8:
                    kp_at = kp_list[min(7, t.hour // 3)]
                events.append([
                    eq.get('id', ''),
                    t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    round(coords[1], 3), round(coords[0], 3),
                    round(mag, 1), round(depth, 1),
                    kp_at,
                ])

    # Gaia Charge (re-validated in analyze_gaia_v2.py: effect ~1.0x, not significant -> tiny shrunk tilt)
    charge = 1.0
    if max_kp <= 3.0:
        charge = 0.98 + (max_kp / 3.0) * 0.02
    elif max_kp <= 5.0:
        charge = 1.0
    else:
        charge = 1.0 + min(1.0, (max_kp - 5.0) / 4.0) * 0.10

    # 3. Save daily summary to CSV
    file_exists = os.path.isfile(CSV_FILE)
    with open(CSV_FILE, mode='a', newline='') as file:
        writer = csv.writer(file)
        if not file_exists:
            writer.writerow(["Date", "Max_Kp", "Gaia_Charge_Multiplier", "Total_M3", "Total_M5",
                             "Total_M6", "Total_Deep", "Max_Magnitude"])
        row = [date_str, round(max_kp, 2), round(charge, 3), total_m3, total_m5,
               total_m6, total_deep, round(max_mag, 1)]
        writer.writerow(row)

    # 4. Save every M5+ quake individually (no duplicates)
    ids = known_event_ids()
    new_events = [e for e in events if e[0] not in ids]
    ev_exists = os.path.isfile(EVENTS_FILE)
    with open(EVENTS_FILE, mode='a', newline='') as file:
        writer = csv.writer(file)
        if not ev_exists:
            writer.writerow(["id", "time_utc", "lat", "lon", "mag", "depth_km", "kp_3h_slot"])
        writer.writerows(new_events)

    print(f"[{datetime.datetime.utcnow().isoformat()}] Archived {date_str}: {row} "
          f"+ {len(new_events)} M5+ events")


if __name__ == "__main__":
    main()
