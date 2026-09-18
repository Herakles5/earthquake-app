const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const eqList = document.getElementById('eq-list');
const statusDiv = document.getElementById('status');
const eqPopup = document.getElementById('eq-popup');

let width, height;
let zoom = 1.0;
let offsetX = 0;
let offsetY = 0;
let isDragging = false;
let startX, startY;
let mouseDownX = 0, mouseDownY = 0;
let selectedEq = null;

let earthquakes = [];
let pulseTime = 0;
let lastMouseX = 0;
let lastMouseY = 0;
let lineExpiryTime = 0;
let knownEarthquakes = new Set();
let isInitialLoad = true;
let audioAllowed = false;
let lastInteractionTime = Date.now();
let isAutopilotActive = false;
let autopilotInterval = null;
let autopilotChain = [];
let autopilotIndex = 0;
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

let globalMonthEqs = [];
let historicalM5Eqs = [];
let historicalM7Eqs = [];
let historicalM8Eqs = [];
let gaiaCanvas = document.getElementById('gaiaCanvas');
let gaiaCtx = gaiaCanvas ? gaiaCanvas.getContext('2d') : null;
let gaiaPopup = document.getElementById('gaia-popup');
let gaiaPopupClose = document.getElementById('gaia-popup-close');
let gaiaContainer = document.getElementById('gaia-diagram-container');

if (gaiaPopupClose) {
    gaiaPopupClose.addEventListener('click', (e) => {
        e.stopPropagation();
        gaiaPopup.classList.add('hidden');
    });
    gaiaPopupClose.addEventListener('mousedown', (e) => e.stopPropagation());
    gaiaPopupClose.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: true});
}
if (gaiaContainer) {
    gaiaContainer.addEventListener('click', () => {
        if (gaiaPopup) gaiaPopup.classList.remove('hidden');
        updateGaiaPopup();
    });
}

// ========== Mathematical Helpers ==========
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateShockRadius(mag) {
    if (mag < 3) return 0;
    return 100 * Math.pow(3, (mag - 3));
}

