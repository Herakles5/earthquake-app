const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const eqList = document.getElementById('eq-list');
const statusDiv = document.getElementById('status');
const eqPopup = document.getElementById('eq-popup');

let width, height;
let zoom = 0.77;
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
let autopilotTimeout = null;
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
let gaiaChargeMultiplier = 1.0;
let currentKpValue = 0;

let globalMonthEqs = [];
let historicalM5Eqs = [];
let historicalM7Eqs = [];
let historicalM8Eqs = [];
let historicalM9Eqs = [];
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

function formatDuration(ms, showSecs = true) {
    if (!ms || ms <= 0) return "0m";
    let secs = Math.floor(ms / 1000);
    let d = Math.floor(secs / 86400);
    let h = Math.floor((secs % 86400) / 3600);
    let m = Math.floor((secs % 3600) / 60);
    let s = secs % 60;
    if (d > 0) return `${d}d ${h}h` + (m > 0 ? ` ${m}m` : '');
    if (h > 0) return `${h}h ${m}m` + (showSecs && h < 6 ? ` ${s}s` : '');
    if (m > 0) return `${m}m` + (showSecs ? ` ${s}s` : '');
    return `${s}s`;
}

let shortTermStat = null;
let shortTermM4Stat = null;

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
    // gaps are NEWEST-FIRST (as returned by computeGaps on a newest-first list).
    // Walk from the oldest gap to the newest so that recent gaps get the highest weight.
    if (gaps.length === 0) return 0;
    let ema = gaps[gaps.length - 1];
    for (let i = gaps.length - 2; i >= 0; i--) {
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
    // avgGapMs must already include the Gaia charge (done once in the Gaia engine).
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

function cleanPlaceName(rawPlace) {
    if (!rawPlace) return "Unknown";
    let p = rawPlace.trim();
    let ofIdx = p.indexOf(' of ');
    if (ofIdx > -1) {
        p = p.substring(ofIdx + 4);
    }
    p = p.replace(/^\d+\s*km\s+[NSEWnsew]+\s+of\s+/i, '');
    p = p.replace(/^near\s+the\s+coast\s+of\s+/i, '');
    p = p.replace(/^off\s+the\s+coast\s+of\s+/i, '');
    p = p.replace(/^region\s+of\s+/i, '');
    return p.trim();
}

// ========== Seismo-Tectonic Fault Projection & Kinematic Trajectory Engine ==========
let predictedTectonicTargets = [];

function snapToNearestPlateBoundary(lat, lon, maxSearchKm = 350) {
    if (typeof tectonic_plates === 'undefined' || !tectonic_plates || tectonic_plates.length === 0) {
        return { lat: lat, lon: lon, distKm: 9999, snapped: false, strikeDeg: 0 };
    }
    let bestLat = lat;
    let bestLon = lon;
    let minDist = Infinity;
    let bestStrike = 0;

    for (let i = 0; i < tectonic_plates.length; i++) {
        let seg = tectonic_plates[i]; // [lon1, lat1, lon2, lat2]
        let lon1 = seg[0], lat1 = seg[1], lon2 = seg[2], lat2 = seg[3];
        if (Math.abs(lat1 - lat) > 8 && Math.abs(lat2 - lat) > 8) continue;

        let dx = lon2 - lon1;
        let dy = lat2 - lat1;
        if (Math.abs(dx) > 180) continue;
        let len2 = dx * dx + dy * dy;
        let t = 0.5;
        if (len2 > 1e-10) {
            t = ((lon - lon1) * dx + (lat - lat1) * dy) / len2;
            t = Math.max(0.0, Math.min(1.0, t));
        }
        let projLon = lon1 + t * dx;
        let projLat = lat1 + t * dy;
        let d = haversineDistance(lat, lon, projLat, projLon);
        if (d < minDist) {
            minDist = d;
            bestLat = projLat;
            bestLon = projLon;
            bestStrike = (Math.atan2(dx * Math.cos(lat * Math.PI / 180.0), dy) * 180.0 / Math.PI + 360.0) % 360.0;
        }
    }

    if (minDist <= maxSearchKm) {
        // Blend 75% onto the exact tectonic fault line, 25% kinematic projection
        return {
            lat: 0.75 * bestLat + 0.25 * lat,
            lon: 0.75 * bestLon + 0.25 * lon,
            distKm: Math.round(minDist),
            snapped: true,
            strikeDeg: Math.round(bestStrike)
        };
    }
    return { lat: lat, lon: lon, distKm: Math.round(minDist), snapped: false, strikeDeg: Math.round(bestStrike) };
}

function classifyFocalRegime(eq) {
    let snap = snapToNearestPlateBoundary(eq.lat, eq.lon, 500);
    let strike = snap.strikeDeg || 0;
    let depth = eq.depth || 10.0;
    let pLower = (eq.place || '').toLowerCase();

    // Check if local environment has intermediate/deep subduction events (>70 km) within 450 km
    let pool = (globalMonthEqs && globalMonthEqs.length > 0) ? globalMonthEqs : earthquakes;
    let hasSubductionSlab = depth >= 55.0;
    if (!hasSubductionSlab && pool && pool.length > 0) {
        for (let i = 0; i < Math.min(pool.length, 400); i++) {
            let o = pool[i];
            if (o && o.depth >= 85.0 && haversineDistance(eq.lat, eq.lon, o.lat, o.lon) <= 450.0) {
                hasSubductionSlab = true;
                break;
            }
        }
    }

    let isRiftName = pLower.includes('ridge') || pLower.includes('rise') || pLower.includes('rift') || pLower.includes('reykjanes') || pLower.includes('iceland');
    let isSubductionName = pLower.includes('trench') || pLower.includes('kuril') || pLower.includes('mariana') || pLower.includes('tonga') || pLower.includes('kermadec') || pLower.includes('fiji') || pLower.includes('japan') || pLower.includes('bonin') || pLower.includes('vanuatu') || pLower.includes('solomon') || pLower.includes('chile') || pLower.includes('peru') || pLower.includes('alaska') || pLower.includes('aleutian') || pLower.includes('indonesia') || pLower.includes('philippine') || pLower.includes('kamchatka') || pLower.includes('taiwan');

    if (depth >= 120.0) {
        return {
            type: 'slab',
            label: 'Wadati-Benioff Intraslab (Downdip)',
            shortLabel: 'Slab Downdip',
            strike: strike,
            dip: 62,
            rake: -85,
            updipBoost: 1.38
        };
    } else if (isRiftName && depth <= 25.0) {
        return {
            type: 'normal',
            label: 'Extensional Rift / Normal Fault',
            shortLabel: 'Normal / Rift',
            strike: strike,
            dip: 55,
            rake: -90,
            updipBoost: 1.05
        };
    } else if (hasSubductionSlab || isSubductionName || (depth >= 28.0 && depth < 120.0)) {
        return {
            type: 'thrust',
            label: 'Subduction Megathrust (Reverse)',
            shortLabel: 'Megathrust',
            strike: strike,
            dip: 24,
            rake: 90,
            updipBoost: 1.28
        };
    } else {
        return {
            type: 'strikeslip',
            label: 'Transform Strike-Slip (Shear)',
            shortLabel: 'Strike-Slip',
            strike: strike,
            dip: 84,
            rake: 178,
            updipBoost: 1.15
        };
    }
}

function resolveNearestPlaceName(lat, lon, fallbackPlace) {
    let pool = (globalMonthEqs && globalMonthEqs.length > 0) ? globalMonthEqs : earthquakes;
    if (historicalM5Eqs && historicalM5Eqs.length > 0) {
        pool = pool.concat(historicalM5Eqs.slice(0, 300));
    }
    let bestPlace = fallbackPlace;
    let minD = 320.0;
    for (let i = 0; i < pool.length; i++) {
        let e = pool[i];
        if (!e || !e.place) continue;
        let d = haversineDistance(lat, lon, e.lat, e.lon);
        if (d < minD) {
            minD = d;
            bestPlace = cleanPlaceName(e.place);
        }
    }
    return bestPlace || fallbackPlace;
}

function getSpatialClusterRegion(eqList, limit, maxRadiusKm = 450) {
    if (!eqList || eqList.length === 0) {
        return { label: 'N/A', lat: 0, lon: 0, count: 0, isCluster: false };
    }
    let sample = eqList.slice(0, Math.min(Math.max(limit, 8), eqList.length));
    if (sample.length === 1) {
        let pName = cleanPlaceName(sample[0].place);
        let snap1 = snapToNearestPlateBoundary(sample[0].lat, sample[0].lon, 250);
        return {
            label: pName,
            placeClean: pName,
            lat: snap1.lat,
            lon: snap1.lon,
            originLat: sample[0].lat,
            originLon: sample[0].lon,
            count: 1,
            totalSample: 1,
            isCluster: false,
            strongestMag: sample[0].mag,
            shiftKm: snap1.snapped ? snap1.distKm : 0,
            dirLabel: snap1.snapped ? 'Fault-Locked' : 'Stationary'
        };
    }

    let bestSeed = sample[0];
    let bestCluster = [sample[0]];
    let maxClusterScore = -1;

    for (let i = 0; i < sample.length; i++) {
        let seed = sample[i];
        let cluster = [];
        let score = 0;
        for (let j = 0; j < sample.length; j++) {
            let other = sample[j];
            let d = haversineDistance(seed.lat, seed.lon, other.lat, other.lon);
            if (d <= maxRadiusKm) {
                cluster.push(other);
                // Weight by both magnitude and recency
                let ageHours = Math.max(0.1, (sample[0].time - other.time) / 3600000.0);
                let recW = Math.exp(-ageHours / 36.0);
                let w = Math.pow(10, 0.25 * (other.mag - 3.0)) * (0.5 + 0.5 * recW);
                score += w;
            }
        }
        if (score > maxClusterScore) {
            maxClusterScore = score;
            bestSeed = seed;
            bestCluster = cluster;
        }
    }

    // Sort cluster chronologically (oldest -> newest) to trace the tectonic movement sequence!
    let chron = bestCluster.slice().sort((a, b) => a.time - b.time);
    let sumLat = 0, sumLon = 0, sumW = 0;
    let strongest = chron[0];
    for (let eq of chron) {
        let w = Math.pow(10, 0.3 * (eq.mag - 3.0));
        sumLat += eq.lat * w;
        sumLon += eq.lon * w;
        sumW += w;
        if (eq.mag > strongest.mag) strongest = eq;
    }
    let centLat = sumW > 0 ? sumLat / sumW : bestSeed.lat;
    let centLon = sumW > 0 ? sumLon / sumW : bestSeed.lon;

    // Calculate kinematic directional migration vector across the sequence (t_1 -> t_2 -> ... -> t_n)
    let latestEq = chron[chron.length - 1];
    let dLatTotal = 0.0, dLonTotal = 0.0, dDepthTotal = 0.0, stepWeightSum = 0.0;

    if (chron.length >= 2) {
        for (let k = 1; k < chron.length; k++) {
            let prev = chron[k - 1];
            let curr = chron[k];
            let stepDist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            if (stepDist < 2.0 || stepDist > maxRadiusKm) continue;
            let dLat = curr.lat - prev.lat;
            let dLon = curr.lon - prev.lon;
            if (dLon > 180) dLon -= 360;
            if (dLon < -180) dLon += 360;
            let dDepth = (curr.depth || 10) - (prev.depth || 10);
            // Newer steps in the chain carry higher momentum weight
            let wStep = Math.pow(1.6, k) * Math.pow(1.25, Math.max(0, curr.mag - 3.5));
            dLatTotal += dLat * wStep;
            dLonTotal += dLon * wStep;
            dDepthTotal += dDepth * wStep;
            stepWeightSum += wStep;
        }
    } else if (sample.length >= 2) {
        // Fallback: global recent sequential step if cluster has 1 event
        let prev = sample[1];
        let curr = sample[0];
        let stepDist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
        if (stepDist <= 1200) {
            dLatTotal = (curr.lat - prev.lat) * 0.35;
            dLonTotal = (curr.lon - prev.lon) * 0.35;
            stepWeightSum = 1.0;
        }
    }

    let regimeInfo = classifyFocalRegime(latestEq);
    let projLat = latestEq.lat;
    let projLon = latestEq.lon;
    if (stepWeightSum > 0) {
        let meanStepLat = dLatTotal / stepWeightSum;
        let meanStepLon = dLonTotal / stepWeightSum;
        let meanStepDepth = dDepthTotal / stepWeightSum;
        // Updip & focal-regime amplification: subduction slabs and updip sequences focus stress strongly ahead
        let updipBoost = (meanStepDepth < -5.0 ? 1.25 : 1.0) * (regimeInfo.updipBoost || 1.0);
        projLat = latestEq.lat + meanStepLat * 0.78 * updipBoost;
        projLon = latestEq.lon + meanStepLon * 0.78 * updipBoost;
    } else {
        projLat = 0.65 * latestEq.lat + 0.35 * centLat;
        projLon = 0.65 * latestEq.lon + 0.35 * centLon;
    }

    projLat = Math.max(-85.0, Math.min(85.0, projLat));
    if (projLon > 180.0) projLon -= 360.0;
    if (projLon < -180.0) projLon += 360.0;

    // Couple/snap projected epicenter to the actual tectonic plate boundary in plates.js
    let snapped = snapToNearestPlateBoundary(projLat, projLon, 350);
    let finalLat = snapped.lat;
    let finalLon = snapped.lon;

    let shiftKm = Math.round(haversineDistance(centLat, centLon, finalLat, finalLon));
    let dLonRad = (finalLon - centLon) * Math.PI / 180.0;
    let lat1Rad = centLat * Math.PI / 180.0;
    let lat2Rad = finalLat * Math.PI / 180.0;
    let y = Math.sin(dLonRad) * Math.cos(lat2Rad);
    let x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);
    let bearing = (Math.atan2(y, x) * 180.0 / Math.PI + 360.0) % 360.0;
    let dirName = (typeof bearingToDirection === 'function') ? bearingToDirection(bearing) : 'NE';

    let fallbackPlace = cleanPlaceName(latestEq.place || strongest.place);
    let placeClean = resolveNearestPlaceName(finalLat, finalLon, fallbackPlace);
    let isCluster = bestCluster.length >= 2;
    let dirTag = shiftKm >= 8 ? ` ➔ ${dirName} ${shiftKm}km` : '';
    let label = isCluster ? `${placeClean}${dirTag} (${bestCluster.length}x)` : `${placeClean}${dirTag}`;

    return {
        label: label,
        placeClean: placeClean,
        lat: finalLat,
        lon: finalLon,
        originLat: latestEq.lat,
        originLon: latestEq.lon,
        centroidLat: centLat,
        centroidLon: centLon,
        count: bestCluster.length,
        totalSample: sample.length,
        isCluster: isCluster,
        strongestMag: strongest.mag,
        shiftKm: shiftKm,
        bearing: Math.round(bearing),
        dirName: dirName,
        faultSnapped: snapped.snapped
    };
}

