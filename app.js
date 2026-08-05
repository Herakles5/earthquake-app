const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const eqList = document.getElementById('eq-list');
const statusDiv = document.getElementById('status');

let width, height;
let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let startX, startY;

let earthquakes = [];
let pulseTime = 0;
let lastLatestTime = 0;
let audioAllowed = false;
let autoResetTimeout = null;
let lineExpiryTime = 0;
let predictedNextTime = 0;
let predictedNextTime24h = 0;
let predictedNextTimeM4 = 0;
let predictedNextTime24hM4 = 0;
let predictedNextTime7d = 0;
let predictedNextTime30d = 0;
let predictedNextTime7dMag5 = 0;
let predictedNextTime7dMag7 = 0;
let predictedNextTime30dMag5 = 0;
let predictedNextTime30dMag7 = 0;
let predictedNextTime7dDeep = 0;
let predictedNextTime30dDeep = 0;

function updatePrediction() {
    let renderCountdown = (id, predictedTime, normalColor) => {
        const el = document.getElementById(id);
        if (el && predictedTime > 0) {
            let diff = predictedTime - Date.now();
            if (diff > 0) {
                let diffSecs = Math.floor(diff / 1000);
                let d = Math.floor(diffSecs / 86400);
                let h = Math.floor((diffSecs % 86400) / 3600);
                let m = Math.floor((diffSecs % 3600) / 60);
                let s = diffSecs % 60;
                let text = "";
                if (d > 0) text = `${d}d ${h}h ${m}m ${s}s`;
                else if (h > 0) text = `${h}h ${m}m ${s}s`;
                else text = `${m}m ${s}s`;
                
                el.textContent = text;
                el.style.color = normalColor;
            } else {
                let overdueSecs = Math.floor(Math.abs(diff) / 1000);
                let d = Math.floor(overdueSecs / 86400);
                let h = Math.floor((overdueSecs % 86400) / 3600);
                let m = Math.floor((overdueSecs % 3600) / 60);
                let s = overdueSecs % 60;
                let text = "";
                if (d > 0) text = `OVERDUE by ${d}d ${h}h ${m}m ${s}s`;
                else if (h > 0) text = `OVERDUE by ${h}h ${m}m ${s}s`;
                else text = `OVERDUE by ${m}m ${s}s`;
                
                el.textContent = text;
                el.style.color = '#ff3333';
            }
        } else if (el) {
            el.textContent = 'Calculating...';
        }
    };

    // Short-term prediction (last 5)
    renderCountdown('prediction-timer', predictedNextTime, '#ff8800');
    // Global 24h prediction
    renderCountdown('prediction-timer-24h', predictedNextTime24h, '#00ffcc');
    
    // M4 Short-term prediction
    renderCountdown('prediction-timer-m4', predictedNextTimeM4, '#ff3333');
    // M4 Global 24h prediction
    renderCountdown('prediction-timer-24h-m4', predictedNextTime24hM4, '#ff3333');
    
    // Global long term predictions
    renderCountdown('stat-7d-avg', predictedNextTime7d, '#00ffcc');
    renderCountdown('stat-30d-avg', predictedNextTime30d, '#00ffcc');
    
    renderCountdown('stat-7d-mag5-avg', predictedNextTime7dMag5, '#ff8800');
    renderCountdown('stat-7d-mag7-avg', predictedNextTime7dMag7, '#ff3333');
    
    renderCountdown('stat-30d-mag5-avg', predictedNextTime30dMag5, '#ff8800');
    renderCountdown('stat-30d-mag7-avg', predictedNextTime30dMag7, '#ff3333');
    
    renderCountdown('stat-7d-deep-avg', predictedNextTime7dDeep, '#88bbff');
    renderCountdown('stat-30d-deep-avg', predictedNextTime30dDeep, '#88bbff');
}
setInterval(updatePrediction, 1000);

window.addEventListener('click', () => audioAllowed = true, {once: true});
window.addEventListener('touchstart', () => audioAllowed = true, {once: true});

function playBeep() {
    if (!audioAllowed) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
        
        gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

function playDeepBeep() {
    if (!audioAllowed) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        
        // Lower pitch, longer ominous sound for deep earthquakes
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, ctx.currentTime); // Low pitch
        osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 1.0);
        
        gainNode.gain.setValueAtTime(0.8, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 1.0);
    } catch(e) {}
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

