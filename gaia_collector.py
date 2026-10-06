import urllib.request
import json
import datetime
import os
import csv
import time

CSV_FILE = "gaia_archive.csv"

def fetch_json(url):
    print(f"Fetching {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Gaia-Collector/1.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def main():
    # We always analyze "yesterday" to ensure full 24h data is available
    today = datetime.datetime.utcnow().date()
    yesterday = today - datetime.timedelta(days=1)
    date_str = yesterday.strftime("%Y-%m-%d")
    
    # 1. Fetch Kp Index from GFZ Potsdam (reliable historical API)
    start_time = f"{date_str}T00:00:00Z"
    end_time = f"{date_str}T23:59:59Z"
    kp_url = f"https://kp.gfz.de/app/json/?start={start_time}&end={end_time}&index=Kp"
    
    kp_data = fetch_json(kp_url)
    max_kp = 0.0
    if kp_data and 'Kp' in kp_data and kp_data['Kp']:
        max_kp = max(kp_data['Kp'])
    else:
        print("Warning: Could not fetch Kp data, defaulting to 0")
        
    # 2. Fetch Earthquakes from USGS
    usgs_url = f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime={start_time}&endtime={end_time}&minmagnitude=3.0"
    eq_data = fetch_json(usgs_url)
    
    total_m3 = 0
    total_m5 = 0
    total_m6 = 0
    total_deep = 0
    max_mag = 0.0
    
    if eq_data and 'features' in eq_data:
        features = eq_data['features']
        total_m3 = len(features)
        for eq in features:
            mag = eq['properties']['mag'] or 0
            depth = eq['geometry']['coordinates'][2] or 0
            
            if mag >= 5.0: total_m5 += 1
            if mag >= 6.0: total_m6 += 1
            if depth >= 150.0: total_deep += 1
            if mag > max_mag: max_mag = mag
            
    # Calculate Gaia Charge (our new scientific formula)
    charge = 1.0
    if max_kp <= 3.0:
        charge = 0.79 + (max_kp / 3.0) * 0.21
    elif max_kp <= 5.0:
        charge = 1.0 + ((max_kp - 3.0) / 2.0) * 0.37
    else:
        charge = 1.37 + ((max_kp - 5.0) / 4.0) * 0.63
        
    # 3. Save to CSV
    file_exists = os.path.isfile(CSV_FILE)
    
    with open(CSV_FILE, mode='a', newline='') as file:
        writer = csv.writer(file)
        if not file_exists:
            # Write header
            writer.writerow(["Date", "Max_Kp", "Gaia_Charge_Multiplier", "Total_M3", "Total_M5", "Total_M6", "Total_Deep", "Max_Magnitude"])
        
        # Write data row
        row = [
            date_str, 
            round(max_kp, 2), 
            round(charge, 3), 
            total_m3, 
            total_m5, 
            total_m6, 
            total_deep, 
            round(max_mag, 1)
        ]
        writer.writerow(row)
        
    print(f"[{datetime.datetime.utcnow().isoformat()}] Successfully archived data for {date_str}: {row}")

if __name__ == "__main__":
    main()