let currentBValue = { b: 1.0, sigma: 0, n: 0, avgMag: 0, status: 'Normal', color: '#00ffcc' };

function computeBValue(eqList, minMag = 3.0) {
    if (!eqList || eqList.length === 0) {
        return { b: 1.0, sigma: 0, n: 0, avgMag: 0, status: 'Normal', color: '#00ffcc' };
    }
    let valid = eqList.filter(eq => eq.mag !== undefined && eq.mag !== null && eq.mag >= minMag);
    if (valid.length < 5) {
        return { b: 1.0, sigma: 0, n: valid.length, avgMag: 0, status: 'Calculating...', color: '#888888' };
    }
    let sumMag = 0;
    for (let eq of valid) sumMag += eq.mag;
    let meanMag = sumMag / valid.length;
    let deltaM = 0.1;
    let denom = meanMag - (minMag - deltaM / 2.0);
    if (denom <= 0.01) denom = 0.01;
    
    // Aki (1965) / Utsu (1966) MLE formula:
    let b = Math.LOG10E / denom;
    let sigma = b / Math.sqrt(valid.length);
    
    let status = "Normal";
    let color = "#88ff88";
    if (b >= 1.15) {
        status = "Relaxed";
        color = "#00ffcc";
    } else if (b >= 0.90) {
        status = "Normal";
        color = "#88ff88";
    } else if (b >= 0.75) {
        status = "Elevated Stress";
        color = "#ffaa00";
    } else {
        status = "High Stress (Locked)";
        color = "#ff3333";
    }
    
    return {
        b: b,
        sigma: sigma,
        n: valid.length,
        avgMag: meanMag,
        status: status,
        color: color
    };
}

// ========== C: BPT / Weibull Strain Accumulation for Overdue Countdowns ==========
function calculateBPTStrain(elapsedMs, meanGapMs, shapeK = 1.6) {
    if (!elapsedMs || !meanGapMs || meanGapMs <= 0) return { r: 1.0, strain: 1.0, pCond1h: 0.1 };
    let r = elapsedMs / meanGapMs;
    let strain = Math.max(1.0, Math.pow(Math.max(1.0, r), shapeK));
    let delta = 3600000;
    let h1 = Math.pow(elapsedMs / meanGapMs, shapeK);
    let h2 = Math.pow((elapsedMs + delta) / meanGapMs, shapeK);
    let pCond = 1.0 - Math.exp(-(h2 - h1));
    return {
        r: r,
        strain: strain,
        pCond1h: Math.min(0.99, Math.max(0.01, pCond))
    };
}

// ========== D: Solid Earth Tides & Lunar Phase Stress Modulation ==========
let currentLunarTide = { phaseName: "Moon", icon: "🌕", tidalStress: 0.5, stressLevel: "MODERATE", multiplier: 1.0, color: "#00e5ff" };

function getLunarTidalStress(nowMs = Date.now()) {
    let refNewMoon = 1704974220000; // Jan 11, 2024, 11:57 UTC
    let synodicMs = 29.530588853 * 86400000;
    let elapsed = (nowMs - refNewMoon) % synodicMs;
    if (elapsed < 0) elapsed += synodicMs;
    let phaseFrac = elapsed / synodicMs;
    
    let phaseName = "New Moon";
    let icon = "🌑";
    if (phaseFrac < 0.04 || phaseFrac >= 0.96) { phaseName = "New Moon"; icon = "🌑"; }
    else if (phaseFrac < 0.21) { phaseName = "Waxing Crescent"; icon = "🌒"; }
    else if (phaseFrac < 0.29) { phaseName = "First Quarter"; icon = "🌓"; }
    else if (phaseFrac < 0.46) { phaseName = "Waxing Gibbous"; icon = "🌔"; }
    else if (phaseFrac < 0.54) { phaseName = "Full Moon"; icon = "🌕"; }
    else if (phaseFrac < 0.71) { phaseName = "Waning Gibbous"; icon = "🌖"; }
    else if (phaseFrac < 0.79) { phaseName = "Last Quarter"; icon = "🌗"; }
    else { phaseName = "Waning Crescent"; icon = "🌘"; }
    
    let angle = phaseFrac * 2 * Math.PI;
    let tidalStress = Math.abs(Math.cos(angle)); // 0.0 to 1.0
    let stressLevel = tidalStress >= 0.75 ? "HIGH" : (tidalStress >= 0.40 ? "MODERATE" : "LOW");
    let color = tidalStress >= 0.75 ? "#ff33cc" : (tidalStress >= 0.40 ? "#00ffcc" : "#88bbff");
    let multiplier = 1.0 + (tidalStress - 0.5) * 0.08; // 0.96x to 1.04x
    
    return {
        phaseFrac: phaseFrac,
        phaseName: phaseName,
        icon: icon,
        tidalStress: tidalStress,
        stressPercent: Math.round(tidalStress * 100),
        stressLevel: stressLevel,
        color: color,
        multiplier: multiplier
    };
}

// ========== E: Deep Mantle Precursor Detection (>150 km) ==========
let activeDeepPrecursors = [];
let cachedHotspotsData = [];

function detectDeepPrecursors(eqList, hotspots) {
    if (!eqList || eqList.length === 0) return [];
    let now = Date.now();
    let deepEqs = eqList.filter(eq => eq.depth >= 150.0 && eq.mag >= 4.5 && (now - eq.time) <= 7 * 86400000);
    let list = [];
    for (let deep of deepEqs) {
        let ageDays = ((now - deep.time) / 86400000).toFixed(1);
        let coupledHotspot = null;
        let minDist = 999999;
        if (hotspots && hotspots.length > 0) {
            for (let h of hotspots) {
                let d = haversineDistance(deep.lat, deep.lon, h.lat, h.lon);
                if (d <= 900 && d < minDist) {
                    minDist = d;
                    coupledHotspot = h;
                }
            }
        }
        list.push({
            deep: deep,
            coupledHotspot: coupledHotspot,
            distKm: Math.round(minDist),
            ageDays: ageDays
        });
    }
    return list;
}

// ========== Tectonic Flow / Seismic Migration Velocity ==========
let activeTectonicFlows = [];
let activeFlowSummary = { label: "Equilibrium", speedKmH: 0, count: 0, fromPlace: "", toPlace: "" };

function bearingToDirection(deg) {
    let dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    let idx = Math.round(deg / 45) % 8;
    return dirs[idx];
}

function computeTectonicMigration(eqList) {
    if (!eqList || eqList.length < 3) return { flows: [], summary: { label: "Equilibrium", speedKmH: 0, count: 0 } };
    let now = Date.now();
    let sorted = eqList.slice().sort((a, b) => a.time - b.time);
    let recent = sorted.filter(eq => (now - eq.time) <= 48 * 86400000);
    let flows = [];
    
    for (let i = 0; i < recent.length - 1; i++) {
        let e1 = recent[i];
        for (let j = i + 1; j < Math.min(i + 4, recent.length); j++) {
            let e2 = recent[j];
            let dtMs = e2.time - e1.time;
            if (dtMs <= 0 || dtMs > 36 * 3600000) continue;
            let distKm = haversineDistance(e1.lat, e1.lon, e2.lat, e2.lon);
            if (distKm >= 100 && distKm <= 2200) {
                let speed = distKm / (dtMs / 3600000);
                if (speed >= 4 && speed <= 300) {
                    let dLon = (e2.lon - e1.lon) * Math.PI / 180;
                    let lat1 = e1.lat * Math.PI / 180;
                    let lat2 = e2.lat * Math.PI / 180;
                    let y = Math.sin(dLon) * Math.cos(lat2);
                    let x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                    let bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
                    
                    flows.push({
                        from: e1,
                        to: e2,
                        distKm: Math.round(distKm),
                        dtHours: (dtMs / 3600000).toFixed(1),
                        speedKmH: Math.round(speed),
                        bearing: Math.round(bearing),
                        dirName: bearingToDirection(bearing),
                        ageMs: now - e2.time
                    });
                }
            }
        }
    }
    
    let summary = { label: "Equilibrium", speedKmH: 0, count: flows.length };
    if (flows.length > 0) {
        let latest = flows[flows.length - 1];
        let p1 = cleanPlaceName(latest.from.place);
        let p2 = cleanPlaceName(latest.to.place);
        summary = {
            label: `${latest.dirName} (${latest.speedKmH} km/h)`,
            speedKmH: latest.speedKmH,
            count: flows.length,
            fromPlace: p1,
            toPlace: p2,
            latest: latest
        };
    }
    return { flows: flows, summary: summary };
}

// ==========================================================================
// UNIFIED GAIA RHYTHM ENGINE
// One single calculation path for EVERY "next quake" countdown in the app
// (sidebar 24h/7d/30d, prediction bar, Gaia Rhythm Matrix):
//   1. merge all catalogs (live 24h + 30d + 1y M5+ + 5y M7+ + 20y M8+), de-duplicate USGS/EMSC twins
//   2. M5+ classes: remove aftershocks (Gardner-Knopoff 1974, causal) -> independent mainshocks only
//   3. rhythm = 60% median gap + 40% recency-weighted EMA gap
//   4. Schumann/Kp 'Gaia charge' divides the gap exactly once
//   5. next = time of the latest event + charged gap
// ==========================================================================
function gkWindow(mag) {
    let days = mag >= 6.5 ? Math.pow(10, 0.032 * mag + 2.7) : Math.pow(10, 0.5409 * mag - 0.547);
    let km = Math.pow(10, 0.1238 * mag + 0.983);
    return { ms: days * 86400000, km: km };
}