async function fetchEarthquakes() {
    try {
        statusDiv.textContent = "Fetching live data...";
        
        const [usgsRes, emscRes] = await Promise.all([
            fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'),
            fetch('https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=3.0&limit=500')
        ]);
        
        const usgsData = await usgsRes.json();
        const emscData = await emscRes.json();
        
        let rawEarthquakes = [];
        
        if (usgsData.features) {
            usgsData.features.forEach(f => {
                if (f.properties.mag >= 3.0) {
                    rawEarthquakes.push({
                        mag: f.properties.mag,
                        place: f.properties.place,
                        lon: f.geometry.coordinates[0],
                        lat: f.geometry.coordinates[1],
                        depth: f.geometry.coordinates[2] || 0,
                        time: f.properties.time
                    });
                }
            });
        }
        
        if (emscData.features) {
            emscData.features.forEach(f => {
                if (f.properties.mag >= 3.0) {
                    rawEarthquakes.push({
                        mag: f.properties.mag,
                        place: f.properties.flynn_region,
                        lon: f.geometry.coordinates[0],
                        lat: f.geometry.coordinates[1],
                        depth: f.geometry.coordinates[2] || f.properties.depth || 0,
                        time: new Date(f.properties.time).getTime()
                    });
                }
            });
        }
        
        rawEarthquakes.sort((a, b) => b.time - a.time);
        
        earthquakes = [];
        for (let i = 0; i < rawEarthquakes.length; i++) {
            let eq = rawEarthquakes[i];
            let isDuplicate = false;
            for (let j = 0; j < earthquakes.length; j++) {
                let e = earthquakes[j];
                if (Math.abs(eq.time - e.time) < 300000 && Math.hypot(eq.lat - e.lat, eq.lon - e.lon) < 2.0) {
                    isDuplicate = true;
                    if (eq.mag > e.mag) earthquakes[j] = eq;
                    break;
                }
            }
            if (!isDuplicate) {
                // Ensure strictly last 24 hours (86400000 ms)
                if (Date.now() - eq.time < 86400000) {
                    earthquakes.push(eq);
                }
            }
        }
        
        eqList.innerHTML = '';
        for (let i = 0; i < Math.min(25, earthquakes.length); i++) {
            let eq = earthquakes[i];
            let li = document.createElement('li');
            let color = eq.mag >= 5.0 ? '#ff3333' : (eq.mag >= 4.0 ? '#ff8800' : '#ffff00');
            li.style.color = color;
            
            let d = new Date(eq.time);
            let timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            
            let deepText = eq.depth >= 150.0 ? " [DEEP]" : "";
            li.textContent = `[${timeStr}] M${eq.mag.toFixed(1)}${deepText} - ${eq.place}`;
            eqList.appendChild(li);
        }
        
        if (earthquakes.length > 0) {
            let newestEq = earthquakes[0];
            if (lastLatestTime > 0 && newestEq.time > lastLatestTime) {
                // New earthquake!
                if (newestEq.depth >= 150.0) {
                    playDeepBeep();
                } else {
                    playBeep();
                }
                
                // Set expiry for the dashed line (120 seconds from now)
                lineExpiryTime = Date.now() + 120000;
                
                // Auto zoom & pan
                let r = ((90.0 - newestEq.lat) / 180.0) * 723.0;
                let angle = newestEq.lon * Math.PI / 180.0;
                let map_x = r * Math.sin(angle);
                let map_y = r * Math.cos(angle);
                
                zoom = 3.5; // Zoom in closer
                let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
                offsetX = -map_x * targetScale;
                offsetY = -map_y * targetScale;
                
                // Auto reset camera after 20 seconds
                if (autoResetTimeout) clearTimeout(autoResetTimeout);
                autoResetTimeout = setTimeout(() => {
                    zoom = 1.0;
                    offsetX = 0;
                    offsetY = 0;
                    autoResetTimeout = null;
                }, 20000);
                
                // Flash prediction bar to show recalculation
                let pbar = document.getElementById('prediction-bar');
                if (pbar) {
                    pbar.style.transition = 'none';
                    pbar.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                    setTimeout(() => {
                        pbar.style.transition = 'background-color 1.5s ease-out';
                        pbar.style.backgroundColor = 'rgba(20, 20, 30, 0.9)';
                    }, 50);
                }
            }
            lastLatestTime = newestEq.time;
        }
        
        
        if (earthquakes.length >= 5) {
            let totalDiff = 0;
            let count = 0;
            for (let i = 0; i < 4; i++) {
                let diff = Math.abs(earthquakes[i].time - earthquakes[i+1].time);
                if (diff < 36000000) { // ignore diffs larger than 10 hours
                    totalDiff += diff;
                    count++;
                }
            }
            if (count > 0) {
                let avgDiff = totalDiff / count;
                predictedNextTime = earthquakes[0].time + avgDiff;
            }
        }
        
        // Calculate global 24h average
        if (earthquakes.length > 1) {
            let oldest = earthquakes[earthquakes.length - 1].time;
            let newest = earthquakes[0].time;
            let timeSpan = newest - oldest;
            if (timeSpan > 0) {
                let globalAvgDiff = timeSpan / (earthquakes.length - 1);
                predictedNextTime24h = earthquakes[0].time + globalAvgDiff;
            }
        }
        
        // --- Calculate M4.0+ Predictions ---
        let eqsM4 = earthquakes.filter(eq => eq.mag >= 4.0);
        
        if (eqsM4.length >= 5) {
            let totalDiff = 0;
            let count = 0;
            for (let i = 0; i < 4; i++) {
                let diff = Math.abs(eqsM4[i].time - eqsM4[i+1].time);
                if (diff < 86400000) { 
                    totalDiff += diff;
                    count++;
                }
            }
            if (count > 0) {
                let avgDiff = totalDiff / count;
                predictedNextTimeM4 = eqsM4[0].time + avgDiff;
            }
        }
        
        if (eqsM4.length > 1) {
            let oldest = eqsM4[eqsM4.length - 1].time;
            let newest = eqsM4[0].time;
            let timeSpan = newest - oldest;
            if (timeSpan > 0) {
                let globalAvgDiff = timeSpan / (eqsM4.length - 1);
                predictedNextTime24hM4 = eqsM4[0].time + globalAvgDiff;
            }
        }
        
        // Calculate predicted region
        if (earthquakes.length > 0) {
            let getBestRegion = (limit) => {
                let regionCounts = {};
                let maxCount = 0;
                let bestRegion = earthquakes[0].place;
                let actualLimit = Math.min(limit, earthquakes.length);
                for (let i = 0; i < actualLimit; i++) {
                    let r = earthquakes[i].place;
                    let cleanR = r;
                    let ofIndex = r.indexOf(' of ');
                    if (ofIndex > -1) {
                        cleanR = r.substring(ofIndex + 4);
                    }
                    cleanR = cleanR.trim().toUpperCase();
                    regionCounts[cleanR] = (regionCounts[cleanR] || 0) + 1;
                    if (regionCounts[cleanR] > maxCount) {
                        maxCount = regionCounts[cleanR];
                        bestRegion = cleanR;
                    }
                }
                return bestRegion;
            };
            
            let reg5 = document.getElementById('prediction-region-5');
            if (reg5) reg5.textContent = getBestRegion(5);
            
            let reg24 = document.getElementById('prediction-region-24h');
            if (reg24) reg24.textContent = getBestRegion(earthquakes.length);
        }
        
        if (eqsM4.length > 0) {
            let getBestRegionM4 = (limit) => {
                let regionCounts = {};
                let maxCount = 0;
                let bestRegion = eqsM4[0].place;
                let actualLimit = Math.min(limit, eqsM4.length);
                for (let i = 0; i < actualLimit; i++) {
                    let r = eqsM4[i].place;
                    let cleanR = r;
                    let ofIndex = r.indexOf(' of ');
                    if (ofIndex > -1) cleanR = r.substring(ofIndex + 4);
                    cleanR = cleanR.trim().toUpperCase();
                    regionCounts[cleanR] = (regionCounts[cleanR] || 0) + 1;
                    if (regionCounts[cleanR] > maxCount) {
                        maxCount = regionCounts[cleanR];
                        bestRegion = cleanR;
                    }
                }
                return bestRegion;
            };
            
            let reg5m4 = document.getElementById('prediction-region-5-m4');
            if (reg5m4) reg5m4.textContent = getBestRegionM4(5);
            
            let reg24m4 = document.getElementById('prediction-region-24h-m4');
            if (reg24m4) reg24m4.textContent = getBestRegionM4(eqsM4.length);
        }
        
        updatePrediction();
        
        statusDiv.textContent = `${earthquakes.length} earthquakes mapped.`;
    } catch (e) {
        statusDiv.textContent = "Failed to load data.";
        statusDiv.style.color = "red";
    }
}