// --- Advanced Statistical Functions ---
function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trimmedMean(arr, trimPercent = 0.1) {
    if (arr.length < 4) return arr.reduce((a, b) => a + b, 0) / arr.length;
    const sorted = [...arr].sort((a, b) => a - b);
    const trimCount = Math.max(1, Math.floor(sorted.length * trimPercent));
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

function exponentialWeightedAvg(gaps, alpha = 0.3) {
    if (gaps.length === 0) return 0;
    let ema = gaps[0];
    for (let i = 1; i < gaps.length; i++) {
        ema = alpha * gaps[i] + (1 - alpha) * ema;
    }
    return ema;
}

function stdDev(arr) {
    if (arr.length < 2) return 0;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sqDiffs = arr.map(v => (v - avg) ** 2);
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function poissonProbability(avgGapMs, timeSinceLast) {
    // P(at least 1 event in elapsed time) = 1 - e^(-λ*t)
    if (avgGapMs <= 0) return 0;
    const lambda = 1.0 / avgGapMs;
    return Math.min(0.99, 1.0 - Math.exp(-lambda * timeSinceLast));
}

function clusterEvents(eqs, timeThresholdMs = 1800000, distThresholdKm = 100) {
    // Group aftershocks/swarms into single events, keep strongest per cluster
    if (eqs.length === 0) return [];
    let clustered = [];
    let used = new Set();
    for (let i = 0; i < eqs.length; i++) {
        if (used.has(i)) continue;
        let best = eqs[i];
        for (let j = i + 1; j < eqs.length; j++) {
            if (used.has(j)) continue;
            if (Math.abs(eqs[i].time - eqs[j].time) < timeThresholdMs) {
                let dist = (eqs[i].lat !== undefined && eqs[j].lat !== undefined)
                    ? haversineDistance(eqs[i].lat, eqs[i].lon, eqs[j].lat, eqs[j].lon)
                    : 0;
                if (dist < distThresholdKm) {
                    used.add(j);
                    if (eqs[j].mag > best.mag) best = eqs[j];
                }
            }
        }
        clustered.push(best);
    }
    return clustered;
}

function computeGaps(eqs) {
    let gaps = [];
    for (let i = 0; i < eqs.length - 1; i++) {
        gaps.push(Math.abs(eqs[i].time - eqs[i + 1].time));
    }
    return gaps;
}

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
        // Lower pitch, longer ominous sound for deep earthquakes
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime); // Low pitch
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
                        id: f.id,
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
                        id: f.properties.unid || f.id || Math.random().toString(),
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
        let totalMainCount = earthquakes.length;
        for (let i = 0; i < earthquakes.length; i++) {
            let eq = earthquakes[i];
            let li = document.createElement('li');
            li.id = 'main-eq-item-' + eq.id;
            let color = eq.mag >= 5.0 ? '#ff3333' : (eq.mag >= 4.0 ? '#ff8800' : '#ffff00');
            
            let d = new Date(eq.time);
            let timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            
            let deepText = eq.depth >= 150.0 ? " [DEEP]" : "";
            let displayNum = totalMainCount - i;
            li.innerHTML = `<span style="color:#888; font-weight:bold; margin-right:5px;">#${displayNum}</span><span style="color:${color};">[${timeStr}] M${eq.mag.toFixed(1)}${deepText} - ${eq.place}</span>`;
            
            li.addEventListener('click', () => {
                selectEqFromList(eq);
            });
            
            eqList.appendChild(li);
        }
        
        if (earthquakes.length > 0) {
            let newQuakeAdded = null;
            
            for (let eq of earthquakes) {
                let sig = eq.id ? String(eq.id) : `${eq.lat.toFixed(2)}_${eq.lon.toFixed(2)}_${eq.time}`;
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
                // New earthquake!
                if (newQuakeAdded.depth >= 150.0) {
                    playDeepBeep();
                } else {
                    playBeep();
                }
                
                // Set expiry for the dashed line (120 seconds from now)
                lineExpiryTime = Date.now() + 120000;
                
                // Auto zoom & pan
                let r = ((90.0 - newQuakeAdded.lat) / 180.0) * 723.0;
                let angle = newQuakeAdded.lon * Math.PI / 180.0;
                let map_x = r * Math.sin(angle);
                let map_y = r * Math.cos(angle);
                
                zoom = 3.5; // Zoom in closer
                let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
                offsetX = -map_x * targetScale;
                // Stop autopilot and clear chain when a new real earthquake arrives
                stopAutopilot(true);
                
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
            
            isInitialLoad = false;
        }
        
        // --- Smart Prediction (Cluster-aware, Median-based) ---
        let getSmartPrediction = (eqList) => {
            if (eqList.length < 3) return null;
            // Cluster nearby events to avoid aftershock bias
            let clustered = clusterEvents(eqList.slice(0, 20));
            if (clustered.length < 3) clustered = eqList.slice(0, 10);
            let gaps = computeGaps(clustered);
            if (gaps.length === 0) return null;
            // Use median for robustness, EMA for recency
            let medGap = median(gaps);
            let emaGap = exponentialWeightedAvg(gaps, 0.35);
            // Blend: 60% median (stable), 40% EMA (reactive)
            let blendedGap = medGap * 0.6 + emaGap * 0.4;
            return eqList[0].time + blendedGap;
        };

        // Short-term prediction using smart method
        if (earthquakes.length >= 3) {
            predictedNextTime = getSmartPrediction(earthquakes);
        }
        
        // Calculate Hemisphere Stats (24H)
        let nw = earthquakes.filter(eq => eq.lat >= 0 && eq.lon < 0);
        let ne = earthquakes.filter(eq => eq.lat >= 0 && eq.lon >= 0);
        let sw = earthquakes.filter(eq => eq.lat < 0 && eq.lon < 0);
        let se = earthquakes.filter(eq => eq.lat < 0 && eq.lon >= 0);
        let nsElem = document.getElementById('stat-hemi-ns');
        let ewElem = document.getElementById('stat-hemi-ew');
        if (nsElem && ewElem) {
            nsElem.textContent = `${nw.length + ne.length} vs ${sw.length + se.length}`;
            ewElem.textContent = `${ne.length + se.length} vs ${nw.length + sw.length}`;
        }
        
        // Global 24h prediction (median-based)
        if (earthquakes.length > 2) {
            let gaps24 = computeGaps(earthquakes);
            let medGap24 = median(gaps24);
            let emaGap24 = exponentialWeightedAvg(gaps24, 0.3);
            let blended24 = medGap24 * 0.6 + emaGap24 * 0.4;
            predictedNextTime24h = earthquakes[0].time + blended24;
        }
        
        let eqsM4 = earthquakes.filter(eq => eq.mag >= 4.0);
        
        // M4+ short-term (smart prediction)
        if (eqsM4.length >= 3) {
            predictedNextTimeM4 = getSmartPrediction(eqsM4);
        }
        
        // M4+ global 24h (median-based)
        if (eqsM4.length > 2) {
            let gapsM4 = computeGaps(eqsM4);
            let medGapM4 = median(gapsM4);
            let emaGapM4 = exponentialWeightedAvg(gapsM4, 0.3);
            let blendedM4 = medGapM4 * 0.6 + emaGapM4 * 0.4;
            predictedNextTime24hM4 = eqsM4[0].time + blendedM4;
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

const tickerContent = document.getElementById('ticker-content');
const tickerScroll = document.getElementById('ticker-scroll');

let volcanoData = [];
let tsunamiData = [];

// Hilfsfunktion für relative Zeitangaben
function getRelativeTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
}

// Ticker rendern
function renderTicker() {
    if (!tickerContent) return;
    
    let html = '';
    
    tsunamiData.forEach(t => {
        let timeStr = getRelativeTime(t.timestamp);
        html += `<span class="ticker-item ticker-tsunami">🌊 TSUNAMI: [${timeStr}] ${t.region} - ${t.level}</span>`;
    });
    
    volcanoData.forEach(v => {
        let timeStr = getRelativeTime(v.timestamp);
        html += `<span class="ticker-item ticker-volcano">🌋 VOLCANO: [${timeStr}] ${v.name} - ${v.status}</span>`;
    });
    
    tickerContent.innerHTML = html;
    
    // Setze die Dauer basierend auf der Anzahl der Items (ca. 8 Sekunden pro Item)
    const totalItems = tsunamiData.length + volcanoData.length;
    const duration = Math.max(60, totalItems * 8); // Mindestens 60s
    
    // Animation zurücksetzen, damit es neu von rechts reinscrollt
    if (tickerScroll) {
        tickerScroll.style.animationDuration = `${duration}s`;
        tickerScroll.style.animationName = 'none';
        tickerScroll.offsetHeight; /* trigger reflow */
        tickerScroll.style.animationName = 'ticker'; 
    }
}

// Echte Live-Daten von USGS laden und aufteilen
async function fetchLiveTickers() {
    try {
        // Wir nutzen jetzt den Feed für Stärke 4.5+ der letzten 7 Tage,
        // damit der Ticker immer gut mit signifikanten Events gefüllt ist!
        const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
        const data = await response.json();
        
        if (data && data.features) {
            volcanoData = [];
            tsunamiData = [];

            data.features.forEach(quake => {
                const props = quake.properties;
                const place = props.place;
                const mag = props.mag;
                const time = props.time;
                const tsunamiFlag = props.tsunami; // 1 wenn Tsunami-Warnung

                // Signifikante seismische Events in den Vulkan-/Aktivitäten-Ticker schreiben
                volcanoData.push({
                    name: place,
                    status: `Seismic Unrest - Mag ${mag.toFixed(1)}`,
                    timestamp: time
                });

                // Wenn die USGS ein Tsunami-Flag setzt, in den Tsunami-Ticker schreiben
                if (tsunamiFlag === 1) {
                    tsunamiData.push({
                        region: place,
                        level: `Tsunami Warning (Mag ${mag.toFixed(1)})`,
                        timestamp: time
                    });
                }
            });

            // Fallback für Tsunami-Ticker, falls weltweit keine Warnung vorliegt
            if (tsunamiData.length === 0) {
                tsunamiData.push({
                    region: "Global Tsunami Monitoring",
                    level: "No active threats reported",
                    timestamp: Date.now()
                });
            }
        }
    } catch (e) {
        console.error("Error fetching ticker data:", e);
    }

    renderTicker();
}

// Initialer Aufruf
fetchLiveTickers();

// Jede Minute Timer (relative Zeiten) aktualisieren
setInterval(() => {
    renderTicker();
}, 60000);

// Alle 5 Minuten neue Daten von der API holen
setInterval(fetchLiveTickers, 300000);

async function fetchLongTermStats() {
    try {
        let resMonth = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson');
        let dataMonth = await resMonth.json();
        
        let monthEqs = [];
        if (dataMonth.features) {
            dataMonth.features.forEach(f => {
                if (f.properties.mag >= 3.0) {
                    monthEqs.push({
                        id: f.id,
                        mag: f.properties.mag,
                        place: f.properties.place,
                        depth: f.geometry.coordinates[2] || 0,
                        lat: f.geometry.coordinates[1],
                        lon: f.geometry.coordinates[0],
                        time: f.properties.time
                    });
                }
            });
        }
        
        // Sort newest first
        monthEqs.sort((a, b) => b.time - a.time);
        globalMonthEqs = monthEqs;
        if (typeof drawGaiaDiagram === 'function') drawGaiaDiagram();
        
        let now = Date.now();
        let weekEqs = monthEqs.filter(eq => (now - eq.time) < 7 * 86400000);
        
        let calculateStats = (eqArray) => {
            if (eqArray.length < 2) return { count: 0, avgMs: 0, region: 'N/A', mag5: 0, mag7: 0, deep: 0, mag5AvgMs: 0, mag7AvgMs: 0, deepAvgMs: 0, mag5Last: 0, mag7Last: 0, deepLast: 0 };
            let count = eqArray.length;
            
            // Use median of gaps instead of simple division
            let allGaps = computeGaps(eqArray);
            let medianGap = median(allGaps);
            let emaGap = exponentialWeightedAvg(allGaps, 0.3);
            let avgMs = medianGap * 0.6 + emaGap * 0.4; // Blended
            
            let regionCounts = {};
            let maxCount = 0;
            let bestRegion = eqArray[0].place;
            
            let mag5Eqs = eqArray.filter(eq => eq.mag >= 5.0);
            let mag7Eqs = eqArray.filter(eq => eq.mag >= 7.0);
            let deepEqs = eqArray.filter(eq => eq.depth >= 150.0);
            
            let calcSubAvg = (subEqs) => {
                if (subEqs.length < 2) return 0;
                let subGaps = computeGaps(subEqs);
                let med = median(subGaps);
                let ema = exponentialWeightedAvg(subGaps, 0.3);
                return med * 0.6 + ema * 0.4;
            };
            
            let mag5AvgMs = calcSubAvg(mag5Eqs);
            let mag7AvgMs = calcSubAvg(mag7Eqs);
            let deepAvgMs = calcSubAvg(deepEqs);
            
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

async function fetchHistoricalData() {
    let now = new Date();
    let nowStr = now.toISOString().split('T')[0];
    
    // M5+ last 365 days
    let date1Yr = new Date(now.getTime() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
    try {
        let m5Url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${date1Yr}&endtime=${nowStr}&minmagnitude=5.0`;
        let m5Res = await fetch(m5Url);
        let m5Data = await m5Res.json();
        if (m5Data.features) {
            historicalM5Eqs = m5Data.features.map(f => ({
                id: f.id,
                mag: f.properties.mag,
                depth: f.geometry.coordinates[2],
                place: f.properties.place,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                time: f.properties.time
            })).sort((a,b) => b.time - a.time);
        }
    } catch(e) { console.error("Failed M5+", e); }
    
    // M7+ last 5 years
    let date5Yr = new Date(now.getTime() - 5 * 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
    try {
        let m7Url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${date5Yr}&endtime=${nowStr}&minmagnitude=7.0`;
        let m7Res = await fetch(m7Url);
        let m7Data = await m7Res.json();
        if (m7Data.features) {
            historicalM7Eqs = m7Data.features.map(f => ({
                id: f.id,
                mag: f.properties.mag,
                depth: f.geometry.coordinates[2],
                place: f.properties.place,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                time: f.properties.time
            })).sort((a,b) => b.time - a.time);
        }
    } catch(e) { console.error("Failed M7+", e); }
    
    // M8+ last 20 years
    let date20Yr = new Date(now.getTime() - 20 * 365 * 24 * 3600 * 1000).toISOString().split('T')[0];
    try {
        let m8Url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${date20Yr}&endtime=${nowStr}&minmagnitude=8.0`;
        let m8Res = await fetch(m8Url);
        let m8Data = await m8Res.json();
        if (m8Data.features) {
            historicalM8Eqs = m8Data.features.map(f => ({
                id: f.id,
                mag: f.properties.mag,
                depth: f.geometry.coordinates[2],
                place: f.properties.place,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                time: f.properties.time
            })).sort((a,b) => b.time - a.time);
        }
    } catch(e) { console.error("Failed M8+", e); }
    
    updateGaiaPopup();
}

fetchHistoricalData();

function drawGaiaDiagram() {
    if (!gaiaCanvas || !gaiaCtx || !gaiaContainer) return;
    
    const rect = gaiaContainer.getBoundingClientRect();
    gaiaCanvas.width = rect.width - 30;
    gaiaCanvas.height = 80;
    
    gaiaCtx.clearRect(0, 0, gaiaCanvas.width, gaiaCanvas.height);
    
    if (!globalMonthEqs || globalMonthEqs.length === 0) return;
    
    let now = Date.now();
    let timeSpan = 144 * 3600000;
    let cutoff = now - timeSpan;
    
    let relevantEqs = globalMonthEqs.filter(eq => eq.time >= cutoff);
    if (relevantEqs.length === 0) return;
    
    let padding = 30;
    let paddingR = 10;
    let chartW = gaiaCanvas.width - padding - paddingR;
    let chartH = gaiaCanvas.height - 12;
    
    // Background gradient
    let bgGrad = gaiaCtx.createLinearGradient(0, 0, 0, gaiaCanvas.height);
    bgGrad.addColorStop(0, 'rgba(80, 0, 120, 0.15)');
    bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    gaiaCtx.fillStyle = bgGrad;
    gaiaCtx.fillRect(0, 0, gaiaCanvas.width, gaiaCanvas.height);
    
    // Y-axis magnitude labels
    gaiaCtx.font = '8px monospace';
    gaiaCtx.fillStyle = 'rgba(255,255,255,0.35)';
    gaiaCtx.textAlign = 'right';
    [3, 5, 7].forEach(m => {
        let y = gaiaCanvas.height - 2 - ((m - 2.5) / 6.5) * chartH;
        if (y > 8) {
            gaiaCtx.fillText('M' + m, padding - 4, y + 3);
            gaiaCtx.beginPath();
            gaiaCtx.moveTo(padding, y);
            gaiaCtx.lineTo(gaiaCanvas.width - paddingR, y);
            gaiaCtx.strokeStyle = 'rgba(255,255,255,0.06)';
            gaiaCtx.lineWidth = 0.5;
            gaiaCtx.stroke();
        }
    });
    
    // X-axis time markers (every 24h)
    gaiaCtx.textAlign = 'center';
    gaiaCtx.fillStyle = 'rgba(255,255,255,0.3)';
    gaiaCtx.font = '7px monospace';
    for (let h = 24; h <= 144; h += 24) {
        let x = padding + ((timeSpan - h * 3600000) / timeSpan) * chartW;
        gaiaCtx.beginPath();
        gaiaCtx.moveTo(x, 0);
        gaiaCtx.lineTo(x, gaiaCanvas.height - 1);
        gaiaCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        gaiaCtx.lineWidth = 0.5;
        gaiaCtx.stroke();
        gaiaCtx.fillText(`-${h}h`, x, gaiaCanvas.height - 1);
    }
    
    // Baseline
    gaiaCtx.beginPath();
    gaiaCtx.moveTo(padding, gaiaCanvas.height - 2);
    gaiaCtx.lineTo(gaiaCanvas.width - paddingR, gaiaCanvas.height - 2);
    gaiaCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    gaiaCtx.lineWidth = 1;
    gaiaCtx.stroke();
    
    // Trend line (moving average)
    let sortedByTime = [...relevantEqs].sort((a, b) => a.time - b.time);
    if (sortedByTime.length > 5) {
        gaiaCtx.beginPath();
        let windowSize = Math.max(3, Math.floor(sortedByTime.length / 8));
        let first = true;
        for (let i = windowSize; i < sortedByTime.length; i++) {
            let windowEqs = sortedByTime.slice(i - windowSize, i);
            let avgMag = windowEqs.reduce((s, e) => s + e.mag, 0) / windowEqs.length;
            let avgTime = windowEqs.reduce((s, e) => s + e.time, 0) / windowEqs.length;
            let x = padding + ((avgTime - cutoff) / timeSpan) * chartW;
            let height = Math.max(2, ((avgMag - 2.5) / 6.5) * chartH);
            let y = gaiaCanvas.height - 2 - height;
            if (first) { gaiaCtx.moveTo(x, y); first = false; }
            else gaiaCtx.lineTo(x, y);
        }
        gaiaCtx.strokeStyle = 'rgba(255, 51, 255, 0.4)';
        gaiaCtx.lineWidth = 1.5;
        gaiaCtx.stroke();
    }
    
    // Draw stems with glow for M5+
    relevantEqs.forEach(eq => {
        let timeDiff = eq.time - cutoff;
        let x = padding + (timeDiff / timeSpan) * chartW;
        
        let height = Math.max(3, ((eq.mag - 2.5) / 6.5) * chartH);
        if (height > chartH) height = chartH;
        
        let magColor = '#c8c800';
        if (eq.mag >= 7.0) magColor = '#ff33ff';
        else if (eq.mag >= 5.0) magColor = '#ff3333';
        else if (eq.mag >= 4.0) magColor = '#ff8800';
        else if (eq.mag >= 3.5) magColor = '#00ffcc';
        
        // Glow for M5+
        if (eq.mag >= 5.0) {
            gaiaCtx.save();
            gaiaCtx.shadowColor = magColor;
            gaiaCtx.shadowBlur = 6;
            gaiaCtx.beginPath();
            gaiaCtx.arc(x, gaiaCanvas.height - 2 - height, 2.5, 0, 2 * Math.PI);
            gaiaCtx.fillStyle = magColor;
            gaiaCtx.globalAlpha = 0.9;
            gaiaCtx.fill();
            gaiaCtx.restore();
        }
        
        // Stem
        gaiaCtx.beginPath();
        gaiaCtx.moveTo(x, gaiaCanvas.height - 2);
        gaiaCtx.lineTo(x, gaiaCanvas.height - 2 - height);
        gaiaCtx.strokeStyle = magColor;
        gaiaCtx.lineWidth = eq.mag >= 5.0 ? 2 : 1.5;
        gaiaCtx.globalAlpha = 0.8;
        gaiaCtx.stroke();
        
        // Dot
        gaiaCtx.beginPath();
        gaiaCtx.arc(x, gaiaCanvas.height - 2 - height, eq.mag >= 5.0 ? 2.5 : 1.5, 0, 2 * Math.PI);
        gaiaCtx.fillStyle = magColor;
        gaiaCtx.globalAlpha = 1.0;
        gaiaCtx.fill();
    });
    gaiaCtx.globalAlpha = 1.0;
}

function updateGaiaPopup() {
    let statsDiv = document.getElementById('gaia-popup-stats');
    if (!statsDiv) return;
    
    let now = Date.now();
    let formatDur = (ms) => {
        let years = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
        let days = Math.floor((ms % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24));
        let hrs = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let mins = Math.floor((ms % (1000 * 60 * 60)) / 60000);
        if (years > 0) return `${years}y ${days}d`;
        if (days > 0) return `${days}d ${hrs}h`;
        if (hrs > 0) return `${hrs}h ${mins}m`;
        return `${mins}m`;
    };
    
    let calcRhythm = (eqArray, minMag) => {
        let filtered = eqArray.filter(e => e.mag >= minMag);
        if (filtered.length < 2) return null;
        
        let lastEq = filtered[0];
        let timeSinceLast = now - lastEq.time;
        
        // Compute gaps and use advanced statistics
        let gaps = computeGaps(filtered);
        let medGap = median(gaps);
        let emaGap = exponentialWeightedAvg(gaps, 0.3);
        let avgGapMs = medGap * 0.6 + emaGap * 0.4; // Blended
        let sigma = stdDev(gaps);
        
        // Confidence: low sigma relative to avg = high confidence
        let cv = avgGapMs > 0 ? sigma / avgGapMs : 1; // Coefficient of variation
        let confidence = cv < 0.3 ? 'High' : cv < 0.6 ? 'Medium' : 'Low';
        let confidenceColor = cv < 0.3 ? '#00ff88' : cv < 0.6 ? '#ff8800' : '#888';
        
        // Poisson probability
        let prob = poissonProbability(avgGapMs, timeSinceLast);
        let probPercent = Math.round(prob * 100);
        
        // 6-level status system
        let ratio = timeSinceLast / avgGapMs;
        let status, statusColor;
        if (ratio < 0.3)       { status = 'Just Released';    statusColor = '#00ffcc'; }
        else if (ratio < 0.7)  { status = 'Resting Phase';    statusColor = '#00ff88'; }
        else if (ratio < 0.9)  { status = 'Building Energy';  statusColor = '#ff8800'; }
        else if (ratio < 1.0)  { status = 'Building Peak';    statusColor = '#ff33ff'; }
        else if (ratio < 1.5)  { status = 'Overdue';          statusColor = '#ff3333'; }
        else                   { status = 'Critical Overdue'; statusColor = '#ff0000'; }
        
        // Last event info
        let lastPlace = lastEq.place || 'Unknown';
        if (lastPlace.length > 30) lastPlace = lastPlace.substring(0, 28) + '…';
        
        return {
            avgStr: formatDur(avgGapMs),
            lastStr: formatDur(timeSinceLast),
            status, color: statusColor,
            ratio, probPercent,
            confidence, confidenceColor,
            sigmaStr: '±' + formatDur(sigma),
            lastMag: lastEq.mag.toFixed(1),
            lastPlace,
            count: filtered.length
        };
    };
    
    let mergeEqs = (arr1, arr2) => {
        let map = new Map();
        let addToMap = (arr) => {
            if (arr) arr.forEach(eq => {
                let sig = eq.id ? String(eq.id) : `${eq.lat.toFixed(2)}_${eq.lon.toFixed(2)}_${eq.time}`;
                map.set(sig, eq);
            });
        };
        addToMap(arr1);
        addToMap(arr2);
        return Array.from(map.values()).sort((a,b) => b.time - a.time);
    };
    
    let combinedM5 = mergeEqs(globalMonthEqs, historicalM5Eqs);
    let combinedM7 = mergeEqs(globalMonthEqs, historicalM7Eqs);
    let combinedM8 = mergeEqs(globalMonthEqs, historicalM8Eqs);
    
    let m3Stats = calcRhythm(globalMonthEqs, 3.0);
    let m4Stats = calcRhythm(globalMonthEqs, 4.0);
    let m5Stats = calcRhythm(combinedM5, 5.0);
    let m6Stats = calcRhythm(combinedM5, 6.0);
    let m7Stats = calcRhythm(combinedM7, 7.0);
    let m8Stats = calcRhythm(combinedM8, 8.0);
    
    let html = `<table style="width:100%; border-collapse: collapse; text-align: left; font-size: 12px;">
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.25); color:#aaa;">
            <th style="padding: 4px 2px;">Class</th>
            <th style="padding: 4px 2px;">Rhythm</th>
            <th style="padding: 4px 2px;">Since Last</th>
            <th style="padding: 4px 2px;">Status</th>
            <th style="padding: 4px 2px;">P(%)</th>
            <th style="padding: 4px 2px; min-width:110px;">Progress</th>
        </tr>`;
        
    let addRow = (label, data, labelColor) => {
        if (!data) return;
        let progressPercent = Math.min(150, data.ratio * 100);
        let barColor = data.color;
        let pulseClass = data.ratio >= 1.5 ? 'gaia-bar-critical' : '';
        let probColor = data.probPercent >= 80 ? '#ff3333' : data.probPercent >= 50 ? '#ff8800' : '#00ffcc';
        html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);" title="Last: M${data.lastMag} — ${data.lastPlace} (${data.count} events, Confidence: ${data.confidence} ${data.sigmaStr})">
            <td style="padding: 6px 2px; color:${labelColor}; font-weight:bold;">${label}</td>
            <td style="padding: 6px 2px; color:#ddd; font-size:11px;">Every ${data.avgStr}</td>
            <td style="padding: 6px 2px; color:#fff; font-size:11px;">${data.lastStr}</td>
            <td style="padding: 6px 2px; color:${data.color}; font-weight:bold; font-size:11px;">${data.status}</td>
            <td style="padding: 6px 2px; color:${probColor}; font-weight:bold;">${data.probPercent}%</td>
            <td style="padding: 6px 2px;"><div class="gaia-progress-bar ${pulseClass}"><div class="gaia-progress-fill" style="width:${Math.min(100, progressPercent)}%; background:${barColor};"></div></div></td>
        </tr>`;
    };
    
    if (m3Stats) addRow('M3+', m3Stats, '#c8c800');
    if (m4Stats) addRow('M4+', m4Stats, '#ff8800');
    if (m5Stats) addRow('M5+', m5Stats, '#ff5555');
    if (m6Stats) addRow('M6+', m6Stats, '#ff3333');
    if (m7Stats) addRow('M7+', m7Stats, '#ff33ff');
    if (m8Stats) addRow('M8+', m8Stats, '#ff00ff');
    
    // M9+ real historical data
    let m9Events = [
        { time: new Date('2011-03-11T05:46:24Z').getTime(), place: 'Tōhoku, Japan', mag: 9.1 },
        { time: new Date('2004-12-26T00:58:53Z').getTime(), place: 'Sumatra, Indonesia', mag: 9.1 },
        { time: new Date('1964-03-27T17:36:00Z').getTime(), place: 'Alaska, USA', mag: 9.2 },
        { time: new Date('1960-05-22T19:11:00Z').getTime(), place: 'Valdivia, Chile', mag: 9.5 },
        { time: new Date('1952-11-04T16:58:00Z').getTime(), place: 'Kamchatka, Russia', mag: 9.0 }
    ];
    let m9TimeSince = now - m9Events[0].time;
    let m9Gaps = computeGaps(m9Events);
    let m9AvgGap = median(m9Gaps);
    let m9Ratio = m9TimeSince / m9AvgGap;
    let m9Prob = poissonProbability(m9AvgGap, m9TimeSince);
    let m9Status, m9StatusColor;
    if (m9Ratio < 0.7) { m9Status = 'Resting Phase'; m9StatusColor = '#00ff88'; }
    else if (m9Ratio < 1.0) { m9Status = 'Building Energy'; m9StatusColor = '#ff8800'; }
    else { m9Status = 'Overdue'; m9StatusColor = '#ff3333'; }
    let m9Progress = Math.min(150, m9Ratio * 100);
    let m9ProbColor = Math.round(m9Prob*100) >= 50 ? '#ff3333' : '#ff8800';
    html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);" title="Last: M${m9Events[0].mag} — ${m9Events[0].place} (5 events since 1952)">
        <td style="padding: 6px 2px; color:#aa00ff; font-weight:bold;">M9+</td>
        <td style="padding: 6px 2px; color:#ddd; font-size:11px;">Every ${formatDur(m9AvgGap)}</td>
        <td style="padding: 6px 2px; color:#fff; font-size:11px;">${formatDur(m9TimeSince)}</td>
        <td style="padding: 6px 2px; color:${m9StatusColor}; font-weight:bold; font-size:11px;">${m9Status}</td>
        <td style="padding: 6px 2px; color:${m9ProbColor}; font-weight:bold;">${Math.round(m9Prob*100)}%</td>
        <td style="padding: 6px 2px;"><div class="gaia-progress-bar"><div class="gaia-progress-fill" style="width:${Math.min(100, m9Progress)}%; background:${m9StatusColor};"></div></div></td>
    </tr>`;
    
    html += `</table>`;
    html += `<div style="margin-top:8px; color:#888; font-size:9px; text-align:center;">Hover rows for last event details · P(%) = Poisson probability · Rhythm = Median + EMA blend</div>`;
    
    if (historicalM5Eqs.length === 0 || historicalM7Eqs.length === 0 || historicalM8Eqs.length === 0) {
        html += `<div style="margin-top:10px; color:#ff8800; text-align:center; font-size:11px; animation: pulse 1.5s infinite;">Fetching historical data... (Please wait 1-2s)</div>`;
    }
    
    statsDiv.innerHTML = html;
}

// Update live every second if visible
setInterval(() => {
    if (gaiaPopup && !gaiaPopup.classList.contains('hidden')) {
        updateGaiaPopup();
    }
}, 1000);

// Window resize handler for diagram
window.addEventListener('resize', () => {
    drawGaiaDiagram();
});

// ========== Calculation Explainer Popup Logic ==========
let calcPopup = document.getElementById('calc-popup');
let calcPopupClose = document.getElementById('calc-popup-close');
if (calcPopupClose) {
    calcPopupClose.addEventListener('click', (e) => {
        e.stopPropagation();
        calcPopup.classList.add('hidden');
    });
    calcPopupClose.addEventListener('mousedown', (e) => e.stopPropagation());
    calcPopupClose.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: true});
}

document.addEventListener('click', (e) => {
    let stat = e.target.closest('.clickable-stat');
    if (!stat || !calcPopup) return;
    e.stopPropagation();
    
    // Close other popups
    if (gaiaPopup && !gaiaPopup.classList.contains('hidden')) gaiaPopup.classList.add('hidden');
    if (eqPopup && !eqPopup.classList.contains('hidden')) eqPopup.classList.add('hidden');
    
    let calcType = stat.getAttribute('data-calc');
        let title = "Calculation";
        let desc = "";
        let mathStr = "";
        
        // Position the popup based on mouse click
        let popupW = 310;
        let popupH = 260; // Approximate height
        let px = Math.max(popupW / 2 + 5, Math.min(e.clientX, window.innerWidth - popupW / 2 - 5));
        let py = e.clientY;
        
        if (py < popupH + 30) {
            calcPopup.style.transform = 'translate(-50%, 18px)';
        } else {
            calcPopup.style.transform = 'translate(-50%, -100%) translateY(-18px)';
        }
        calcPopup.style.left = px + 'px';
        calcPopup.style.top = py + 'px';
        
        let now = Date.now();
    let formatDur = (ms) => {
        let hrs = Math.floor(ms/3600000);
        let mins = Math.floor((ms%3600000)/60000);
        return `${hrs}h ${mins}m`;
    };
    
    let formatTime = (ts) => {
        let d = new Date(ts);
        return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ' (Local)';
    };
    
    if (calcType === 'short' || calcType === 'short-m4') {
        let isM4 = calcType === 'short-m4';
        let eqs = isM4 ? earthquakes.filter(eq => eq.mag >= 4.0) : earthquakes;
        let limit = Math.min(5, eqs.length);
        if (limit < 2) {
            desc = "Nicht genug Daten in den letzten 24h.";
        } else {
            let totalDiff = 0;
            for (let i = 0; i < limit - 1; i++) {
                totalDiff += Math.abs(eqs[i].time - eqs[i+1].time);
            }
            let avgDiff = totalDiff / (limit - 1);
            let nextTime = eqs[0].time + avgDiff;
            let timeAgo = now - eqs[0].time;
            
            title = isM4 ? "M4.0+ Short-Term (Last 5)" : "M3.0+ Short-Term (Last 5)";
            desc = `We calculate the time intervals between the last ${limit} earthquakes in this category. The average of these intervals is added to the time of the most recent earthquake to forecast the next statistical release..`;
            mathStr = `Last ${limit} Earthquake analyzed.\n` +
                      `Average-Intervall: ${formatDur(avgDiff)}\n\n` +
                      `last Earthquake: ${formatTime(eqs[0].time)} (${formatDur(timeAgo)} ago)\n` +
                      `Forecast period: ${formatTime(nextTime)}\n`;
        }
    } else if (calcType === 'global' || calcType === 'global-m4') {
        let isM4 = calcType === 'global-m4';
        let eqs = isM4 ? earthquakes.filter(eq => eq.mag >= 4.0) : earthquakes;
        if (eqs.length < 2) {
            desc = "not enough data.";
        } else {
            let oldest = eqs[eqs.length - 1].time;
            let newest = eqs[0].time;
            let timeSpan = newest - oldest;
            let avgDiff = timeSpan / (eqs.length - 1);
            let nextTime = newest + avgDiff;
            
            title = isM4 ? "M4.0+ Global (24H)" : "M3.0+ Global (24H)";
            desc = `We calculate the time intervals between ALL earthquakes (${eqs.length} in total) in this category over the last 24 hours. The global average interval is added to the time of the most recent earthquake.`;
            mathStr = `Number of earthquakes (24h): ${eqs.length}\n` +
                      `Global average: ${formatDur(avgDiff)}\n\n` +
                      `Final Tremor: ${formatTime(newest)}\n` +
                      `Forecast period: ${formatTime(nextTime)}\n`;
        }
    } else if (calcType && calcType.startsWith('7d') || calcType && calcType.startsWith('30d')) {
        let is30 = calcType.startsWith('30d');
        let typeStr = "M3.0+";
        if (calcType.includes('mag5')) typeStr = "M5.0+";
        if (calcType.includes('mag7')) typeStr = "M7.0+";
        if (calcType.includes('deep')) typeStr = "Deep (>150km)";
        
        title = `Long-Term Stats (${is30 ? '30 Days' : '7 Days'} / ${typeStr})`;
        desc = `Here we take all historical data from the last ${is30 ? '30' : '7'} ...days for the selected category. The total time span between the first and last earthquake of these days is divided by the number of intervals to obtain a highly precise, global average interval.`;
        
        let predictedTimeVar = predictedNextTime7d;
        if (calcType === '7d-mag5') predictedTimeVar = predictedNextTime7dMag5;
        if (calcType === '7d-mag7') predictedTimeVar = predictedNextTime7dMag7;
        if (calcType === '30d') predictedTimeVar = predictedNextTime30d;
        if (calcType === '30d-mag5') predictedTimeVar = predictedNextTime30dMag5;
        if (calcType === '30d-mag7') predictedTimeVar = predictedNextTime30dMag7;
        
        if (predictedTimeVar === 0) {
            mathStr = "Calculating data... or insufficient historical data available.";
        } else {
            mathStr = `Historical average loaded from USGS feed.\n` +
                      `Next projected discharge: ${formatTime(predictedTimeVar)}\n\n` +
                      `(Calculation method: Time of the last earthquake in history + calculated average interval of the last ${is30 ? '30' : '7'} Day)`;
        }
    }
    
    document.getElementById('calc-popup-title').textContent = title;
    document.getElementById('calc-popup-desc').innerHTML = desc;
    document.getElementById('calc-popup-math').textContent = mathStr;
    
    // HIER EINFÜGEN: Schiebt das Fenster rechts neben die Seitenleiste
    calcPopup.style.left = '360px'; 
    calcPopup.style.top = Math.max(50, e.clientY - 50) + 'px';
    calcPopup.style.transform = 'none';

    calcPopup.classList.remove('hidden');
});

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
    
    let now = Date.now();
    
    // --- Draw Shock Zones (Radius) ---
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        let ageMs = now - eq.time;
        if (ageMs > 86400000) break; // Only last 24h
        if (eq.mag >= 5.0) {
            let shockRadiusKm = calculateShockRadius(eq.mag);
            let radiusPx = shockRadiusKm * 0.03618 * scale;
            
            let r = ((90.0 - eq.lat) / 180.0) * 723.0;
            let angle = eq.lon * Math.PI / 180.0;
            let px = mapCx + (r * Math.sin(angle)) * scale;
            let py = mapCy + (r * Math.cos(angle)) * scale;
            
            let pulseTimeLocal = (Date.now() / 500) + i;
            let pulseSize = radiusPx + Math.sin(pulseTimeLocal) * (radiusPx * 0.05);
            
            ctx.beginPath();
            ctx.arc(px, py, pulseSize, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 51, 51, 0.05)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 51, 51, 0.3)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
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
    
    // --- Sonar Chain & Shock Triggers ---
    
    // Draw chain reaction lines between consecutive quakes in the last 15 minutes
    for (let i = 0; i < earthquakes.length - 1; i++) {
        let eq1 = earthquakes[i];
        let eq2 = earthquakes[i+1];
        
        let ageMs = now - eq1.time;
        if (ageMs > 900000) break; // Older than 15 mins (chain ends)
        
        let diffMs = Math.abs(eq1.time - eq2.time);
        if (diffMs > 900000) continue; // Only connect if they happened within 15 minutes of each other
        
        let r1 = ((90.0 - eq1.lat) / 180.0) * 723.0;
        let angle1 = eq1.lon * Math.PI / 180.0;
        let px1 = mapCx + (r1 * Math.sin(angle1)) * scale;
        let py1 = mapCy + (r1 * Math.cos(angle1)) * scale;
        
        let r2 = ((90.0 - eq2.lat) / 180.0) * 723.0;
        let angle2 = eq2.lon * Math.PI / 180.0;
        let px2 = mapCx + (r2 * Math.sin(angle2)) * scale;
        let py2 = mapCy + (r2 * Math.cos(angle2)) * scale;
        
        let opacity = Math.max(0.1, 1.0 - (ageMs / 900000));
        
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.strokeStyle = `rgba(0, 255, 204, ${opacity})`; // Cyan trail
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    // Detect & Draw Shock Triggers (Newer quake within Shock Radius of older M5+)
    for (let i = 0; i < earthquakes.length; i++) {
        let newerEq = earthquakes[i];
        if (now - newerEq.time > 86400000) break; // Only check newer quakes from last 24h
        
        for (let j = i + 1; j < earthquakes.length; j++) {
            let olderEq = earthquakes[j];
            if (now - olderEq.time > 86400000 * 2) break; // Check older quakes up to 48h
            
            if (olderEq.mag >= 5.0) {
                let distKm = haversineDistance(newerEq.lat, newerEq.lon, olderEq.lat, olderEq.lon);
                let shockRadius = calculateShockRadius(olderEq.mag);
                
                if (distKm <= shockRadius) {
                    // Trigger detected!
                    let r1 = ((90.0 - newerEq.lat) / 180.0) * 723.0;
                    let angle1 = newerEq.lon * Math.PI / 180.0;
                    let px1 = mapCx + (r1 * Math.sin(angle1)) * scale;
                    let py1 = mapCy + (r1 * Math.cos(angle1)) * scale;
                    
                    let r2 = ((90.0 - olderEq.lat) / 180.0) * 723.0;
                    let angle2 = olderEq.lon * Math.PI / 180.0;
                    let px2 = mapCx + (r2 * Math.sin(angle2)) * scale;
                    let py2 = mapCy + (r2 * Math.cos(angle2)) * scale;
                    
                    ctx.beginPath();
                    ctx.moveTo(px1, py1);
                    ctx.lineTo(px2, py2);
                    ctx.strokeStyle = `rgba(255, 0, 0, 0.8)`; // Bright red trigger line
                    ctx.lineWidth = 3;
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        }
    }
    
    // Draw text for the most recent link only
    if (earthquakes.length >= 2) {
        let eq1 = earthquakes[0];
        let eq2 = earthquakes[1];
        let ageMs = now - eq1.time;
        if (ageMs < 120000) { // Text visible for 2 mins
            let r1 = ((90.0 - eq1.lat) / 180.0) * 723.0;
            let angle1 = eq1.lon * Math.PI / 180.0;
            let px1 = mapCx + (r1 * Math.sin(angle1)) * scale;
            let py1 = mapCy + (r1 * Math.cos(angle1)) * scale;
            
            let r2 = ((90.0 - eq2.lat) / 180.0) * 723.0;
            let angle2 = eq2.lon * Math.PI / 180.0;
            let px2 = mapCx + (r2 * Math.sin(angle2)) * scale;
            let py2 = mapCy + (r2 * Math.cos(angle2)) * scale;
            
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
    
    // Draw Sonar Ripples on quakes < 15 mins old
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        let ageMs = now - eq.time;
        if (ageMs > 900000) break; // Older than 15 mins
        
        let r = ((90.0 - eq.lat) / 180.0) * 723.0;
        let angle = eq.lon * Math.PI / 180.0;
        let px = mapCx + (r * Math.sin(angle)) * scale;
        let py = mapCy + (r * Math.cos(angle)) * scale;
        
        let rippleRadius = (pulseTime * 50) % 150; // Expanding radius
        let rippleOpacity = Math.max(0, 1.0 - (rippleRadius / 150)); // Fade out as it expands
        
        // Also fade out overall based on quake age
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
    
    // Draw Coastlines ON TOP of earthquakes so islands are always visible
    ctx.beginPath();
    ctx.strokeStyle = "rgba(120, 220, 120, 0.8)"; // Brighter green and less transparent
    ctx.lineWidth = 1.5; // Slightly thicker

    // Coastlines now use [lon1, lat1, lon2, lat2] format - same projection as earthquakes
    for (let i = 0; i < coast_lines.length; i++) {
        let l = coast_lines[i];

        // Same azimuthal equidistant projection as earthquakes and tectonic plates
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
    // Draw Autopilot Chain
    if (autopilotChain.length > 1 && autopilotIndex > 0) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 50, 50, 0.9)";
        ctx.lineWidth = 3.0;
        
        let validNodes = Math.min(autopilotIndex, autopilotChain.length - 1);
        for (let i = 0; i <= validNodes; i++) {
            let eq = autopilotChain[i];
            let r = ((90.0 - eq.lat) / 180.0) * 723.0;
            let a = eq.lon * Math.PI / 180.0;
            let px = mapCx + (r * Math.sin(a)) * scale;
            let py = mapCy + (r * Math.cos(a)) * scale;
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        
        for (let i = 0; i <= validNodes; i++) {
            let eq = autopilotChain[i];
            let r = ((90.0 - eq.lat) / 180.0) * 723.0;
            let a = eq.lon * Math.PI / 180.0;
            let px = mapCx + (r * Math.sin(a)) * scale;
            let py = mapCy + (r * Math.cos(a)) * scale;
            
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 0, 0, 1)";
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    requestAnimationFrame(draw);
}
draw();

// ========== Earthquake Popup Logic ==========
function getEqCategory(mag) {
    if (mag >= 8.0) return '🔴 Great (Catastrophic)';
    if (mag >= 7.0) return '🔴 Major (Severe)';
    if (mag >= 6.0) return '🟠 Strong';
    if (mag >= 5.0) return '🟠 Moderate';
    if (mag >= 4.0) return '🟡 Light';
    return '🟡 Minor';
}

function getEqEnergy(mag) {
    // Energy in Joules: 10^(1.5*mag + 4.8)
    let joules = Math.pow(10, 1.5 * mag + 4.8);
    let tntKg = joules / 4.184e6;
    if (tntKg >= 1e9) return (tntKg / 1e9).toFixed(1) + ' Megatons';
    if (tntKg >= 1e6) return (tntKg / 1e6).toFixed(1) + ' Kilotons';
    if (tntKg >= 1e3) return (tntKg / 1e3).toFixed(1) + ' Tons';
    return tntKg.toFixed(0) + ' kg';
}

function formatAge(ms) {
    let secs = Math.floor(ms / 1000);
    let mins = Math.floor(secs / 60);
    let hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m ago`;
    if (mins > 0) return `${mins}m ${secs % 60}s ago`;
    return `${secs}s ago`;
}

function showEqPopup(eq, screenX, screenY) {
    selectedEq = eq;
    
    // Magnitude color
    let magColor, magClass;
    if (eq.mag >= 5.0) { magColor = '#ff3333'; magClass = 'mag-high'; }
    else if (eq.mag >= 3.0) { magColor = '#ff8800'; magClass = 'mag-mid'; }
    else { magColor = '#c8c800'; magClass = 'mag-low'; }
    
    let magEl = document.getElementById('eq-popup-mag');
    magEl.textContent = `M ${eq.mag.toFixed(1)}`;
    magEl.style.color = magColor;
    
    eqPopup.className = 'eq-popup ' + magClass;
    
    document.getElementById('eq-popup-place').textContent = eq.place || 'Unknown Location';
    
    let latDir = eq.lat >= 0 ? 'N' : 'S';
    let lonDir = eq.lon >= 0 ? 'E' : 'W';
    document.getElementById('eq-popup-coords').textContent = 
        `${Math.abs(eq.lat).toFixed(4)}°${latDir}, ${Math.abs(eq.lon).toFixed(4)}°${lonDir}`;
    
    let depthText = eq.depth.toFixed(1) + ' km';
    if (eq.depth >= 150) depthText += ' ⚠️ DEEP';
    else if (eq.depth >= 70) depthText += ' (Intermediate)';
    else depthText += ' (Shallow)';
    document.getElementById('eq-popup-depth').textContent = depthText;
    
    let d = new Date(eq.time);
    document.getElementById('eq-popup-time').textContent = 
        d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    document.getElementById('eq-popup-time-local').textContent = 
        d.toLocaleString();
    
    document.getElementById('eq-popup-age').textContent = formatAge(Date.now() - eq.time);
    document.getElementById('eq-popup-category').textContent = getEqCategory(eq.mag);
    document.getElementById('eq-popup-energy').textContent = getEqEnergy(eq.mag);
    
    let shockRadiusText = "N/A";
    if (eq.mag >= 3.0) {
        let r = calculateShockRadius(eq.mag);
        shockRadiusText = r > 20000 ? "GLOBAL" : `~${Math.round(r).toLocaleString()} km`;
    }
    document.getElementById('eq-popup-shock').textContent = shockRadiusText;
    
    // Position popup above the clicked point, keep within viewport
    let popupW = 310;
    let popupH = 260;
    let px = Math.max(popupW / 2 + 5, Math.min(screenX, window.innerWidth - popupW / 2 - 5));
    let py = screenY;
    
    // If too close to top, show below instead
    if (py < popupH + 30) {
        eqPopup.style.transform = 'translate(-50%, 18px)';
        eqPopup.querySelector('.eq-popup-arrow').style.cssText = 
            'position:absolute;top:-8px;bottom:auto;left:50%;transform:translateX(-50%);' +
            'width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;' +
            'border-bottom:8px solid rgba(15,15,25,0.95);border-top:none;';
    } else {
        eqPopup.style.transform = 'translate(-50%, -100%) translateY(-18px)';
        eqPopup.querySelector('.eq-popup-arrow').style.cssText = 
            'position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);' +
            'width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;' +
            'border-top:8px solid rgba(15,15,25,0.95);';
    }
    
    eqPopup.style.left = px + 'px';
    eqPopup.style.top = py + 'px';
    eqPopup.classList.remove('hidden');
}

function selectEqFromList(eq) {
    if (gaiaPopup && !gaiaPopup.classList.contains('hidden')) gaiaPopup.classList.add('hidden');
    let calcPopup = document.getElementById('calc-popup');
    if (calcPopup && !calcPopup.classList.contains('hidden')) calcPopup.classList.add('hidden');
    
    let r = ((90.0 - eq.lat) / 180.0) * 723.0;
    let angle = eq.lon * Math.PI / 180.0;
    let map_x = r * Math.sin(angle);
    let map_y = r * Math.cos(angle);
    
    zoom = 10.0;
    let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    offsetX = -map_x * targetScale;
    offsetY = -map_y * targetScale;
    
    //    offsetY = -map_y * targetScale;
    
    stopAutopilot(true);
    
    showEqPopup(eq, width / 2, height / 2);
}

function hideEqPopup() {
    eqPopup.classList.add('hidden');
    selectedEq = null;
}

function findEqAtPoint(clientX, clientY) {
    let rect = canvas.getBoundingClientRect();
    let clickX = (clientX - rect.left) * (canvas.width / rect.width);
    let clickY = (clientY - rect.top) * (canvas.height / rect.height);
    
    let mapCx = width / 2 + offsetX;
    let mapCy = height / 2 + offsetY;
    let scale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    
    let closest = null;
    let closestDist = Infinity;
    
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        let r = ((90.0 - eq.lat) / 180.0) * 723.0;
        let angle = eq.lon * Math.PI / 180.0;
        let px = mapCx + (r * Math.sin(angle)) * scale;
        let py = mapCy + (r * Math.cos(angle)) * scale;
        
        let dx = clickX - px;
        let dy = clickY - py;
        let dist = Math.sqrt(dx * dx + dy * dy);
        
        // Hit area: at least 15px or the dot size, whichever is bigger
        let hitRadius = Math.max(15, eq.mag * 2 * zoom);
        if (dist < hitRadius && dist < closestDist) {
            closest = eq;
            closestDist = dist;
        }
    }
    return closest;
}

// Controls
document.getElementById('btn-zoomin').addEventListener('click', () => { zoom *= 1.3; });
document.getElementById('btn-zoomout').addEventListener('click', () => { zoom /= 1.3; if(zoom < 0.2) zoom = 0.2; });
document.getElementById('btn-reset').addEventListener('click', () => { zoom = 1.0; offsetX = 0; offsetY = 0; hideEqPopup(); });

// Popup close button
document.getElementById('eq-popup-close').addEventListener('click', (e) => {
    e.stopPropagation();
    hideEqPopup();
});
document.getElementById('eq-popup-close').addEventListener('mousedown', (e) => {
    e.stopPropagation(); // Prevent dragging when clicking close
});
document.getElementById('eq-popup-close').addEventListener('touchstart', (e) => {
    e.stopPropagation();
}, {passive: true});

// Touch & Drag (with click detection)
canvas.addEventListener('mousedown', e => {
    isDragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
});
window.addEventListener('mouseup', (e) => {
    let dx = e.clientX - mouseDownX;
    let dy = e.clientY - mouseDownY;
    let dragDist = Math.sqrt(dx * dx + dy * dy);
    
    // Only treat as click if mouse didn't move much (not a drag)
    if (dragDist < 5 && isDragging) {
        let eq = findEqAtPoint(e.clientX, e.clientY);
        if (eq) {
            showEqPopup(eq, e.clientX, e.clientY);
        } else {
            hideEqPopup();
        }
    }
    isDragging = false;
});
window.addEventListener('mousemove', e => {
    if (isDragging) {
        offsetX = e.clientX - startX;
        offsetY = e.clientY - startY;
    }
});

let lastTouchDistance = 0;
let touchStartX = 0, touchStartY = 0;
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
        isDragging = true;
        startX = e.touches[0].clientX - offsetX;
        startY = e.touches[0].clientY - offsetY;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        let dx = e.touches[0].clientX - e.touches[1].clientX;
        let dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx*dx + dy*dy);
    }
});
window.addEventListener('touchend', e => {
    if (e.touches.length < 2) lastTouchDistance = 0;
    if (e.touches.length === 0) {
        // Check for tap (no drag)
        if (isDragging) {
            let ct = e.changedTouches[0];
            let dx = ct.clientX - touchStartX;
            let dy = ct.clientY - touchStartY;
            if (Math.sqrt(dx*dx + dy*dy) < 10) {
                let eq = findEqAtPoint(ct.clientX, ct.clientY);
                if (eq) {
                    showEqPopup(eq, ct.clientX, ct.clientY);
                } else {
                    hideEqPopup();
                }
            }
        }
        isDragging = false;
    }
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

document.querySelectorAll('.eq-popup').forEach(popup => {
    const header = popup.querySelector('.eq-popup-header');
    if (!header) return;
    
    let isDragging = false, startX, startY, initialLeft, initialTop;
    
    const startDrag = (clientX, clientY) => {
        isDragging = true;
        header.style.cursor = 'grabbing';
        startX = clientX;
        startY = clientY;
        initialLeft = popup.offsetLeft;
        initialTop = popup.offsetTop;
        // Verhindert, dass CSS-Transforms die Positionierung stören
        popup.style.transform = 'none'; 
        popup.style.margin = '0';
    };

    const onDrag = (clientX, clientY) => {
        if (!isDragging) return;
        popup.style.left = (initialLeft + (clientX - startX)) + 'px';
        popup.style.top = (initialTop + (clientY - startY)) + 'px';
    };

    const stopDrag = () => {
        isDragging = false;
        header.style.cursor = 'grab';
    };

    // Maus-Events (Desktop)
    header.addEventListener('mousedown', e => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => onDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', stopDrag);

    // Touch-Events (Mobile/Webcode)
    header.addEventListener('touchstart', e => {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, {passive: true});
    window.addEventListener('touchmove', e => {
        if (!isDragging) return;
        onDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, {passive: true});
    window.addEventListener('touchend', stopDrag);
});

// ========== Search & Filter Panel Logic ==========
const searchToggleBtn = document.getElementById('btn-search-toggle');
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('eq-search-input');
const searchTabs = document.querySelectorAll('.search-tab');
const searchResultsList = document.getElementById('search-results-list');

let currentSearchMag = 3; // Default

if (searchToggleBtn && searchPanel) {
    searchToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchPanel.classList.toggle('hidden');
        if (!searchPanel.classList.contains('hidden')) {
            renderSearchResults();
            searchInput.focus();
        }
    });
    
    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!searchPanel.classList.contains('hidden') && 
            !searchPanel.contains(e.target) && 
            e.target !== searchToggleBtn) {
            searchPanel.classList.add('hidden');
        }
    });
}

searchTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        searchTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentSearchMag = parseFloat(tab.getAttribute('data-mag'));
        renderSearchResults();
    });
});

if (searchInput) {
    searchInput.addEventListener('input', () => {
        renderSearchResults();
    });
}

function renderSearchResults() {
    if (!searchResultsList) return;
    
    let allEqs = [];
    
    // Combine data based on selected mag
    if (currentSearchMag < 5) {
        allEqs = globalMonthEqs || [];
    } else if (currentSearchMag >= 5 && currentSearchMag < 7) {
        allEqs = historicalM5Eqs || [];
    } else if (currentSearchMag >= 7 && currentSearchMag < 8) {
        allEqs = historicalM7Eqs || [];
    } else if (currentSearchMag >= 8) {
        allEqs = historicalM8Eqs || [];
    }
    
    if (allEqs.length === 0) {
        searchResultsList.innerHTML = '<li>Fetching data... please wait.</li>';
        return;
    }

    // Filter by magnitude
    let filtered = allEqs.filter(eq => eq.mag >= currentSearchMag);
    
    // Filter by text search
    let query = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (query) {
        filtered = filtered.filter(eq => eq.place && eq.place.toLowerCase().includes(query));
    }
    
    // Sort just to be sure
    filtered.sort((a,b) => b.time - a.time);
    
    // Take top 500 max to avoid DOM overload
    filtered = filtered.slice(0, 500);
    
    searchResultsList.innerHTML = '';
    
    if (filtered.length === 0) {
        searchResultsList.innerHTML = '<li>No earthquakes found.</li>';
        return;
    }
    
    let totalCount = filtered.length;
    filtered.forEach((eq, index) => {
        let li = document.createElement('li');
        li.id = 'search-eq-item-' + eq.id;
        let d = new Date(eq.time);
        let timeStr = d.toISOString().split('T')[0] + " " + d.toISOString().split('T')[1].substring(0,5);
        let magColor = eq.mag >= 7.0 ? '#ff3333' : (eq.mag >= 5.0 ? '#ff8800' : '#00ffcc');
        
        let displayNum = totalCount - index;
        li.innerHTML = `<span style="color:#888; font-weight:bold; margin-right:5px;">#${displayNum}</span> [${timeStr}] <span style="color:${magColor};font-weight:bold;">M${eq.mag.toFixed(1)}</span> - ${eq.place}`;
        
        li.addEventListener('click', () => {
            // Pan to eq
            offsetX = 0; offsetY = 0; zoom = 10;
            let targetR = ((90.0 - eq.lat) / 180.0) * 723.0;
            let targetAngle = eq.lon * Math.PI / 180.0;
            
            let scale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
            let tx = targetR * Math.sin(targetAngle) * scale;
            let ty = targetR * Math.cos(targetAngle) * scale;
            
            offsetX = -tx / zoom;
            offsetY = -ty / zoom;
            
            // Show popup
            updateEqPopup(eq, window.innerWidth / 2, window.innerHeight / 2);
            eqPopup.classList.remove('hidden');
            searchPanel.classList.add('hidden'); // Close panel after click
        });
        
        searchResultsList.appendChild(li);
    });
}