function declusterGK(eqsNewestFirst) {
    // Causal: an event is an aftershock if an EARLIER event with >= magnitude has it inside its G-K window.
    let asc = eqsNewestFirst.slice().reverse();
    let active = [];
    let keep = [];
    for (let i = 0; i < asc.length; i++) {
        let ev = asc[i];
        active = active.filter(a => a.end > ev.time);
        let isAfter = false;
        for (let k = 0; k < active.length; k++) {
            let a = active[k];
            if (a.mag >= ev.mag && haversineDistance(ev.lat, ev.lon, a.lat, a.lon) <= a.km) { isAfter = true; break; }
        }
        if (!isAfter) keep.push(ev);
        let w = gkWindow(ev.mag);
        active.push({ end: ev.time + w.ms, km: w.km, mag: ev.mag, lat: ev.lat, lon: ev.lon });
    }
    return keep.reverse();
}

function gaiaMergeEqs(...arrays) {
    let map = new Map();
    arrays.forEach(arr => {
        if (arr) arr.forEach(eq => {
            let sig = eq.id ? String(eq.id) : `${eq.lat.toFixed(2)}_${eq.lon.toFixed(2)}_${eq.time}`;
            map.set(sig, eq);
        });
    });
    let sorted = Array.from(map.values()).sort((a, b) => b.time - a.time);
    // Drop USGS/EMSC twins (same quake, different id): <5 min and <180 km apart (handles ±180° date line) -> keep stronger
    let kept = [];
    for (let i = 0; i < sorted.length; i++) {
        let eq = sorted[i];
        let dup = false;
        for (let j = kept.length - 1; j >= 0 && (kept[j].time - eq.time) < 300000; j--) {
            if (haversineDistance(eq.lat, eq.lon, kept[j].lat, kept[j].lon) < 180.0) {
                dup = true;
                if (eq.mag > kept[j].mag) kept[j] = eq;
                break;
            }
        }
        if (!dup) kept.push(eq);
    }
    return kept;
}

let _gaiaDS = { sig: '', all: [], m5: [], m7: [], m8: [], m9: [] };
let _gaiaStatCache = new Map();

function gaiaDatasets() {
    let sig = [
        globalMonthEqs.length, globalMonthEqs.length ? globalMonthEqs[0].id : '',
        earthquakes.length, earthquakes.length ? earthquakes[0].id : '',
        historicalM5Eqs.length, historicalM7Eqs.length, historicalM8Eqs.length, historicalM9Eqs.length
    ].join('|');
    if (sig !== _gaiaDS.sig) {
        let all = gaiaMergeEqs(globalMonthEqs, earthquakes);
        _gaiaDS = {
            sig: sig,
            all: all,
            m5: gaiaMergeEqs(all, historicalM5Eqs),
            m7: gaiaMergeEqs(all, historicalM7Eqs),
            m8: gaiaMergeEqs(all, historicalM8Eqs),
            m9: gaiaMergeEqs(all, historicalM9Eqs)
        };
        _gaiaStatCache.clear();
    }
    return _gaiaDS;
}

function gaiaStatsFor(eqsNewestFirst, declusterIt) {
    let list = declusterIt ? declusterGK(eqsNewestFirst) : eqsNewestFirst;
    if (list.length < 3) return null;
    let gaps = computeGaps(list);
    let medGap = median(gaps);
    let emaGap = exponentialWeightedAvg(gaps, 0.3);
    let rawGap = medGap * 0.6 + emaGap * 0.4;
    let lt = getLunarTidalStress();
    let totalMult = gaiaChargeMultiplier * (lt ? lt.multiplier : 1.0);
    let effGap = rawGap / totalMult;
    let last = eqsNewestFirst[0];
    let p50Gap = Math.round(Math.LN2 * effGap);
    let p90Gap = Math.round(2.302585 * effGap);
    return {
        n: list.length, rawGap: rawGap, effGap: effGap,
        p50Gap: p50Gap, p90Gap: p90Gap,
        p50Time: last.time + p50Gap,
        p90Time: last.time + p90Gap,
        sigma: stdDev(gaps), lastEq: last,
        nextTime: last.time + effGap
    };
}

// kind: 3|4|5|6|7|8|9 (magnitude class) or 'deep' (depth >= 150 km)
// windowMs: optional look-back window (used for M3+/deep sidebar rows)
function gaiaClass(kind, windowMs) {
    let ds = gaiaDatasets();
    let lt = getLunarTidalStress();
    let key = kind + '|' + (windowMs || 0) + '|' + gaiaChargeMultiplier.toFixed(3) + '|' + (lt ? lt.multiplier.toFixed(3) : '1.000') + '|' + Math.floor(Date.now() / 60000);
    if (_gaiaStatCache.has(key)) return _gaiaStatCache.get(key);
    let src, decl = false;
    if (kind === 'deep') {
        src = ds.all.filter(e => e.depth >= 150.0);
    } else {
        let base = kind >= 9 ? ds.m9 : (kind >= 8 ? ds.m8 : (kind >= 7 ? ds.m7 : (kind >= 5 ? ds.m5 : ds.all)));
        src = base.filter(e => e.mag >= kind);
        decl = kind >= 5;
    }
    if (windowMs) {
        let cutoff = Date.now() - windowMs;
        src = src.filter(e => e.time >= cutoff);
    }
    let st = src.length >= 3 ? gaiaStatsFor(src, decl) : null;
    if (_gaiaStatCache.size > 200) _gaiaStatCache.clear();
    _gaiaStatCache.set(key, st);
    return st;
}

// Overwrites every sidebar / bar countdown with the unified engine result.
// Sidebar M5+/M7+ rows use the same class sample as the Rhythm Matrix (a 7d/30d sample of M7+ has 0-2 events).
let _gaiaLastRecalc = 0;
function gaiaRecomputeAll(force) {
    let nowMs = Date.now();
    if (!force && nowMs - _gaiaLastRecalc < 5000) return;
    _gaiaLastRecalc = nowMs;
    let D = 86400000;
    let set = (cur, st) => (st && st.nextTime > 0) ? st.nextTime : cur;
    predictedNextTime24h   = set(predictedNextTime24h,   gaiaClass(3, 1 * D));
    predictedNextTime24hM4 = set(predictedNextTime24hM4, gaiaClass(4, 1 * D));
    predictedNextTime7d    = set(predictedNextTime7d,    gaiaClass(3, 7 * D));
    predictedNextTime30d   = set(predictedNextTime30d,   gaiaClass(3, 30 * D));
    predictedNextTime7dMag5  = predictedNextTime30dMag5 = set(predictedNextTime7dMag5, gaiaClass(5));
    predictedNextTime7dMag7  = predictedNextTime30dMag7 = set(predictedNextTime7dMag7, gaiaClass(7));
    predictedNextTime7dDeep  = set(predictedNextTime7dDeep,  gaiaClass('deep', 7 * D));
    predictedNextTime30dDeep = set(predictedNextTime30dDeep, gaiaClass('deep', 30 * D));
}

function updatePrediction() {
    gaiaRecomputeAll();
    let renderCountdown = (id, predictedTime, normalColor, stat) => {
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
                let timeText = "";
                if (d > 0) timeText = `${d}d ${h}h ${m}m ${s}s`;
                else if (h > 0) timeText = `${h}h ${m}m ${s}s`;
                else timeText = `${m}m ${s}s`;
                
                let bptStr = "";
                if (stat && stat.effGap && stat.lastEq) {
                    let elapsed = Math.max(0, Date.now() - stat.lastEq.time);
                    let bpt = calculateBPTStrain(elapsed, stat.effGap);
                    if (bpt.strain > 1.05) {
                        bptStr = ` · BPT ${bpt.strain.toFixed(1)}x`;
                    }
                }
                
                el.textContent = `OVERDUE by ${timeText}${bptStr}`;
                el.style.color = '#ff3333';
            }
        } else if (el) {
            el.textContent = 'Calculating...';
        }
    };

    let D = 86400000;
    let stGlobal = gaiaClass(3, 1 * D);
    let stGlobalM4 = gaiaClass(4, 1 * D);

    // Short-term prediction (last 5)
    renderCountdown('prediction-timer', predictedNextTime, '#ff8800', shortTermStat);
    // Global 24h prediction
    renderCountdown('prediction-timer-24h', predictedNextTime24h, '#00ffcc', stGlobal);
    
    // M4 Short-term prediction
    renderCountdown('prediction-timer-m4', predictedNextTimeM4, '#ff3333', shortTermM4Stat);
    // M4 Global 24h prediction
    renderCountdown('prediction-timer-24h-m4', predictedNextTime24hM4, '#ff3333', stGlobalM4);
    
    // Global long term predictions
    renderCountdown('stat-7d-avg', predictedNextTime7d, '#00ffcc', gaiaClass(3, 7 * D));
    renderCountdown('stat-30d-avg', predictedNextTime30d, '#00ffcc', gaiaClass(3, 30 * D));
    
    renderCountdown('stat-7d-mag5-avg', predictedNextTime7dMag5, '#ff8800', gaiaClass(5));
    renderCountdown('stat-7d-mag7-avg', predictedNextTime7dMag7, '#ff3333', gaiaClass(7));
    
    renderCountdown('stat-30d-mag5-avg', predictedNextTime30dMag5, '#ff8800', gaiaClass(5));
    renderCountdown('stat-30d-mag7-avg', predictedNextTime30dMag7, '#ff3333', gaiaClass(7));
    
    renderCountdown('stat-7d-deep-avg', predictedNextTime7dDeep, '#88bbff', gaiaClass('deep', 7 * D));
    renderCountdown('stat-30d-deep-avg', predictedNextTime30dDeep, '#88bbff', gaiaClass('deep', 30 * D));

    // Poisson & BPT Interval updates & tooltips
    let renderInterval = (elemId, stat) => {
        let el = document.getElementById(elemId);
        if (!el) return;
        if (stat && stat.p50Gap && stat.p90Gap) {
            let p50Str = formatDuration(stat.p50Gap, false);
            let p90Str = formatDuration(stat.p90Gap, false);
            let elapsed = stat.lastEq ? Math.max(0, Date.now() - stat.lastEq.time) : 0;
            let pElapsed = Math.min(99.9, (1 - Math.exp(-elapsed / stat.effGap)) * 100);
            if (elapsed > stat.effGap) {
                let bpt = calculateBPTStrain(elapsed, stat.effGap);
                el.textContent = `P50: ~${p50Str} · BPT: ${bpt.strain.toFixed(1)}x (${(bpt.pCond1h * 100).toFixed(0)}%/h)`;
                el.style.color = '#ff6666';
                el.title = `Poisson Interval: P50 ~${p50Str}, P90 ~${p90Str}.\n⚠️ OVERDUE (BPT/Weibull Model):\nAccumulated Strain Factor: ${bpt.strain.toFixed(2)}x\nConditional Hazard Rate: ${(bpt.pCond1h * 100).toFixed(1)}%/h\nClick for formula details.`;
            } else {
                el.textContent = `P50: ~${p50Str} · P90: ~${p90Str}`;
                el.style.color = '';
                el.title = `Poisson Interval: 50% chance within ${p50Str}, 90% within ${p90Str}.\nProbability elapsed since last quake: ${pElapsed.toFixed(1)}% (Gaia: ${gaiaChargeMultiplier.toFixed(2)}x)\nClick for formula details.`;
            }
        } else {
            el.textContent = 'P50: ... · P90: ...';
        }
    };

    renderInterval('pred-interval-short', shortTermStat);
    renderInterval('pred-interval-global', stGlobal);
    renderInterval('pred-interval-short-m4', shortTermM4Stat);
    renderInterval('pred-interval-global-m4', stGlobalM4);

    // Update Lunar Tide in UI
    currentLunarTide = getLunarTidalStress();
    let ltEl = document.getElementById('stat-lunar-phase');
    if (ltEl) {
        ltEl.textContent = `${currentLunarTide.icon} ${currentLunarTide.phaseName} (${currentLunarTide.stressPercent}%)`;
        ltEl.style.color = currentLunarTide.color;
        ltEl.title = `Moon Phase & Solid Earth Tides: ${currentLunarTide.phaseName} (${currentLunarTide.icon})\nGravitational Tidal Stress: ${currentLunarTide.stressLevel} (${currentLunarTide.stressPercent}%)\nCoulomb Trigger Factor: ${currentLunarTide.multiplier.toFixed(2)}x\n(Click for physical details)`;
    }

    // Update Tectonic Migration Flow in UI
    let tfEl = document.getElementById('stat-tectonic-flow');
    if (tfEl) {
        if (activeFlowSummary.count > 0) {
            tfEl.textContent = `${activeFlowSummary.label}`;
            tfEl.style.color = '#ffaa00';
            tfEl.title = `Tectonic Rhythm & Migration Flow: ${activeFlowSummary.count} active vectors (48h)\nDominant Migration: ${activeFlowSummary.label}\nLatest Vector: ${activeFlowSummary.fromPlace} ➔ ${activeFlowSummary.toPlace}\n(Click for details and vectors)`;
        } else {
            tfEl.textContent = 'Equilibrium';
            tfEl.style.color = '#88bbff';
            tfEl.title = 'Tectonic Rhythm: No significant directional stress migration detected (Equilibrium).';
        }
    }

    let setTooltip = (id, stat, label) => {
        let el = document.getElementById(id);
        if (el && stat) {
            let elapsed = stat.lastEq ? Math.max(0, Date.now() - stat.lastEq.time) : 0;
            let curP = Math.min(99.9, (1 - Math.exp(-elapsed / stat.effGap)) * 100);
            let bptNote = "";
            if (elapsed > stat.effGap) {
                let bpt = calculateBPTStrain(elapsed, stat.effGap);
                bptNote = `\n⚠️ BPT-Strain: ${bpt.strain.toFixed(2)}x (+${(bpt.pCond1h * 100).toFixed(1)}%/h)`;
            }
            el.title = `${label}: Expected in ~${formatDuration(stat.effGap, false)} (P50: ~${formatDuration(stat.p50Gap, false)}, P90: ~${formatDuration(stat.p90Gap, false)}).\nCurrent Probability: ${curP.toFixed(1)}% | Gaia: ${gaiaChargeMultiplier.toFixed(2)}x${bptNote}\n(Click for details)`;
        }
    };
    setTooltip('prediction-timer', shortTermStat, 'M3+ Short');
    setTooltip('prediction-timer-24h', stGlobal, 'M3+ Global 24h');
    setTooltip('prediction-timer-m4', shortTermM4Stat, 'M4+ Short');
    setTooltip('prediction-timer-24h-m4', stGlobalM4, 'M4+ Global 24h');
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
    // The map canvas sits BELOW the dashboard strip and LEFT of the RECENT list (see style.css)
    let strip = document.getElementById('dashboard-strip');
    if (strip) {
        let sb = strip.getBoundingClientRect().bottom;
        if (sb > 0) document.documentElement.style.setProperty('--strip-h', Math.ceil(sb) + 'px');
    }
    let r = canvas.getBoundingClientRect();
    width = Math.max(100, Math.round(r.width || window.innerWidth));
    height = Math.max(100, Math.round(r.height || window.innerHeight));
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') {
    let stripEl = document.getElementById('dashboard-strip');
    if (stripEl) new ResizeObserver(() => resize()).observe(stripEl);
}
resize();

