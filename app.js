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
            if (!isDuplicate) earthquakes.push(eq);
        }
        
        eqList.innerHTML = '';
        for (let i = 0; i < Math.min(25, earthquakes.length); i++) {
            let eq = earthquakes[i];
            let li = document.createElement('li');
            let color = eq.mag >= 5.0 ? '#ff3333' : (eq.mag >= 4.0 ? '#ff8800' : '#ffff00');
            li.style.color = color;
            
            let d = new Date(eq.time);
            let timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            
            li.textContent = `[${timeStr}] M${eq.mag.toFixed(1)} - ${eq.place}`;
            eqList.appendChild(li);
        }
        
        if (earthquakes.length > 0) {
            let newestEq = earthquakes[0];
            if (lastLatestTime > 0 && newestEq.time > lastLatestTime) {
                // New earthquake!
                playBeep();
                
                // Auto zoom & pan
                let r = ((90.0 - newestEq.lat) / 180.0) * 723.0;
                let angle = newestEq.lon * Math.PI / 180.0;
                let map_x = r * Math.sin(angle);
                let map_y = r * Math.cos(angle);
                
                zoom = 2.5; // Zoom in
                let targetScale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
                offsetX = -map_x * targetScale;
                offsetY = -map_y * targetScale;
            }
            lastLatestTime = newestEq.time;
        }
        
        statusDiv.textContent = `${earthquakes.length} earthquakes mapped.`;
    } catch (e) {
        statusDiv.textContent = "Failed to load data.";
        statusDiv.style.color = "red";
    }
}

fetchEarthquakes();
setInterval(fetchEarthquakes, 60000); // refresh every minute

function draw() {
    ctx.clearRect(0, 0, width, height);
    
    let mapCx = width / 2 + offsetX;
    let mapCy = height / 2 + offsetY;
    let scale = (Math.min(width, height) * 0.45 / 723.0) * zoom;
    
    // Draw Coastlines
    ctx.beginPath();
    ctx.strokeStyle = "rgba(100, 150, 100, 0.5)";
    ctx.lineWidth = 1;
    
    // coast_lines is loaded from coastlines.js
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
    
    // Draw Earthquakes
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