// ========== Cinematic Autopilot (Pattern Discovery) ==========

function resetIdleTimer() {
    lastInteractionTime = Date.now();
    if (isAutopilotActive) {
        stopAutopilot();
    }
}

// Listen to interactions
window.addEventListener('mousemove', resetIdleTimer);
window.addEventListener('mousedown', resetIdleTimer);
window.addEventListener('touchstart', resetIdleTimer, {passive: true});
window.addEventListener('keydown', resetIdleTimer);
window.addEventListener('wheel', resetIdleTimer, {passive: true});

function stopAutopilot(clearChain = false) {
    isAutopilotActive = false;
    if (clearChain) {
        autopilotChain = [];
        autopilotIndex = 0;
    }
    if (autopilotInterval) clearInterval(autopilotInterval);
    autopilotInterval = null;
    if (eqPopup) eqPopup.classList.add('hidden');
}

function startAutopilot() {
    if (isAutopilotActive || earthquakes.length === 0) return;
    isAutopilotActive = true;
    
    // Get last 10 quakes, reverse to go oldest -> newest
    autopilotChain = earthquakes.slice(0, 10).reverse();
    autopilotIndex = 0;
    
    function nextAutopilotStep() {
        if (!isAutopilotActive) return;
        
        if (autopilotIndex >= autopilotChain.length) {
            // Finished sequence. Stop interval, but keep isAutopilotActive = true 
            // so the idle timer doesn't immediately restart it.
            if (autopilotInterval) clearInterval(autopilotInterval);
            autopilotInterval = null;
            return;
        }
        
        let targetEq = autopilotChain[autopilotIndex];
        
        // Pan to targetEq (ohne zoom modification)
        let targetR = ((90.0 - targetEq.lat) / 180.0) * 723.0;
        let targetAngle = targetEq.lon * Math.PI / 180.0;
        
        let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
        offsetX = -(targetR * Math.sin(targetAngle)) * targetScale;
        offsetY = -(targetR * Math.cos(targetAngle)) * targetScale;
        
        // Show popup
        showEqPopup(targetEq, window.innerWidth / 2, window.innerHeight / 2);
        
        // Highlight in list
        document.querySelectorAll('#search-results-list li, #eq-list li').forEach(li => li.classList.remove('active'));
        
        let searchLi = document.getElementById('search-eq-item-' + targetEq.id);
        if (searchLi) {
            searchLi.classList.add('active');
            searchLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        let mainLi = document.getElementById('main-eq-item-' + targetEq.id);
        if (mainLi) {
            mainLi.classList.add('active');
            mainLi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        autopilotIndex++;
    }
    
    nextAutopilotStep();
    autopilotInterval = setInterval(nextAutopilotStep, 6000); // 6 seconds per quake
}

// Idle checker
setInterval(() => {
    if (Date.now() - lastInteractionTime > 120000 && !isAutopilotActive) {
        startAutopilot();
    }
}, 5000);