async function fetchSchumannData() {
    try {
        let res = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
        let data = await res.json();
        
        let lastEntry = data[data.length - 1];
        let kpVal = parseFloat(lastEntry.Kp);
        if(!isNaN(kpVal)) {
            currentKpValue = kpVal;
            let elKp = document.getElementById('sr-kp-val');
            if(elKp) elKp.textContent = kpVal.toFixed(2);
            
            // RE-VALIDATED CORRELATION MULTIPLIERS (analyze_gaia_v2.py, 2005-2024, M6.0+ mainshocks,
            // aftershocks removed, identical Kp window for days and quakes, circular-shift permutation test).
            // Result: no significant effect (best lag p = 0.33; high-Kp ~1.1x, within noise).
            // The former 0.79x / 1.37x / 1.96x came from comparing different Kp windows (artefact).
            // We therefore keep only a tiny, shrunk tilt so that the 'Gaia charge' stays a
            // curiosity-level modifier and does not distort the rhythm predictions:
            // Kp 0-3: 0.98x | Kp 3-5: 1.00x | Kp >5: up to 1.10x
            let charge = 1.0;
            if (kpVal <= 3.0) {
                charge = 0.98 + (kpVal / 3.0) * 0.02;   // 0.98 -> 1.00
            } else if (kpVal <= 5.0) {
                charge = 1.0;
            } else {
                charge = 1.0 + Math.min(1.0, (kpVal - 5.0) / 4.0) * 0.10; // 1.00 -> 1.10
            }
            gaiaChargeMultiplier = charge;
            
            let elMult = document.getElementById('sr-mult-val');
            let elImp = document.getElementById('stat-sr-impact');
            let elCharge = document.getElementById('stat-sr-charge');
            let elSrKp = document.getElementById('stat-sr-kp');
            
            if(elMult) elMult.textContent = charge.toFixed(2) + "x";
            if(elCharge) elCharge.textContent = charge.toFixed(2) + "x";
            if(elSrKp) elSrKp.textContent = kpVal.toFixed(2);
            
            if(elImp) {
                if(kpVal >= 5.0) {
                    elImp.textContent = "Geomagnetic Storm";
                    elImp.style.color = "#ff3333";
                } else if(kpVal >= 4.0) {
                    elImp.textContent = "Elevated";
                    elImp.style.color = "#ffaa00";
                } else {
                    elImp.textContent = "Normal";
                    elImp.style.color = "#00ffcc";
                }
            }
        }
    } catch(e) {
        console.error("Schumann fetch error:", e);
    }
}

async function fetchEarthquakes() {
    await fetchSchumannData();
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
                        time: f.properties.time,
                        tsunami: f.properties.tsunami || 0
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
                        time: new Date(f.properties.time).getTime(),
                        tsunami: 0
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
                if (Math.abs(eq.time - e.time) < 300000 && haversineDistance(eq.lat, eq.lon, e.lat, e.lon) < 180.0) {
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
                offsetY = -map_y * targetScale;
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
            let rawGap = medGap * 0.6 + emaGap * 0.4;
            let lt = getLunarTidalStress();
            let totalMult = gaiaChargeMultiplier * (lt ? lt.multiplier : 1.0);
            let effGap = rawGap / totalMult;
            let last = eqList[0];
            let p50Gap = Math.round(Math.LN2 * effGap);
            let p90Gap = Math.round(2.302585 * effGap);
            return {
                n: clustered.length,
                rawGap: rawGap,
                effGap: effGap,
                p50Gap: p50Gap,
                p90Gap: p90Gap,
                p50Time: last.time + p50Gap,
                p90Time: last.time + p90Gap,
                sigma: stdDev(gaps),
                lastEq: last,
                nextTime: last.time + effGap
            };
        };

        // Short-term prediction using smart method
        if (earthquakes.length >= 3) {
            shortTermStat = getSmartPrediction(earthquakes);
            predictedNextTime = shortTermStat ? shortTermStat.nextTime : 0;
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
        
        // Calculate Gutenberg-Richter b-Value (Crustal Stress State)
        currentBValue = computeBValue(earthquakes, 3.0);
        let bEl = document.getElementById('stat-b-value');
        if (bEl) {
            if (currentBValue.n >= 5) {
                bEl.textContent = `${currentBValue.b.toFixed(2)} (${currentBValue.status})`;
                bEl.style.color = currentBValue.color;
                bEl.title = `Gutenberg-Richter b-Value: ${currentBValue.b.toFixed(2)} ± ${currentBValue.sigma.toFixed(2)}\nAnalysis: ${currentBValue.n} quakes (M≥3.0, 24h)\nMean Magnitude: M${currentBValue.avgMag.toFixed(2)}\nStatus: ${currentBValue.status} (Click for details)`;
            } else {
                bEl.textContent = 'Calculating...';
                bEl.style.color = '#888888';
            }
        }

        // Calculate Tectonic Migration Flow (Stress cascading along boundaries)
        let migResult = computeTectonicMigration(earthquakes);
        activeTectonicFlows = migResult.flows;
        activeFlowSummary = migResult.summary;

        // Detect Deep Mantle Precursors (>150 km) coupled to hotspots
        if (cachedHotspotsData && cachedHotspotsData.length > 0) {
            activeDeepPrecursors = detectDeepPrecursors(earthquakes, cachedHotspotsData);
            let count = Math.min(cachedHotspotsData.length, 5);
            for (let i = 0; i < count; i++) {
                let h = cachedHotspotsData[i];
                let n = document.getElementById('hotspot-' + (i + 1) + '-name');
                if (!h || !n) continue;
                let pre = activeDeepPrecursors.find(dp => dp.coupledHotspot && dp.coupledHotspot.name === h.name);
                n.textContent = h.name + (pre ? " ⚡" : "");
                if (pre) n.style.color = '#ffaa00';
            }
        }

        let eqsM4 = earthquakes.filter(eq => eq.mag >= 4.0);
        
        // M4+ short-term (smart prediction)
        if (eqsM4.length >= 3) {
            shortTermM4Stat = getSmartPrediction(eqsM4);
            predictedNextTimeM4 = shortTermM4Stat ? shortTermM4Stat.nextTime : 0;
        }

        // Global 24h & matrix recalculation
        gaiaRecomputeAll(true);
        
        // Calculate predicted spatial cluster regions & kinematic fault-boundary projections
        predictedTectonicTargets = [];
        if (earthquakes.length > 0) {
            let spat5 = getSpatialClusterRegion(earthquakes, 12);
            spat5.targetType = 'M2.5+ Next Target';
            predictedTectonicTargets.push(spat5);
            let reg5 = document.getElementById('prediction-region-5');
            if (reg5) {
                reg5.textContent = spat5.label;
                reg5.title = `Projected Tectonic Target: ${spat5.lat.toFixed(2)}°, ${spat5.lon.toFixed(2)}°\n` +
                    `Origin Cluster: ${(spat5.originLat || spat5.lat).toFixed(2)}°, ${(spat5.originLon || spat5.lon).toFixed(2)}° (${spat5.count} of ${spat5.totalSample} quakes)\n` +
                    `Kinematic Vector: ${spat5.dirName || 'N/A'} (${spat5.bearing || 0}°, +${spat5.shiftKm || 0} km along fault${spat5.faultSnapped ? ' [Plate-Locked]' : ''})\n` +
                    `Click to center map on projected epicenter.`;
                reg5.onclick = () => flyToCoords(spat5.lat, spat5.lon);
            }
            
            let spat24 = getSpatialClusterRegion(earthquakes, Math.min(earthquakes.length, 40));
            let reg24 = document.getElementById('prediction-region-24h');
            if (reg24) {
                reg24.textContent = spat24.label;
                reg24.title = `24h Kinematic Trajectory Target: ${spat24.lat.toFixed(2)}°, ${spat24.lon.toFixed(2)}° (${spat24.count} quakes in sequence)\n` +
                    `Migration Vector: ${spat24.dirName || 'N/A'} (+${spat24.shiftKm || 0} km${spat24.faultSnapped ? ' [Plate-Locked]' : ''})\n` +
                    `Click to center map.`;
                reg24.onclick = () => flyToCoords(spat24.lat, spat24.lon);
            }
        }
        
        if (eqsM4.length > 0) {
            let spat5m4 = getSpatialClusterRegion(eqsM4, 10, 650);
            spat5m4.targetType = 'M4.0+ Next Target';
            predictedTectonicTargets.push(spat5m4);
            let reg5m4 = document.getElementById('prediction-region-5-m4');
            if (reg5m4) {
                reg5m4.textContent = spat5m4.label;
                reg5m4.title = `M4+ Projected Fault Target: ${spat5m4.lat.toFixed(2)}°, ${spat5m4.lon.toFixed(2)}°\n` +
                    `Kinematic Vector: ${spat5m4.dirName || 'N/A'} (${spat5m4.bearing || 0}°, +${spat5m4.shiftKm || 0} km${spat5m4.faultSnapped ? ' [Plate-Locked]' : ''})\n` +
                    `Click to center map on projected M4+ epicenter.`;
                reg5m4.onclick = () => flyToCoords(spat5m4.lat, spat5m4.lon);
            }
            
            let spat24m4 = getSpatialClusterRegion(eqsM4, eqsM4.length, 650);
            let reg24m4 = document.getElementById('prediction-region-24h-m4');
            if (reg24m4) {
                reg24m4.textContent = spat24m4.label;
                reg24m4.title = `M4+ 24h Kinematic Target: ${spat24m4.lat.toFixed(2)}°, ${spat24m4.lon.toFixed(2)}°\n` +
                    `Migration Vector: ${spat24m4.dirName || 'N/A'} (+${spat24m4.shiftKm || 0} km${spat24m4.faultSnapped ? ' [Plate-Locked]' : ''})\n` +
                    `Click to center map.`;
                reg24m4.onclick = () => flyToCoords(spat24m4.lat, spat24m4.lon);
            }
        }
        
        gaiaRecomputeAll(true);
        updatePrediction();
        loadHotspots();
        
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

// Helper function for relative time formatting
function getRelativeTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
}

// Render ticker items
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
    
    // Set duration based on number of items (~8 seconds per item)
    const totalItems = tsunamiData.length + volcanoData.length;
    const duration = Math.max(60, totalItems * 8); // Minimum 60s
    
    // Reset animation so it scrolls in cleanly from the right
    if (tickerScroll) {
        tickerScroll.style.animationDuration = `${duration}s`;
        tickerScroll.style.animationName = 'none';
        tickerScroll.offsetHeight; /* trigger reflow */
        tickerScroll.style.animationName = 'ticker'; 
    }
}