async function fetchLongTermStats() {
    try {
        let resMonth = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson');
        let dataMonth = await resMonth.json();
        
        let monthEqs = [];
        if (dataMonth.features) {
            dataMonth.features.forEach(f => {
                if (f.properties.mag >= 3.0) {
                    monthEqs.push({
                        mag: f.properties.mag,
                        place: f.properties.place,
                        depth: f.geometry.coordinates[2] || 0,
                        time: f.properties.time
                    });
                }
            });
        }
        
        // Sort newest first
        monthEqs.sort((a, b) => b.time - a.time);
        
        let now = Date.now();
        let weekEqs = monthEqs.filter(eq => (now - eq.time) < 7 * 86400000);
        
        let calculateStats = (eqArray) => {
            if (eqArray.length < 2) return { count: 0, avgMs: 0, region: 'N/A', mag5: 0, mag7: 0, deep: 0, mag5AvgMs: 0, mag7AvgMs: 0, deepAvgMs: 0, mag5Last: 0, mag7Last: 0, deepLast: 0 };
            let count = eqArray.length;
            let timeSpan = eqArray[0].time - eqArray[eqArray.length - 1].time;
            let avgMs = timeSpan / (count - 1);
            
            let regionCounts = {};
            let maxCount = 0;
            let bestRegion = eqArray[0].place;
            
            let mag5Eqs = eqArray.filter(eq => eq.mag >= 5.0);
            let mag7Eqs = eqArray.filter(eq => eq.mag >= 7.0);
            let deepEqs = eqArray.filter(eq => eq.depth >= 150.0);
            
            let mag5AvgMs = 0;
            if (mag5Eqs.length >= 2) {
                mag5AvgMs = (mag5Eqs[0].time - mag5Eqs[mag5Eqs.length - 1].time) / (mag5Eqs.length - 1);
            }
            
            let mag7AvgMs = 0;
            if (mag7Eqs.length >= 2) {
                mag7AvgMs = (mag7Eqs[0].time - mag7Eqs[mag7Eqs.length - 1].time) / (mag7Eqs.length - 1);
            }

            let deepAvgMs = 0;
            if (deepEqs.length >= 2) {
                deepAvgMs = (deepEqs[0].time - deepEqs[deepEqs.length - 1].time) / (deepEqs.length - 1);
            }
            
            eqArray.forEach(eq => {
                let cleanR = eq.place;
                let ofIndex = cleanR.indexOf(' of ');
                if (ofIndex > -1) cleanR = cleanR.substring(ofIndex + 4);
                cleanR = cleanR.trim().toUpperCase();
                regionCounts[cleanR] = (regionCounts[cleanR] || 0) + 1;
                if (regionCounts[cleanR] > maxCount) {
                    maxCount = regionCounts[cleanR];
                    bestRegion = cleanR;
                }
            });
            
            return { 
                count, avgMs, region: bestRegion, 
                mag5: mag5Eqs.length, mag7: mag7Eqs.length, deep: deepEqs.length,
                mag5AvgMs, mag7AvgMs, deepAvgMs,
                mag5Last: mag5Eqs.length > 0 ? mag5Eqs[0].time : 0,
                mag7Last: mag7Eqs.length > 0 ? mag7Eqs[0].time : 0,
                deepLast: deepEqs.length > 0 ? deepEqs[0].time : 0
            };
        };
        
        let stats7d = calculateStats(weekEqs);
        let stats30d = calculateStats(monthEqs);
        
        if (weekEqs.length > 0 && stats7d.avgMs > 0) predictedNextTime7d = weekEqs[0].time + stats7d.avgMs;
        if (monthEqs.length > 0 && stats30d.avgMs > 0) predictedNextTime30d = monthEqs[0].time + stats30d.avgMs;
        
        if (stats7d.mag5AvgMs > 0) predictedNextTime7dMag5 = stats7d.mag5Last + stats7d.mag5AvgMs;
        if (stats7d.mag7AvgMs > 0) predictedNextTime7dMag7 = stats7d.mag7Last + stats7d.mag7AvgMs;
        if (stats7d.deepAvgMs > 0) predictedNextTime7dDeep = stats7d.deepLast + stats7d.deepAvgMs;
        
        if (stats30d.mag5AvgMs > 0) predictedNextTime30dMag5 = stats30d.mag5Last + stats30d.mag5AvgMs;
        if (stats30d.mag7AvgMs > 0) predictedNextTime30dMag7 = stats30d.mag7Last + stats30d.mag7AvgMs;
        if (stats30d.deepAvgMs > 0) predictedNextTime30dDeep = stats30d.deepLast + stats30d.deepAvgMs;
        
        let updateText = (id, text) => {
            let el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        
        updateText('stat-7d-count', stats7d.count);
        updateText('stat-7d-mag5', stats7d.mag5);
        updateText('stat-7d-mag7', stats7d.mag7);
        updateText('stat-7d-deep', stats7d.deep);
        updateText('stat-7d-region', stats7d.region);
        
        updateText('stat-30d-count', stats30d.count);
        updateText('stat-30d-mag5', stats30d.mag5);
        updateText('stat-30d-mag7', stats30d.mag7);
        updateText('stat-30d-deep', stats30d.deep);
        updateText('stat-30d-region', stats30d.region);
        
        updatePrediction();
        
    } catch(e) {
        console.error("Failed to load long term stats", e);
    }
}

fetchEarthquakes();
setInterval(fetchEarthquakes, 60000); // refresh every minute

fetchLongTermStats();
setInterval(fetchLongTermStats, 3600000); // refresh every hour

function draw() {
    ctx.clearRect(0, 0, width, height);
    
    let mapCx = width / 2 + offsetX;
    let mapCy = height / 2 + offsetY;
    let scale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    
    // Draw Tectonic Plates
    if (typeof tectonic_plates !== 'undefined') {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 105, 180, 0.4)"; // Deep Pink, slightly transparent
        ctx.lineWidth = 1;
        for (let i = 0; i < tectonic_plates.length; i++) {
            let l = tectonic_plates[i];
            let r1 = ((90.0 - l[1]) / 180.0) * 723.0;
            let a1 = l[0] * Math.PI / 180.0;
            let px1 = mapCx + (r1 * Math.sin(a1)) * scale;
            let py1 = mapCy + (r1 * Math.cos(a1)) * scale;
            
            let r2 = ((90.0 - l[3]) / 180.0) * 723.0;
            let a2 = l[2] * Math.PI / 180.0;
            let px2 = mapCx + (r2 * Math.sin(a2)) * scale;
            let py2 = mapCy + (r2 * Math.cos(a2)) * scale;
            
            if ((px1 > 0 && px1 < width && py1 > 0 && py1 < height) || 
                (px2 > 0 && px2 < width && py2 > 0 && py2 < height)) {
                ctx.moveTo(px1, py1);
                ctx.lineTo(px2, py2);
            }
        }
        ctx.stroke();
    }
    
    // Draw Earthquakes First (so they are in the background relative to the line)
    pulseTime += 0.1;
    let pulse = (Math.sin(pulseTime) + 1.0) * 0.5;
    
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        
        let r = ((90.0 - eq.lat) / 180.0) * 723.0;
        let angle = eq.lon * Math.PI / 180.0;
        
        let map_x = r * Math.sin(angle);
        let map_y = r * Math.cos(angle);
        
        let px = mapCx + map_x * scale;
        let py = mapCy + map_y * scale;
        
        let baseR = eq.mag * 1.5 * zoom;
        let rSize = baseR + pulse * eq.mag * zoom;
        
        if (px + rSize > 0 && px - rSize < width && py + rSize > 0 && py - rSize < height) {
            ctx.beginPath();
            ctx.arc(px, py, rSize, 0, Math.PI * 2);
            let color = eq.mag >= 5.0 ? '255,50,50' : (eq.mag >= 3.0 ? '255,136,0' : '200,200,0');
            ctx.fillStyle = `rgba(${color}, 0.7)`;
            ctx.fill();
            
            if (eq.mag >= 4.5) {
                ctx.beginPath();
                ctx.moveTo(px - rSize - 5, py);
                ctx.lineTo(px + rSize + 5, py);
                ctx.moveTo(px, py - rSize - 5);
                ctx.lineTo(px, py + rSize + 5);
                ctx.strokeStyle = "rgba(255,255,255,0.6)";
                ctx.stroke();
            }
        }
    }
    
    // Draw Dashed line between last two earthquakes ON TOP of earthquakes
    if (Date.now() < lineExpiryTime && earthquakes.length >= 2) {
        let eq1 = earthquakes[0];
        let eq2 = earthquakes[1];
        
        let r1 = ((90.0 - eq1.lat) / 180.0) * 723.0;
        let angle1 = eq1.lon * Math.PI / 180.0;
        let px1 = mapCx + (r1 * Math.sin(angle1)) * scale;
        let py1 = mapCy + (r1 * Math.cos(angle1)) * scale;
        
        let r2 = ((90.0 - eq2.lat) / 180.0) * 723.0;
        let angle2 = eq2.lon * Math.PI / 180.0;
        let px2 = mapCx + (r2 * Math.sin(angle2)) * scale;
        let py2 = mapCy + (r2 * Math.cos(angle2)) * scale;
        
        ctx.beginPath();
        ctx.setLineDash([10, 10]);
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.strokeStyle = "#00ffcc"; // Cyan line
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash for other drawings
        
        let diffMs = Math.abs(eq1.time - eq2.time);
        let diffSecs = Math.floor(diffMs / 1000);
        let diffMins = Math.floor(diffSecs / 60);
        let diffHours = Math.floor(diffMins / 60);
        let diffStr = '';
        if (diffHours > 0) diffStr = `${diffHours}h ${diffMins % 60}m`;
        else if (diffMins > 0) diffStr = `${diffMins}m ${diffSecs % 60}s`;
        else diffStr = `${diffSecs}s`;
        
        let midX = (px1 + px2) / 2;
        let midY = (py1 + py2) / 2;
        
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.8)"; // Black outline
        ctx.strokeText(diffStr + " apart", midX, midY - 15);
        ctx.fillStyle = "#00ffcc"; // Cyan text
        ctx.fillText(diffStr + " apart", midX, midY - 15);
    }
    
    // Draw Coastlines ON TOP of earthquakes so islands are always visible
    ctx.beginPath();
    ctx.strokeStyle = "rgba(120, 220, 120, 0.8)"; // Brighter green and less transparent
    ctx.lineWidth = 1.5; // Slightly thicker
    
    for (let i = 0; i < coast_lines.length; i++) {
        let l = coast_lines[i];
        let px1 = mapCx + l[0] * scale;
        let py1 = mapCy + l[1] * scale;
        let px2 = mapCx + l[2] * scale;
        let py2 = mapCy + l[3] * scale;
        
        if ((px1 > 0 && px1 < width && py1 > 0 && py1 < height) || 
            (px2 > 0 && px2 < width && py2 > 0 && py2 < height)) {
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
        }
    }
    ctx.stroke();
    
    requestAnimationFrame(draw);
}
draw();

