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
let lastMouseX = 0;
let lastMouseY = 0;
let lineExpiryTime = 0;
let knownEarthquakes = new Set();
let isInitialLoad = true;
let audioAllowed = false;
let autoResetTimeout = null;
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

let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

let audioUnlocked = false;

let hornBuffer = null;
let dramaticHornBuffer = null;

async function loadSounds() {
    try {
        initAudio();
        const [res1, res2] = await Promise.all([
            fetch('horn.mp3'),
            fetch('dramatic-horn.mp3')
        ]);
        const [buf1, buf2] = await Promise.all([
            res1.arrayBuffer(),
            res2.arrayBuffer()
        ]);
        hornBuffer = await audioCtx.decodeAudioData(buf1);
        dramaticHornBuffer = await audioCtx.decodeAudioData(buf2);
    } catch(e) {
        console.log("Error loading mp3s", e);
    }
}
loadSounds();

let soundManuallyDisabled = false;
const btnSound = document.getElementById('btn-sound');

if (btnSound) {
    btnSound.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audioAllowed) {
            audioAllowed = false;
            soundManuallyDisabled = true;
            btnSound.textContent = "Sound: OFF";
            btnSound.style.backgroundColor = "#ff3333";
        } else {
            audioAllowed = true;
            soundManuallyDisabled = false;
            btnSound.textContent = "Sound: ON";
            btnSound.style.backgroundColor = "#00cc66";
            initAudio();
            playBeep(); // Test sound
        }
    });
}

function autoEnableSound() {
    if (!audioAllowed && !soundManuallyDisabled) {
        audioAllowed = true;
        if (btnSound) {
            btnSound.textContent = "Sound: ON";
            btnSound.style.backgroundColor = "#00cc66";
        }
        initAudio();
        if (!audioUnlocked && audioCtx) {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 0;
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.01);
            audioUnlocked = true;
        }
    }
}

window.addEventListener('click', autoEnableSound);
window.addEventListener('touchstart', autoEnableSound);

function playHorn(isDeep) {
    if (!audioAllowed || !audioCtx) return;
    let buffer = isDeep ? dramaticHornBuffer : hornBuffer;
    if (!buffer) return;
    try {
        let source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start();
    } catch(e) {}
}

function playBeep() {
    if (!audioAllowed) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.3);
        
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
        
        setTimeout(() => playHorn(false), 300);
    } catch(e) {}
}

function playDeepBeep() {
    if (!audioAllowed) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(50, audioCtx.currentTime + 1.0);
        
        gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.0);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 1.0);
        
        setTimeout(() => playHorn(true), 1000);
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