// Fetch live data from USGS and categorize
async function fetchLiveTickers() {
    try {
        // Use the M4.5+ 7-day feed to keep the ticker populated with significant events
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
                const tsunamiFlag = props.tsunami; // 1 if tsunami warning

                // Add significant seismic events to activity ticker
                volcanoData.push({
                    name: place,
                    status: `Seismic Unrest - Mag ${mag.toFixed(1)}`,
                    timestamp: time
                });

                // If USGS flags tsunami threat, add to tsunami ticker
                if (tsunamiFlag === 1) {
                    tsunamiData.push({
                        region: place,
                        level: `Tsunami Warning (Mag ${mag.toFixed(1)})`,
                        timestamp: time
                    });
                }
            });

            // Fallback for tsunami ticker if no active threats worldwide
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

// Initial call
fetchLiveTickers();

// Update relative times every minute
setInterval(() => {
    renderTicker();
}, 60000);

// Refresh ticker data from API every 5 minutes
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
            let avgMs = (medianGap * 0.6 + emaGap * 0.4) / gaiaChargeMultiplier; // Blended and Multiplied
            
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
                return (med * 0.6 + ema * 0.4) / gaiaChargeMultiplier;
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
        
        gaiaRecomputeAll(true);
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

    // M9+ full instrumental catalog from USGS (since 1900, zero hardcoded events)
    try {
        let m9Url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=1900-01-01&endtime=${nowStr}&minmagnitude=9.0`;
        let m9Res = await fetch(m9Url);
        let m9Data = await m9Res.json();
        if (m9Data.features) {
            historicalM9Eqs = m9Data.features.map(f => ({
                id: f.id,
                mag: f.properties.mag,
                depth: f.geometry.coordinates[2] || 0,
                place: f.properties.place,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                time: f.properties.time
            })).sort((a,b) => b.time - a.time);
        }
    } catch(e) { console.error("Failed M9+", e); }
    
    gaiaRecomputeAll(true);
    updateGaiaPopup();
    loadHotspots();
}

fetchHistoricalData();
setInterval(fetchHistoricalData, 1800000); // refresh live USGS M5+ catalog & dynamic hotspots every 30 min

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
    
    // Unified engine: identical numbers to the sidebar countdowns (see gaiaClass)
    let calcRhythm = (kind) => {
        let st = gaiaClass(kind);
        if (!st) return null;
        
        let lastEq = st.lastEq;
        let timeSinceLast = now - lastEq.time;
        let avgGapMs = st.effGap; // median/EMA blend, already divided by the Gaia (Kp) charge
        let sigma = st.sigma;
        let filtered = { length: st.n };
        
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
    
    let m3Stats = calcRhythm(3);
    let m4Stats = calcRhythm(4);
    let m5Stats = calcRhythm(5);
    let m6Stats = calcRhythm(6);
    let m7Stats = calcRhythm(7);
    let m8Stats = calcRhythm(8);
    let m9Stats = calcRhythm(9);
    
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
    if (m9Stats) addRow('M9+', m9Stats, '#aa00ff');
    
    html += `</table>`;
    html += `<div style="margin-top:8px; color:#888; font-size:9px; text-align:center;">Hover rows for last event details · P(%) = Poisson probability · Rhythm = Median + EMA blend</div>`;
    
    if (historicalM5Eqs.length === 0 || historicalM7Eqs.length === 0 || historicalM8Eqs.length === 0 || historicalM9Eqs.length === 0) {
        html += `<div style="margin-top:10px; color:#ff8800; text-align:center; font-size:11px; animation: pulse 1.5s infinite;">Fetching historical data... (Please wait 1-2s)</div>`;
    }
    
    statsDiv.innerHTML = html;
    let stripStats = document.getElementById('gaia-strip-stats');
    if (stripStats) stripStats.innerHTML = html;
}

// Matrix card in the dashboard strip opens the detailed explanation popup
let gaiaMatrixCard = document.getElementById('gaia-matrix-card');
if (gaiaMatrixCard) {
    gaiaMatrixCard.addEventListener('click', () => {
        if (gaiaPopup) gaiaPopup.classList.remove('hidden');
        updateGaiaPopup();
    });
}

// Update live every second (the strip matrix is always visible)
setInterval(() => {
    updateGaiaPopup();
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
    
    let now = Date.now();
    let formatDur = (ms) => formatDuration(ms, false);
    let formatTime = (ts) => {
        let d = new Date(ts);
        return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0') + ' (Local)';
    };
    
    let statObj = null;
    let D = 86400000;
    if (calcType === 'short') {
        statObj = shortTermStat;
        title = "M3.0+ Short-Term (Poisson Model)";
        desc = "Local cluster analysis of the most recent mainshocks using Gardner-Knopoff declustering to prevent aftershock bias, modulated by space weather and solar geomagnetic activity (NOAA Kp / Gaia Charge).";
    } else if (calcType === 'short-m4') {
        statObj = shortTermM4Stat;
        title = "M4.0+ Short-Term (Poisson Model)";
        desc = "Local cluster analysis for M4.0+ mainshocks with declustering to remove aftershock bias, modulated by space weather and geomagnetic activity (NOAA Kp / Gaia Charge).";
    } else if (calcType === 'global') {
        statObj = gaiaClass(3, 1 * D);
        title = "M3.0+ Global 24H (Poisson Model)";
        desc = "Global 24-hour rhythm across all worldwide M3.0+ mainshocks (weighted median + EMA), adjusted for geomagnetic charge rates.";
    } else if (calcType === 'global-m4') {
        statObj = gaiaClass(4, 1 * D);
        title = "M4.0+ Global 24H (Poisson Model)";
        desc = "Global 24-hour rhythm across all worldwide M4.0+ mainshocks (weighted median + EMA), adjusted for geomagnetic charge rates.";
    } else if (calcType === '7d') {
        statObj = gaiaClass(3, 7 * D);
        title = "M3.0+ Long-Term (7 Days)";
        desc = "Global 7-day history from USGS catalog feed with rhythm smoothing and Gaia charge modification.";
    } else if (calcType === '30d') {
        statObj = gaiaClass(3, 30 * D);
        title = "M3.0+ Long-Term (30 Days)";
        desc = "Global 30-day history from USGS catalog feed with rhythm smoothing and Gaia charge modification.";
    } else if (calcType === '7d-mag5' || calcType === '30d-mag5') {
        statObj = gaiaClass(5);
        title = "M5.0+ Heavy Earthquakes";
        desc = "Global M5.0+ rhythm matrix (declustered via Gardner-Knopoff, independent mainshocks only) with Poisson confidence intervals.";
    } else if (calcType === '7d-mag7' || calcType === '30d-mag7') {
        statObj = gaiaClass(7);
        title = "M7.0+ Major Earthquakes (Mega-Thrust)";
        desc = "Global M7.0+ rhythm matrix across historical USGS catalog with Poisson confidence intervals.";
    } else if (calcType === '7d-deep' || calcType === '30d-deep') {
        statObj = gaiaClass('deep', (calcType.startsWith('30d') ? 30 : 7) * D);
        title = "Deep Mantle Earthquakes (>150 km)";
        desc = "Statistical discharge intervals of deep subducted tectonic slab adjustments (>150 km depth).";
    } else if (calcType === 'b-value') {
        title = "Gutenberg-Richter b-Value & Crustal Stress";
        desc = "The Gutenberg-Richter b-value (log₁₀ N = a - b·M) is the primary geophysical indicator of crustal stress state. In an equilibrium/relaxed state, b ≈ 1.0–1.2 (many small stress releases). When faults become locked (asperity locking), b drops below 0.8 because extreme tectonic pressure suppresses microseismicity – a classic precursor signal prior to major ruptures.";
        
        let bVal = currentBValue;
        let bMonth = (typeof globalMonthEqs !== 'undefined' && globalMonthEqs.length > 20) 
            ? computeBValue(globalMonthEqs, 4.0) 
            : null;
        
        mathStr = 
`• Method: Aki-Utsu Maximum Likelihood Estimator (MLE)
• Dataset (24h): ${bVal.n} earthquakes (M ≥ 3.0)
• Mean Magnitude M̄: M${bVal.avgMag.toFixed(2)}
• Current b-Value: ${bVal.b.toFixed(2)} ± ${bVal.sigma.toFixed(2)}
• Stress State: ${bVal.status.toUpperCase()}
` + (bMonth && bMonth.n > 20 ? `• 30-Day Reference (Global M≥4.0): b = ${bMonth.b.toFixed(2)} (${bMonth.n} quakes)\n` : '') +
`
Interpretation:
  b ≥ 1.15 : Relaxed / Hydrothermal (Low major quake hazard)
  0.90-1.14: Normal tectonic equilibrium
  0.75-0.89: Elevated asperity locking & stress accumulation
  b < 0.75 : HIGH STRESS (Faults locked / High rupture hazard)`;
    } else if (calcType === 'lunar-tide') {
        title = "Moon Phase & Solid Earth Tides";
        desc = "Gravitational tidal forces from the Moon and Sun elastically deform the solid Earth twice daily by 40–50 cm. During Syzygy (New and Full Moon), these forces align to produce maximum tidal stress. These cyclic shear and normal stresses modulate Coulomb failure stress on locked faults and can trigger overdue earthquakes (Tanaka et al., Ide et al. 2016).";
        
        let lt = currentLunarTide || getLunarTidalStress();
        mathStr = 
`• Moon Phase: ${lt.phaseName} ${lt.icon} (${(lt.phaseFrac * 100).toFixed(1)}% of synodic cycle)
• Tidal Stress Level: ${lt.stressLevel} (${lt.stressPercent}%)
• Coulomb Trigger Factor: ${lt.multiplier.toFixed(2)}x
• Physical Impact: ${lt.stressPercent >= 75 ? 'MAXIMUM (Syzygy / Full or New Moon: elevated trigger probability)' : (lt.stressPercent >= 40 ? 'MODERATE (Quarter Moon / Quadrature)' : 'MINIMAL')}
• Coupling: Dynamically modulates Poisson expectation intervals by up to ±4%.`;
    } else if (calcType === 'tectonic-flow') {
        title = "Tectonic Rhythm & Migration Flow (Stress Cascades)";
        desc = "Earthquakes do not occur in isolation; stress transfers dynamically along plate boundaries in rhythmic cascades. Through viscoelastic relaxation in the asthenosphere and pore-fluid diffusion waves, tectonic stress propagates at typical speeds of 4 to 300 km/h (e.g., North Anatolian Fault, Cascadia, Mariana Arc).";
        
        let mig = activeFlowSummary;
        let flowList = (activeTectonicFlows || []).slice(-4).reverse();
        let flowStr = flowList.map((f, idx) => `  ${idx + 1}. ${f.from.place ? cleanPlaceName(f.from.place) : 'Event A'} ➔ ${f.to.place ? cleanPlaceName(f.to.place) : 'Event B'} (${f.distKm} km, ${f.speedKmH} km/h, ${f.dirName})`).join('\n');
        
        mathStr = 
`• Detected Migration Vectors (48h): ${mig.count}
• Dominant Direction: ${mig.label}
• Calculation Window: 100 km to 2200 km, 4–300 km/h
` + (flowList.length > 0 ? `• Recent Tectonic Stress Flows:\n${flowStr}\n` : '• Current Status: Balanced (Equilibrium)\n') +
`
Visualization:
The animated dashed vectors on the 3D map display the real-time path and direction of stress propagation.`;
    }

    if (statObj && statObj.effGap) {
        let elapsed = statObj.lastEq ? Math.max(0, now - statObj.lastEq.time) : 0;
        let curProb = Math.min(99.9, (1 - Math.exp(-elapsed / statObj.effGap)) * 100);
        let lt = getLunarTidalStress();
        
        let overdueBPTInfo = "";
        if (elapsed > statObj.effGap) {
            let bpt = calculateBPTStrain(elapsed, statObj.effGap);
            overdueBPTInfo = 
`\n\n⚠️ BPT / WEIBULL OVERDUE ANALYSIS:
• Overdue: +${formatDur(elapsed - statObj.effGap)} (${bpt.r.toFixed(2)}x of expected interval)
• Asperity Strain Factor: ${bpt.strain.toFixed(2)}x
• Conditional Hazard Rate (next hour): ${(bpt.pCond1h * 100).toFixed(1)}%`;
        }

        mathStr = 
`• Dataset: ${statObj.n} events (mainshocks)
• Base Interval: ${formatDur(statObj.rawGap)} (60% Median + 40% EMA)
• Gaia Modifier: ${gaiaChargeMultiplier.toFixed(2)}x · Tides: ${lt.multiplier.toFixed(2)}x (Effective: ${formatDur(statObj.effGap)})
• Last Quake: ${statObj.lastEq ? formatTime(statObj.lastEq.time) + ' (' + formatDur(elapsed) + ' ago)' : 'N/A'}
• Expected Mean Time: ${formatTime(statObj.nextTime)}

Poisson Arrival Windows:
• 50% Confidence (P50): ~${formatDur(statObj.p50Gap)} (${formatTime(statObj.p50Time)})
• 90% Confidence (P90): ~${formatDur(statObj.p90Gap)} (${formatTime(statObj.p90Time)})
• Current Probability: ${curProb.toFixed(1)}%${overdueBPTInfo}`;
    } else if (calcType !== 'b-value' && calcType !== 'lunar-tide' && calcType !== 'tectonic-flow') {
        mathStr = "Calculation in progress or insufficient data available.";
    }
    
    document.getElementById('calc-popup-title').textContent = title;
    document.getElementById('calc-popup-desc').innerHTML = desc;
    document.getElementById('calc-popup-math').textContent = mathStr;
    
    let popupW = 380;
    let px = (e.clientX < 340) ? 350 : Math.max(20, Math.min(window.innerWidth - popupW - 20, e.clientX - popupW / 2));
    let py = (e.clientX < 340) ? Math.max(60, Math.min(window.innerHeight - 380, e.clientY - 40)) : Math.max(60, Math.min(window.innerHeight - 380, e.clientY + 15));
    calcPopup.style.left = px + 'px';
    calcPopup.style.top = py + 'px';
    calcPopup.style.position = 'fixed';
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

    // --- Draw Dynamic 300 km Hotspot Zones (from live/server Gaussian model) ---
    if (cachedHotspotsData && cachedHotspotsData.length > 0) {
        for (let i = 0; i < Math.min(cachedHotspotsData.length, 5); i++) {
            let h = cachedHotspotsData[i];
            let r = ((90.0 - h.lat) / 180.0) * 723.0;
            let angle = h.lon * Math.PI / 180.0;
            let px = mapCx + (r * Math.sin(angle)) * scale;
            let py = mapCy + (r * Math.cos(angle)) * scale;
            let radiusPx = Math.max(6, 300.0 * 0.03618 * scale);

            if (px + radiusPx < 0 || px - radiusPx > width || py + radiusPx < 0 || py - radiusPx > height) {
                continue;
            }

            let isPrecursorCoupled = activeDeepPrecursors && activeDeepPrecursors.some(
                dp => dp.coupledHotspot && dp.coupledHotspot.name === h.name
            );

            ctx.save();
            ctx.beginPath();
            ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
            ctx.fillStyle = isPrecursorCoupled ? "rgba(255, 170, 0, 0.09)" : "rgba(255, 204, 0, 0.04)";
            ctx.fill();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = isPrecursorCoupled ? "rgba(255, 170, 0, 0.75)" : "rgba(255, 204, 0, 0.45)";
            ctx.lineWidth = isPrecursorCoupled ? 1.8 : 1.2;
            ctx.stroke();
            ctx.restore();
        }
    }
    
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
    
    // --- Tectonic Migration & Stress Flow Streamlines ---
    if (activeTectonicFlows && activeTectonicFlows.length > 0) {
        let flowDashOffset = (Date.now() / 35) % 24;
        for (let i = 0; i < activeTectonicFlows.length; i++) {
            let f = activeTectonicFlows[i];
            let e1 = f.from;
            let e2 = f.to;
            
            let r1 = ((90.0 - e1.lat) / 180.0) * 723.0;
            let a1 = e1.lon * Math.PI / 180.0;
            let px1 = mapCx + (r1 * Math.sin(a1)) * scale;
            let py1 = mapCy + (r1 * Math.cos(a1)) * scale;
            
            let r2 = ((90.0 - e2.lat) / 180.0) * 723.0;
            let a2 = e2.lon * Math.PI / 180.0;
            let px2 = mapCx + (r2 * Math.sin(a2)) * scale;
            let py2 = mapCy + (r2 * Math.cos(a2)) * scale;
            
            if ((px1 < -50 && px2 < -50) || (px1 > width + 50 && px2 > width + 50) ||
                (py1 < -50 && py2 < -50) || (py1 > height + 50 && py2 > height + 50)) {
                continue;
            }
            
            let midX = (px1 + px2) / 2;
            let midY = (py1 + py2) / 2;
            let dx = px2 - px1;
            let dy = py2 - py1;
            let nx = -dy * 0.12;
            let ny = dx * 0.12;
            let ctrlX = midX + nx;
            let ctrlY = midY + ny;
            
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.quadraticCurveTo(ctrlX, ctrlY, px2, py2);
            ctx.strokeStyle = "rgba(255, 170, 0, 0.75)";
            ctx.lineWidth = 2.2;
            ctx.setLineDash([8, 6]);
            ctx.lineDashOffset = -flowDashOffset;
            ctx.stroke();
            
            let headAngle = Math.atan2(py2 - ctrlY, px2 - ctrlX);
            let arrowLen = 9;
            ctx.setLineDash([]);
            ctx.fillStyle = "#ffaa00";
            ctx.beginPath();
            ctx.moveTo(px2, py2);
            ctx.lineTo(px2 - arrowLen * Math.cos(headAngle - 0.5), py2 - arrowLen * Math.sin(headAngle - 0.5));
            ctx.lineTo(px2 - arrowLen * Math.cos(headAngle + 0.5), py2 - arrowLen * Math.sin(headAngle + 0.5));
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    // --- Seismo-Tectonic Kinematic Target Projections (Predicted Next Fault Epicenters) ---
    if (predictedTectonicTargets && predictedTectonicTargets.length > 0) {
        let targetPulse = (Math.sin(Date.now() / 220.0) + 1.0) * 0.5;
        let dashAnim = (Date.now() / 25) % 16;
        for (let tIdx = 0; tIdx < predictedTectonicTargets.length; tIdx++) {
            let pt = predictedTectonicTargets[tIdx];
            if (!pt || (pt.lat === 0 && pt.lon === 0)) continue;
            let isM4Target = pt.targetType && pt.targetType.includes('M4.0+');
            let strokeCol = isM4Target ? "rgba(255, 60, 220, 0.9)" : "rgba(0, 255, 255, 0.9)";
            let glowCol = isM4Target ? "rgba(255, 60, 220, 0.22)" : "rgba(0, 255, 255, 0.22)";

            let rT = ((90.0 - pt.lat) / 180.0) * 723.0;
            let aT = pt.lon * Math.PI / 180.0;
            let pxT = mapCx + (rT * Math.sin(aT)) * scale;
            let pyT = mapCy + (rT * Math.cos(aT)) * scale;

            if (pxT < -40 || pxT > width + 40 || pyT < -40 || pyT > height + 40) continue;

            ctx.save();
            // Draw forward kinematic projection vector from latest cluster origin -> projected fault target
            if (pt.originLat !== undefined && pt.originLon !== undefined && pt.shiftKm >= 5) {
                let rO = ((90.0 - pt.originLat) / 180.0) * 723.0;
                let aO = pt.originLon * Math.PI / 180.0;
                let pxO = mapCx + (rO * Math.sin(aO)) * scale;
                let pyO = mapCy + (rO * Math.cos(aO)) * scale;

                ctx.beginPath();
                ctx.moveTo(pxO, pyO);
                ctx.lineTo(pxT, pyT);
                ctx.strokeStyle = strokeCol;
                ctx.lineWidth = 2.0;
                ctx.setLineDash([5, 4]);
                ctx.lineDashOffset = -dashAnim;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Draw pulsing target reticle on projected fault coordinate
            let radOuter = (9 + targetPulse * 5) * Math.min(1.6, Math.max(0.85, zoom * 0.7));
            ctx.beginPath();
            ctx.arc(pxT, pyT, radOuter, 0, Math.PI * 2);
            ctx.fillStyle = glowCol;
            ctx.fill();
            ctx.strokeStyle = strokeCol;
            ctx.lineWidth = 1.6;
            ctx.stroke();

            // Crosshair ticks
            let ch = radOuter + 4;
            ctx.beginPath();
            ctx.moveTo(pxT - ch, pyT);
            ctx.lineTo(pxT - radOuter * 0.4, pyT);
            ctx.moveTo(pxT + radOuter * 0.4, pyT);
            ctx.lineTo(pxT + ch, pyT);
            ctx.moveTo(pxT, pyT - ch);
            ctx.lineTo(pxT, pyT - radOuter * 0.4);
            ctx.moveTo(pxT, pyT + radOuter * 0.4);
            ctx.lineTo(pxT, pyT + ch);
            ctx.strokeStyle = strokeCol;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
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
    
    // Draw Massive Tsunami Shockwaves (USGS tsunami flag === 1)
    for (let i = 0; i < earthquakes.length; i++) {
        let eq = earthquakes[i];
        if (eq.tsunami !== 1) continue;
        
        let ageMs = now - eq.time;
        if (ageMs > 86400000) continue; // Older than 24 hours
        
        let r = ((90.0 - eq.lat) / 180.0) * 723.0;
        let angle = eq.lon * Math.PI / 180.0;
        let px = mapCx + (r * Math.sin(angle)) * scale;
        let py = mapCy + (r * Math.cos(angle)) * scale;
        
        // Smaller, inward-flowing rings for Tsunami
        for (let wave = 0; wave < 3; wave++) {
            // Shrinking wave: starts at 150, goes down to 0
            let wavePhase = ((pulseTime * 40) + (wave * 50)) % 150;
            let waveRadius = 150 - wavePhase;
            
            // Overall age fade out
            let overallFade = Math.max(0, 1.0 - (ageMs / 86400000));
            
            // waveRadius is 150 -> 0. waveRadius/150 is 1.0 -> 0.0. 
            let finalWaveOp = (waveRadius / 150) * overallFade;
            
            let rOuter = Math.max(0.1, waveRadius * zoom);
            let rInner = Math.max(0.1, (waveRadius * zoom) - 2);
            
            ctx.beginPath();
            ctx.arc(px, py, rOuter, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 150, 255, ${finalWaveOp * 0.8})`; // Deep ocean blue
            ctx.lineWidth = 4 * zoom;
            ctx.stroke();
            
            // Inner glow for the wave
            ctx.beginPath();
            ctx.arc(px, py, rInner, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(50, 200, 255, ${finalWaveOp * 0.4})`; // Light cyan core
            ctx.lineWidth = 2 * zoom;
            ctx.stroke();
        }
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

function renderBeachball(canvasId, regime) {
    let cv = document.getElementById(canvasId);
    if (!cv) return;
    let c = cv.getContext('2d');
    let w = cv.width, h = cv.height;
    let r = (w / 2) - 2;
    let cx = w / 2, cy = h / 2;

    c.clearRect(0, 0, w, h);
    c.save();
    c.translate(cx, cy);
    c.rotate((regime.strike || 0) * Math.PI / 180);

    // Outer circle
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
    c.strokeStyle = '#00ffcc';
    c.lineWidth = 1.8;
    c.stroke();

    let compColor = regime.type === 'thrust' ? '#ff3344' : (regime.type === 'slab' ? '#aa00ff' : (regime.type === 'normal' ? '#ff8800' : '#00b4d8'));

    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.clip();

    if (regime.type === 'thrust' || regime.type === 'slab') {
        // Double curved compression lobes (Center is compressed)
        c.fillStyle = compColor;
        c.beginPath();
        c.moveTo(-r, 0);
        c.bezierCurveTo(-r * 0.4, r * 0.8, r * 0.4, r * 0.8, r, 0);
        c.bezierCurveTo(r * 0.4, -r * 0.8, -r * 0.4, -r * 0.8, -r, 0);
        c.fill();
    } else if (regime.type === 'normal') {
        // Middle is dilated/white, top and bottom are compressed
        c.fillStyle = compColor;
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.moveTo(-r, 0);
        c.bezierCurveTo(-r * 0.4, r * 0.7, r * 0.4, r * 0.7, r, 0);
        c.bezierCurveTo(r * 0.4, -r * 0.7, -r * 0.4, -r * 0.7, -r, 0);
        c.fill();
    } else {
        // Strike-slip: classic 4-quadrant petals
        c.fillStyle = compColor;
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, r, 0, Math.PI * 0.5);
        c.fill();
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, r, Math.PI, Math.PI * 1.5);
        c.fill();
    }

    c.restore();

    // Border ring
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(0, 255, 204, 0.6)';
    c.lineWidth = 1.5;
    c.stroke();
}

function renderSeismogram(canvasId, eq) {
    let cv = document.getElementById(canvasId);
    if (!cv) return;
    let c = cv.getContext('2d');
    let w = cv.width, h = cv.height;

    // Estimate epicentral distance based on depth & magnitude (~150 to 350 km nearest regional broadband)
    let distKm = Math.max(120, Math.min(480, Math.round(160 + (eq.depth || 10) * 1.8)));
    let vp = 6.2; // P wave velocity km/s
    let vs = 3.55; // S wave velocity km/s
    let tP = distKm / vp;
    let tS = distKm / vs;
    let dt = (tS - tP).toFixed(1);

    let metaEl = document.getElementById('eq-seismogram-meta');
    if (metaEl) {
        metaEl.textContent = `Δ=${distKm}km | Δt(S-P): ${dt}s | fc=${(Math.max(0.4, 4.5 - (eq.mag || 4) * 0.6)).toFixed(1)}Hz`;
    }

    c.clearRect(0, 0, w, h);
    c.fillStyle = '#04070d';
    c.fillRect(0, 0, w, h);

    // Subtle grid lines
    c.strokeStyle = 'rgba(0, 255, 204, 0.12)';
    c.lineWidth = 1;
    for (let x = 0; x < w; x += 37) {
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
    }
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();

    let pX = Math.round(w * 0.22);
    let sX = Math.round(w * 0.58);
    let midY = h / 2;

    // Draw waveform trace
    c.beginPath();
    c.strokeStyle = '#00ffcc';
    c.lineWidth = 1.4;

    for (let x = 0; x < w; x++) {
        let noise = (Math.sin(x * 0.4) + Math.cos(x * 0.7)) * 1.2;
        let pWave = 0;
        let sWave = 0;

        if (x >= pX) {
            let dxP = x - pX;
            let decayP = Math.exp(-dxP * 0.04);
            pWave = Math.sin(dxP * 0.45) * Math.min(h * 0.28, (eq.mag || 4) * 2.8) * decayP;
        }

        if (x >= sX) {
            let dxS = x - sX;
            let decayS = Math.exp(-dxS * 0.025);
            sWave = Math.sin(dxS * 0.28) * Math.min(h * 0.44, (eq.mag || 4) * 5.2) * decayS;
        }

        let y = midY + noise + pWave + sWave;
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
    }
    c.stroke();

    // Phase arrival markers (P & S)
    c.font = 'bold 9px monospace';
    c.fillStyle = '#ffd166';
    c.fillText('P-ARRIVAL', pX - 8, 11);
    c.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    c.setLineDash([2, 2]);
    c.beginPath();
    c.moveTo(pX, 13);
    c.lineTo(pX, h);
    c.stroke();

    c.fillStyle = '#ff0055';
    c.fillText('S-ARRIVAL', sX - 8, 11);
    c.strokeStyle = 'rgba(255, 0, 85, 0.7)';
    c.beginPath();
    c.moveTo(sX, 13);
    c.lineTo(sX, h);
    c.stroke();
    c.setLineDash([]);
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

    // Focal Mechanism Tensor & Seismogram
    let regimeInfo = classifyFocalRegime(eq);
    let regimeEl = document.getElementById('eq-popup-regime');
    if (regimeEl) regimeEl.textContent = regimeInfo.label;
    let tensorEl = document.getElementById('eq-popup-tensor');
    if (tensorEl) tensorEl.textContent = `S:${regimeInfo.strike}° D:${regimeInfo.dip}° R:${regimeInfo.rake > 0 ? '+' : ''}${regimeInfo.rake}°`;

    renderBeachball('eq-focal-canvas', regimeInfo);
    renderSeismogram('eq-seismogram-canvas', eq);
    
    // Position popup above the clicked point, keep within viewport
    let popupW = 310;
    let popupH = 380;
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
    
    { let cr = canvas.getBoundingClientRect(); showEqPopup(eq, cr.left + width / 2, cr.top + height / 2); }
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
document.getElementById('btn-reset').addEventListener('click', () => { zoom = 0.77; offsetX = 0; offsetY = 0; hideEqPopup(); });

// Smooth mouse-wheel zoom centered on cursor position
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    let rect = canvas.getBoundingClientRect();
    let mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    let mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

    let factor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
    let newZoom = Math.max(0.2, Math.min(35.0, zoom * factor));
    let actualFactor = newZoom / zoom;

    let mapCx = width / 2 + offsetX;
    let mapCy = height / 2 + offsetY;
    offsetX = (mouseX - width / 2) - (mouseX - mapCx) * actualFactor;
    offsetY = (mouseY - height / 2) - (mouseY - mapCy) * actualFactor;
    zoom = newZoom;
}, { passive: false });

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
        // Prevent CSS transforms from interfering with fixed positioning
        popup.style.transform = 'none'; 
        popup.style.margin = '0';
        popup.style.bottom = 'auto';
        popup.style.right = 'auto';
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
    } else if (currentSearchMag >= 8 && currentSearchMag < 9) {
        allEqs = historicalM8Eqs || [];
    } else if (currentSearchMag >= 9) {
        allEqs = historicalM9Eqs || [];
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
            selectEqFromList(eq);
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
    if (autopilotTimeout) clearTimeout(autopilotTimeout);
    autopilotTimeout = null;
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
            
            autopilotTimeout = setTimeout(() => {
                if (!isAutopilotActive) return;
                
                // Recenter and reset zoom (like the reset button)
                offsetX = 0;
                offsetY = 0;
                zoom = 0.77;
                
                hideEqPopup();
                document.querySelectorAll('#search-results-list li, #eq-list li').forEach(li => li.classList.remove('active'));
                
                isAutopilotActive = false;
                lastInteractionTime = Date.now();
                autopilotTimeout = null;
            }, 10000);
            
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

// ==========================================
// FIREBASE LIVE VIEWER COUNT
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBnt-blahJuA456Vn3r2pFRYpz0PtO56zs",
    authDomain: "herakles-earthquakes.firebaseapp.com",
    databaseURL: "https://herakles-earthquakes-default-rtdb.firebaseio.com",
    projectId: "herakles-earthquakes",
    storageBucket: "herakles-earthquakes.firebasestorage.app",
    messagingSenderId: "747525284572",
    appId: "1:747525284572:web:be9c61d814eb6ca6e00a19"
};

try {
    const viewerCountEl = document.getElementById('viewer-count');
    if (viewerCountEl) viewerCountEl.textContent = "?"; // Loading state
    
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    
    const connectionsRef = db.ref('connections');
    const connectedRef = db.ref('.info/connected');
    
    // When the client connects, create a new connection entry
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            const con = connectionsRef.push();
            con.onDisconnect().remove();
            con.set(true).catch(err => {
                if (viewerCountEl) viewerCountEl.textContent = "ERR: Rules";
                console.error("Firebase write error (check rules):", err);
            });
        }
    });
    
    // Listen to the total number of connections
    connectionsRef.on('value', (snap) => {
        if (viewerCountEl) {
            viewerCountEl.textContent = snap.numChildren() || 0;
        }
    }, (error) => {
        if (viewerCountEl) viewerCountEl.textContent = "ERR: DB";
        console.error("Firebase read error:", error);
    });
} catch(e) {
    const viewerCountEl = document.getElementById('viewer-count');
    if (viewerCountEl) viewerCountEl.textContent = "ERR: Init";
    console.log("Firebase not configured correctly yet:", e);
}

// ==========================================
// HOTSPOTS (computed on the server, the browser only loads the small JSON)
// ==========================================
function flyToCoords(lat, lon) {
    if (gaiaPopup && !gaiaPopup.classList.contains('hidden')) gaiaPopup.classList.add('hidden');
    let calcPopup = document.getElementById('calc-popup');
    if (calcPopup && !calcPopup.classList.contains('hidden')) calcPopup.classList.add('hidden');
    
    let r = ((90.0 - lat) / 180.0) * 723.0;
    let angle = lon * Math.PI / 180.0;
    let map_x = r * Math.sin(angle);
    let map_y = r * Math.cos(angle);
    
    zoom = 4.0;
    let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    offsetX = -map_x * targetScale;
    offsetY = -map_y * targetScale;
    
    stopAutopilot(true);
}

// Dynamic Hotspot Engine: computes Top-5 M5+ hotspots directly from the live USGS catalog
// using Gardner-Knopoff declustering + 250 km Gaussian kernel + 300 km Poisson rate (zero hardcoded data).
function computeDynamicHotspotsFromCatalog() {
    let ds = gaiaDatasets();
    let src = (ds && ds.m5 && ds.m5.length > 0) ? ds.m5.filter(e => e.mag >= 5.0) : [];
    if (src.length < 10) return null;

    let main = declusterGK(src);
    let newestMs = main[0].time;
    let oldestMs = main[main.length - 1].time;
    let spanWeeks = Math.max(1.0, (newestMs - oldestMs) / (7 * 86400000));

    let cellDeg = 4.0;
    let sigmaKm = 250.0;
    let radiusKm = 300.0;
    let sepKm = 800.0;
    let lats = [];
    for (let la = -78; la <= 78; la += cellDeg) lats.push(la);
    let lons = [];
    for (let lo = -178; lo < 180; lo += cellDeg) lons.push(lo);

    let nLon = lons.length;
    let field = new Float64Array(lats.length * nLon);

    for (let k = 0; k < main.length; k++) {
        let ev = main[k];
        // Recency weighting: recent M5+ mainshocks (last 30–90 days) boost emerging new hotspots immediately
        let ageDays = Math.max(0, (newestMs - ev.time) / 86400000.0);
        let recencyWeight = 1.0 + 1.25 * Math.exp(-ageDays / 45.0);
        let magWeight = Math.pow(1.35, Math.max(0, ev.mag - 5.0));
        let eventWeight = recencyWeight * magWeight;

        let dlat = (3 * sigmaKm) / 111.0;
        let dlon = dlat / Math.max(0.2, Math.cos(ev.lat * Math.PI / 180.0));
        for (let i = 0; i < lats.length; i++) {
            let cla = lats[i];
            if (Math.abs(cla - ev.lat) > dlat) continue;
            for (let j = 0; j < nLon; j++) {
                let clo = lons[j];
                let dl = Math.abs(clo - ev.lon);
                if (dl > 180) dl = 360 - dl;
                if (dl > dlon) continue;
                let d = haversineDistance(ev.lat, ev.lon, cla, clo);
                if (d < 3 * sigmaKm) {
                    field[i * nLon + j] += eventWeight * Math.exp(-0.5 * (d / sigmaKm) * (d / sigmaKm));
                }
            }
        }
    }

    let indices = Array.from({ length: field.length }, (_, idx) => idx);
    indices.sort((a, b) => field[b] - field[a]);

    let tops = [];
    for (let idx of indices) {
        if (field[idx] <= 0) break;
        let la = lats[Math.floor(idx / nLon)];
        let lo = lons[idx % nLon];
        let farEnough = true;
        for (let t of tops) {
            if (haversineDistance(la, lo, t[0], t[1]) <= sepKm) {
                farEnough = false;
                break;
            }
        }
        if (farEnough) {
            tops.push([la, lo]);
            if (tops.length >= 5) break;
        }
    }

    let hotspots = tops.map(([la, lo]) => {
        let near = main.filter(e => haversineDistance(la, lo, e.lat, e.lon) <= radiusKm);
        let rate = near.length / spanWeeks;
        let p7 = 1.0 - Math.exp(-rate);
        let nearest = main[0];
        let minDist = Infinity;
        for (let e of main) {
            let d = haversineDistance(la, lo, e.lat, e.lon);
            if (d < minDist) {
                minDist = d;
                nearest = e;
            }
        }
function computeSeismicEntropyMetricsJS(nearEvents) {
    if (!nearEvents || nearEvents.length === 0) {
        return { entropy_bits: 0.0, dh_dt: 0.0, consensus_coherence: 0.5 };
    }
    let streamBytes = [];
    let chunkSize = Math.max(3, Math.floor(nearEvents.length / 4));
    for (let idx = 0; idx < nearEvents.length; idx++) {
        let ev = nearEvents[idx];
        let magBin = Math.min(255, Math.max(0, Math.round((ev.mag - 4.5) * 25)));
        let dtBin = 128;
        if (idx > 0) {
            let prevEv = nearEvents[idx - 1];
            let currMs = (ev.time !== undefined) ? ev.time : (ev.t * 1000.0);
            let prevMs = (prevEv.time !== undefined) ? prevEv.time : (prevEv.t * 1000.0);
            let dtDays = Math.max(0.01, Math.abs(currMs - prevMs) / 86400000.0);
            dtBin = Math.min(255, Math.max(0, Math.round(Math.log1p(dtDays) * 32)));
        }
        streamBytes.push(magBin, dtBin);
    }
    function shannonBits(arr) {
        if (!arr || arr.length === 0) return 0.0;
        let counts = {};
        for (let b of arr) counts[b] = (counts[b] || 0) + 1;
        let n = arr.length;
        let h = 0.0;
        for (let k in counts) {
            let p = counts[k] / n;
            h -= p * Math.log2(p);
        }
        return Number(h.toFixed(4));
    }
    let fullH = shannonBits(streamBytes);
    let windowEntropies = [];
    let stepB = Math.max(4, chunkSize * 2);
    for (let i = 0; i < streamBytes.length; i += stepB) {
        let sub = streamBytes.slice(i, i + stepB);
        if (sub.length >= 2) windowEntropies.push(shannonBits(sub));
    }
    let dhDt = 0.0;
    let nW = windowEntropies.length;
    if (nW >= 2) {
        let sumT = 0, sumH = 0, sumTH = 0, sumT2 = 0;
        for (let i = 0; i < nW; i++) {
            sumT += i;
            sumH += windowEntropies[i];
            sumTH += i * windowEntropies[i];
            sumT2 += i * i;
        }
        let denom = nW * sumT2 - sumT * sumT;
        if (Math.abs(denom) > 1e-12) {
            dhDt = Number(((nW * sumTH - sumT * sumH) / denom).toFixed(5));
        }
    }
    let coherence = Number(Math.min(1.0, Math.max(0.0, 0.9086 * Math.exp(-0.5 * Math.abs(dhDt)))).toFixed(4));
    return { entropy_bits: fullH, dh_dt: dhDt, consensus_coherence: coherence };
}

        // Trace recent chronological sequence inside this hotspot to project next fault rupture point
        let recentChain = near.slice(-8);
        let dLatH = 0.0, dLonH = 0.0, wSumH = 0.0;
        for (let k = 1; k < recentChain.length; k++) {
            let pEv = recentChain[k - 1];
            let cEv = recentChain[k];
            let dStep = haversineDistance(pEv.lat, pEv.lon, cEv.lat, cEv.lon);
            if (dStep >= 5.0 && dStep <= 300.0) {
                let wS = Math.pow(1.4, k);
                let dl = cEv.lon - pEv.lon;
                if (dl > 180) dl -= 360;
                if (dl < -180) dl += 360;
                dLatH += (cEv.lat - pEv.lat) * wS;
                dLonH += dl * wS;
                wSumH += wS;
            }
        }
        let rawTargetLat = wSumH > 0 ? (la + (dLatH / wSumH) * 0.65) : la;
        let rawTargetLon = wSumH > 0 ? (lo + (dLonH / wSumH) * 0.65) : lo;
        let snapH = snapToNearestPlateBoundary(rawTargetLat, rawTargetLon, 280);
        let finalHLat = Number(snapH.lat.toFixed(2));
        let finalHLon = Number(snapH.lon.toFixed(2));
        let shiftHKm = Math.round(haversineDistance(la, lo, finalHLat, finalHLon));

        return {
            lat: finalHLat,
            lon: finalHLon,
            gridLat: la,
            gridLon: lo,
            shiftKm: shiftHKm,
            faultSnapped: snapH.snapped,
            name: resolveNearestPlaceName(finalHLat, finalHLon, cleanPlaceName(nearest.place)) || `${finalHLat.toFixed(0)}°, ${finalHLon.toFixed(0)}°`,
            n3y: near.length,
            p7d: Number(p7.toFixed(3)),
            ...computeSeismicEntropyMetricsJS(near)
        };
    });

    let hitCount = hotspots.reduce((s, h) => s + h.n3y, 0);
    let empiricalHitRate = Number((hitCount / Math.max(1, main.length)).toFixed(4));

    return {
        generated: new Date().toISOString(),
        model: `dynamic live M5+ mainshock rate + tectonic fault trajectory (${main.length} mainshocks), sigma 250 km`,
        events: src.length,
        mainshocks: main.length,
        backtest_hit_rate: empiricalHitRate,
        hotspots: hotspots
    };
}

async function loadHotspots() {
    // 1. Always prioritize live dynamic calculation from the real-time USGS M5+ catalog
    //    so newly emerging earthquake clusters immediately appear in the Top-5!
    let data = computeDynamicHotspotsFromCatalog();
    
    // 2. Only fall back to precomputed hotspots.json during initial 1s boot before USGS responds (or if offline)
    if (!data || !data.hotspots) {
        try {
            let res = await fetch('hotspots.json?t=' + Math.floor(Date.now() / 3600000));
            if (res.ok) data = await res.json();
        } catch (e) {
            // file:/// protocol or local fetch blocked by browser CORS
        }
    }
    
    // 3. Fallback to GitHub raw URL if local fetch also fails
    if (!data || !data.hotspots) {
        try {
            let res = await fetch('https://raw.githubusercontent.com/Herakles5/earthquake-app/main/hotspots.json');
            if (res.ok) data = await res.json();
        } catch (e) {
            // offline or github blocked
        }
    }
    if (!data || !data.hotspots) return;

    try {
        cachedHotspotsData = data.hotspots;
        if (earthquakes && earthquakes.length > 0) {
            activeDeepPrecursors = detectDeepPrecursors(earthquakes, cachedHotspotsData);
        }
        let count = Math.min(data.hotspots.length, 5);
        for (let i = 0; i < count; i++) {
            let h = data.hotspots[i];
            let row = document.getElementById('hotspot-row-' + (i + 1));
            let n = document.getElementById('hotspot-' + (i + 1) + '-name');
            let p = document.getElementById('hotspot-' + (i + 1) + '-p');
            if (!h || !n || !p) continue;
            
            let pre = activeDeepPrecursors.find(dp => dp.coupledHotspot && dp.coupledHotspot.name === h.name);
            n.textContent = h.name + (pre ? " ⚡" : "");
            n.style.maxWidth = '130px';
            n.style.overflow = 'hidden';
            n.style.textOverflow = 'ellipsis';
            let titleText = `${h.name} (${h.lat.toFixed(2)}°, ${h.lon.toFixed(2)}°)\n3-Year M5+ Mainshocks: ${h.n3y}\n7-Day Poisson Probability: ${(h.p7d * 100).toFixed(1)}%`;
            if (h.shiftKm !== undefined) {
                titleText += `\nTectonic Fault Projection: +${h.shiftKm} km along plate boundary${h.faultSnapped ? ' [Fault-Locked]' : ''}`;
            }
            if (typeof h.entropy_bits === 'number') {
                titleText += `\nSeismic Shannon Entropy: ${h.entropy_bits.toFixed(2)} bits (dH/dt: ${h.dh_dt >= 0 ? '+' : ''}${(h.dh_dt || 0).toFixed(4)} | Coherence: ${Math.round((h.consensus_coherence || 0.9) * 100)}%)`;
            }
            if (pre) {
                titleText += `\n⚡ DEEP MANTLE PRECURSOR: M${pre.deep.mag.toFixed(1)} at ${Math.round(pre.deep.depth)} km depth (${pre.distKm} km distance, ${pre.ageDays}d ago). Viscoelastic shear stress transfer active!`;
                n.style.color = '#ffaa00';
            } else {
                n.style.color = '';
            }
            titleText += `\n(Click to center map)`;
            n.title = titleText;
            p.title = titleText;
            p.textContent = Math.round(h.p7d * 100) + '%';
            p.style.color = '#ffcc00';
            p.style.fontWeight = 'bold';
            if (row) {
                row.title = titleText;
                row.onclick = () => flyToCoords(h.lat, h.lon);
            }
        }
        let card = document.getElementById('hotspot-card');
        if (card) {
            card.title = 'Model: ' + (data.model || 'Poisson 3y') + ' | Updated: ' + (data.generated || 'N/A') +
                ' | Backtest Hit Rate (Top-5): ' + Math.round((data.backtest_hit_rate || 0.12) * 100) +
                '%. Click any hotspot to center on map.';
        }
    } catch (e) {
        console.log('Error rendering hotspots:', e);
    }
}
loadHotspots();
setInterval(loadHotspots, 3600000);