// Controls
document.getElementById('btn-zoomin').addEventListener('click', () => { zoom *= 1.3; });
document.getElementById('btn-zoomout').addEventListener('click', () => { zoom /= 1.3; if(zoom < 0.2) zoom = 0.2; });
document.getElementById('btn-reset').addEventListener('click', () => { zoom = 1.0; offsetX = 0; offsetY = 0; });

// Touch & Drag
canvas.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
});
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
    if (isDragging) {
        offsetX = e.clientX - startX;
        offsetY = e.clientY - startY;
    }
});

let lastTouchDistance = 0;
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
        isDragging = true;
        startX = e.touches[0].clientX - offsetX;
        startY = e.touches[0].clientY - offsetY;
    } else if (e.touches.length === 2) {
        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx*dx + dy*dy);
    }
});
window.addEventListener('touchend', e => {
    if (e.touches.length < 2) lastTouchDistance = 0;
    if (e.touches.length === 0) isDragging = false;
});
window.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isDragging) {
        offsetX = e.touches[0].clientX - startX;
        offsetY = e.touches[0].clientY - startY;
    } else if (e.touches.length === 2) {
        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        let dist = Math.sqrt(dx*dx + dy*dy);
        if (lastTouchDistance > 0) {
            zoom *= (dist / lastTouchDistance);
        }
        lastTouchDistance = dist;
    }
});

// Help Modal Controls
document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
});

document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
});

// Close modal when clicking outside the content
document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target.id === 'help-modal') {
        document.getElementById('help-modal').classList.add('hidden');
    }
});