// Helper to convert lat/lon to map coordinates matching standard equirectangular layout
function getMapCoordinates(lat, lon) {
    let map_x = ((lon + 180.0) / 360.0) * 1446.0;
    let map_y = ((90.0 - lat) / 180.0) * 723.0;
    return { x: map_x, y: map_y };
}

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
            let newQuakeAdded = null;
            
            for (let eq of earthquakes) {
                let sig = `${eq.lat.toFixed(2)}_${eq.lon.toFixed(2)}_${eq.time}`;
                if (!knownEarthquakes.has(sig)) {
                    knownEarthquakes.add(sig);
                    if (!isInitialLoad) {
                        if (!newQuakeAdded || eq.time > newQuakeAdded.time) {
                            newQuakeAdded = eq;
                        }
                    }
                }
            }
            
            if (knownEarthquakes.size > 3000) {
                knownEarthquakes.clear();
            }
            
            if (newQuakeAdded) {
                if (newQuakeAdded.depth >= 150.0) {
                    playDeepBeep();
                } else {
                    playBeep();
                }
                
                lineExpiryTime = Date.now() + 120000;
                
                let coords = getMapCoordinates(newQuakeAdded.lat, newQuakeAdded.lon);
                let map_x = coords.x - 723.0; // Centered offset correction
                let map_y = coords.y - 361.5;
                
                zoom = 3.5;
                let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
                offsetX = -map_x * targetScale;
                offsetY = -map_y * targetScale;
                
                if (autoResetTimeout) clearTimeout(autoResetTimeout);
                autoResetTimeout = setTimeout(() => {
                    zoom = 1.0;
                    offsetX = 0;
                    offsetY = 0;
                    autoResetTimeout = null;
                }, 20000);
                
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
            
            isInitialLoad = false;
        }
        
        let getQuadrantAvg = (eqList) => {
            if (eqList.length < 5) return null;
            let totalDiff = 0, count = 0;
            for (let i = 0; i < Math.min(10, eqList.length - 1); i++) {
                let diff = Math.abs(eqList[i].time - eqList[i+1].time);
                if (diff < 36000000) {
                    totalDiff += diff;
                    count++;
                }
            }
            if (count > 0) return eqList[0].time + (totalDiff / count);
            return null;
        };

        let nw = earthquakes.filter(eq => eq.lat >= 0 && eq.lon < 0);
        let ne = earthquakes.filter(eq => eq.lat >= 0 && eq.lon >= 0);
        let sw = earthquakes.filter(eq => eq.lat < 0 && eq.lon < 0);
        let se = earthquakes.filter(eq => eq.lat < 0 && eq.lon >= 0);
        
        let pNW = getQuadrantAvg(nw), pNE = getQuadrantAvg(ne);
        let pSW = getQuadrantAvg(sw), pSE = getQuadrantAvg(se);
        
        let validPreds = [pNW, pNE, pSW, pSE].filter(p => p !== null);
        if (validPreds.length > 0) {
            predictedNextTime = Math.max(...validPreds);
        } else if (earthquakes.length >= 5) {
            predictedNextTime = getQuadrantAvg(earthquakes);
        }
        
        let nsElem = document.getElementById('stat-hemi-ns');
        let ewElem = document.getElementById('stat-hemi-ew');
        if (nsElem && ewElem) {
            nsElem.textContent = `${nw.length + ne.length} vs ${sw.length + se.length}`;
            ewElem.textContent = `${ne.length + se.length} vs ${nw.length + sw.length}`;
        }
        
        if (earthquakes.length > 1) {
            let oldest = earthquakes[earthquakes.length - 1].time;
            let newest = earthquakes[0].time;
            let timeSpan = newest - oldest;
            if (timeSpan > 0) {
                let globalAvgDiff = timeSpan / (earthquakes.length - 1);
                predictedNextTime24h = earthquakes[0].time + globalAvgDiff;
            }
        }
        
        let eqsM4 = earthquakes.filter(eq => eq.mag >= 4.0);
        
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
        
        updatePrediction();
    } catch(e) {
        console.error("Failed to load long term stats", e);
    }
}

fetchEarthquakes();
setInterval(fetchEarthquakes, 60000);

fetchLongTermStats();
setInterval(fetchLongTermStats, 3600000);

