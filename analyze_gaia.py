import urllib.request
import json
import datetime
from collections import defaultdict

def fetch_json(url):
    print(f"Fetching {url[:60]}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def analyze():
    print("GAIA SCHUMANN RESONANCE (Kp-Index) vs EARTHQUAKES (M6.0+) CORRELATION")
    
    # 1. Fetch 5 years of Kp Data (2019 - 2024)
    # Using 1-year chunks to avoid timeout
    kp_data = {}
    for year in range(2019, 2024):
        start = f"{year}-01-01T00:00:00Z"
        end = f"{year}-12-31T23:59:59Z"
        url = f"https://kp.gfz.de/app/json/?start={start}&end={end}&index=Kp"
        data = fetch_json(url)
        if data and 'datetime' in data and 'Kp' in data:
            for dt, kp in zip(data['datetime'], data['Kp']):
                # Store max daily Kp
                date_str = dt[:10]
                if date_str not in kp_data or kp > kp_data[date_str]:
                    kp_data[date_str] = kp
    
    print(f"Loaded Kp data for {len(kp_data)} days.")
    
    # 2. Fetch M6.0+ Earthquakes for the same period
    eq_url = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2019-01-01&endtime=2023-12-31&minmagnitude=6.0"
    eq_data = fetch_json(eq_url)
    
    if not eq_data or 'features' not in eq_data:
        print("Failed to load earthquake data.")
        return
        
    features = eq_data['features']
    print(f"Loaded {len(features)} M6.0+ earthquakes.")
    
    # 3. Correlate
    # We want to see: What is the probability of a M6.0+ earthquake on a day with Kp <= 3 vs Kp > 3 vs Kp > 5?
    days_by_kp = {"Low (0-3)": 0, "Moderate (3-5)": 0, "High (>5)": 0}
    eqs_by_kp = {"Low (0-3)": 0, "Moderate (3-5)": 0, "High (>5)": 0}
    
    for date_str, max_kp in kp_data.items():
        if max_kp <= 3.0:
            days_by_kp["Low (0-3)"] += 1
        elif max_kp <= 5.0:
            days_by_kp["Moderate (3-5)"] += 1
        else:
            days_by_kp["High (>5)"] += 1
            
    for eq in features:
        ts = eq['properties']['time'] / 1000.0
        dt = datetime.datetime.utcfromtimestamp(ts)
        date_str = dt.strftime("%Y-%m-%d")
        
        # Look for Kp on the day of the earthquake, or the day before (energy buildup)
        kp_today = kp_data.get(date_str, 0)
        dt_prev = dt - datetime.timedelta(days=1)
        kp_prev = kp_data.get(dt_prev.strftime("%Y-%m-%d"), 0)
        
        max_kp_related = max(kp_today, kp_prev)
        
        if max_kp_related <= 3.0:
            eqs_by_kp["Low (0-3)"] += 1
        elif max_kp_related <= 5.0:
            eqs_by_kp["Moderate (3-5)"] += 1
        else:
            eqs_by_kp["High (>5)"] += 1

    print("\n--- RESULTS ---")
    base_rate = len(features) / len(kp_data) if kp_data else 0
    print(f"Baseline probability of M6.0+ on any random day: {base_rate*100:.2f}%")
    
    for cat in ["Low (0-3)", "Moderate (3-5)", "High (>5)"]:
        days = days_by_kp[cat]
        eqs = eqs_by_kp[cat]
        if days > 0:
            prob = eqs / days
            multiplier = prob / base_rate if base_rate > 0 else 0
            print(f"[{cat}] Days: {days}, Earthquakes: {eqs}")
            print(f"   -> Probability: {prob*100:.2f}% (Multiplier: {multiplier:.2f}x)")

if __name__ == "__main__":
    analyze()