function draw() {
    ctx.clearRect(0, 0, width, height);
    
    let mapCx = width / 2 + offsetX;
    let mapCy = height / 2 + offsetY;
    let scale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    
    // Draw Tectonic Plates using linear equirectangular mapping
    if (typeof tectonic_plates !== 'undefined') {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 105, 180, 0.4)";
        ctx.lineWidth = 1;
        for (let i = 0; i < tectonic_plates.length; i++) {
            let l = tectonic_plates[i];
            let pt1 = getMapCoordinates(l[1], l[0]);
            let pt2 = getMapCoordinates(l[3], l[2]);
            
            let px1 = mapCx + (pt1.x - 723.0) * scale;
            let py1 = mapCy + (pt1.y - 361.5) * scale;
            let px2 = mapCx + (pt2.x - 723.0) * scale;
            let py2 = mapCy + (pt2.y - 361.5) * scale;
            
            if ((px1 > 0 && px1 < width && py1 > 0 && py1 < height) || 
                (px2 > 0 && px2 < width && py2 > 0 && py2 < height)) {
                ctx.moveTo(px1, py1);
                ctx.lineTo(px2, py2);
            }
        }
        ctx.stroke();
    }
    
    pulseTime += 0.1;
    let pulse = (Math.sin(pulseTime) + 1.0) * 0.5;
    
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        let coords = getMapCoordinates(eq.lat, eq.lon);
        
        let px = mapCx + (coords.x - 723.0) * scale;
        let py = mapCy + (coords.y - 361.5) * scale;
        
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
    
    let now = Date.now();
    
    for (let i = 0; i < earthquakes.length - 1; i++) {
        let eq1 = earthquakes[i];
        let eq2 = earthquakes[i+1];
        
        let ageMs = now - eq1.time;
        if (ageMs > 900000) break;
        
        let diffMs = Math.abs(eq1.time - eq2.time);
        if (diffMs > 900000) continue;
        
        let c1 = getMapCoordinates(eq1.lat, eq1.lon);
        let c2 = getMapCoordinates(eq2.lat, eq2.lon);
        let px1 = mapCx + (c1.x - 723.0) * scale;
        let py1 = mapCy + (c1.y - 361.5) * scale;
        let px2 = mapCx + (c2.x - 723.0) * scale;
        let py2 = mapCy + (c2.y - 361.5) * scale;
        
        let opacity = Math.max(0.1, 1.0 - (ageMs / 900000));
        
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.strokeStyle = `rgba(0, 255, 204, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    if (earthquakes.length >= 2) {
        let eq1 = earthquakes[0];
        let eq2 = earthquakes[1];
        let ageMs = now - eq1.time;
        if (ageMs < 120000) {
            let c1 = getMapCoordinates(eq1.lat, eq1.lon);
            let c2 = getMapCoordinates(eq2.lat, eq2.lon);
            let px1 = mapCx + (c1.x - 723.0) * scale;
            let py1 = mapCy + (c1.y - 361.5) * scale;
            let px2 = mapCx + (c2.x - 723.0) * scale;
            let py2 = mapCy + (c2.y - 361.5) * scale;
            
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
            ctx.strokeStyle = "rgba(0,0,0,0.8)"; 
            ctx.strokeText(diffStr + " apart", midX, midY - 15);
            ctx.fillStyle = "#00ffcc";
            ctx.fillText(diffStr + " apart", midX, midY - 15);
        }
    }
    
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        let ageMs = now - eq.time;
        if (ageMs > 900000) break;
        
        let c = getMapCoordinates(eq.lat, eq.lon);
        let px = mapCx + (c.x - 723.0) * scale;
        let py = mapCy + (c.y - 361.5) * scale;
        
        let rippleRadius = (pulseTime * 50) % 150;
        let rippleOpacity = Math.max(0, 1.0 - (rippleRadius / 150));
        let overallOpacity = Math.max(0, 1.0 - (ageMs / 900000));
        let finalOpacity = rippleOpacity * overallOpacity;
        
        ctx.beginPath();
        ctx.arc(px, py, rippleRadius * zoom, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 204, ${finalOpacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(px, py, ((pulseTime * 50 + 75) % 150) * zoom, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 204, ${finalOpacity * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    
    // Draw Coastlines
    ctx.beginPath();
    ctx.strokeStyle = "rgba(120, 220, 120, 0.8)";
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i < coast_lines.length; i++) {
        let l = coast_lines[i];
        let px1 = mapCx + (l[0] - 723.0) * scale;
        let py1 = mapCy + (l[1] - 361.5) * scale;
        let px2 = mapCx + (l[2] - 723.0) * scale;
        let py2 = mapCy + (l[3] - 361.5) * scale;
        
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

document.getElementById('btn-zoomin').addEventListener('click', () => { zoom *= 1.3; });
document.getElementById('btn-zoomout').addEventListener('click', () => { zoom /= 1.3; if(zoom < 0.2) zoom = 0.2; });
document.getElementById('btn-reset').addEventListener('click', () => { zoom = 1.0; offsetX = 0; offsetY = 0; });

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

document.getElementById('btn-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
});

document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
});

document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target.id === 'help-modal') {
        document.getElementById('help-modal').classList.add('hidden');
    }
});