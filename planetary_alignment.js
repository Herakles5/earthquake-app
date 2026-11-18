/**
 * Planetary Alignment & Celestial Resonance Engine v1.0
 * Pure-JS, zero-dependency celestial mechanics calculator for seismic triggering models.
 *
 * Computes:
 *   1. Heliocentric Ecliptic Longitudes (Sun-centered VSOP87 truncated series)
 *   2. Geocentric Ecliptic Longitudes (Earth-centered sky positions)
 *   3. Real-time Earth Distances (AU) & Instantaneous Gravitational Tidal Pull (M/r³)
 *   4. Quadrupole Tidal Symmetry (Conjunction 0° + Opposition 180° along the same axis)
 *   5. Significant Aspects (Conjunctions, Oppositions, Grand Alignments)
 *   6. Planetary Alignment Index (0.0 – 1.0) and Coulomb Trigger Multiplier (1.000x – 1.030x)
 *   7. Interactive / High-DPI Canvas Visualizer (Solar System Orrery with alignment rays)
 *
 * References:
 *   - Jean Meeus, "Astronomical Algorithms", 2nd Ed.
 *   - Tanaka et al., "Tidal triggering of earthquakes", JGR 2002
 *   - Scafetta, "Empirical evidence for a celestial origin of the climate/seismic oscillations", 2010
 */

(function (global) {
    'use strict';

    const DEG = Math.PI / 180.0;
    const RAD = 180.0 / Math.PI;

    // Julian Date conversion
    function toJDE(msUtc) {
        return msUtc / 86400000.0 + 2440587.5;
    }
    function toT(jde) {
        return (jde - 2451545.0) / 36525.0;
    }

    // VSOP87 Truncated Mean Longitudes (degrees, modulo 360)
    // L = L0 + L1*T + L2*T²
    const VSOP_L = {
        Mercury: [252.250906, 149472.6746358, -0.00000536],
        Venus:   [181.979801,  58517.8156760,  0.00030368],
        Earth:   [100.466449,  36000.7698231,  0.00030368],
        Mars:    [355.433275,  19140.2993313,  0.00000261],
        Jupiter: [ 34.351484,   3034.9056746, -0.00008501],
        Saturn:  [ 50.077444,   1222.1137943,  0.00021004],
        Uranus:  [314.055005,    428.4669983, -0.00000486],
        Neptune: [304.348665,    218.4862002,  0.00000059]
    };

    // Semi-major axis (AU), Mass (relative to Earth), symbol, display color
    const PLANET_DATA = {
        Mercury: { a: 0.387098, mass: 0.0553, symbol: '☿', color: '#aaaaaa', nameDE: 'Merkur' },
        Venus:   { a: 0.723332, mass: 0.8150, symbol: '♀', color: '#ffee88', nameDE: 'Venus' },
        Earth:   { a: 1.000000, mass: 1.0000, symbol: '🌍', color: '#00e5ff', nameDE: 'Erde' },
        Mars:    { a: 1.523679, mass: 0.1070, symbol: '♂', color: '#ff6633', nameDE: 'Mars' },
        Jupiter: { a: 5.2044,   mass: 317.83, symbol: '♃', color: '#ffaa44', nameDE: 'Jupiter' },
        Saturn:  { a: 9.5826,   mass: 95.16,  symbol: '♄', color: '#eedd77', nameDE: 'Saturn' },
        Uranus:  { a: 19.2184,  mass: 14.54,  symbol: '⛢', color: '#77e0ff', nameDE: 'Uranus' },
        Neptune: { a: 30.1104,  mass: 17.15,  symbol: '♆', color: '#4488ff', nameDE: 'Neptun' }
    };

    // Moon reference tidal force parameter (Earth mass units and AU)
    // Moon mass = 0.0123 M_Earth, mean distance = 0.002570 AU
    const MOON_TIDAL_CONST = 0.01230 / Math.pow(0.002570, 3); // ~724,738

    function normDeg(d) {
        return ((d % 360.0) + 360.0) % 360.0;
    }

    function angularDiff(a, b) {
        let diff = Math.abs(normDeg(a) - normDeg(b));
        return diff > 180 ? 360 - diff : diff;
    }

    /**
     * Compute full planetary state for a given timestamp.
     */
    function computePlanetaryState(nowMs = Date.now()) {
        const jde = toJDE(nowMs);
        const T = toT(jde);

        // 1. Heliocentric Longitudes
        const helio = {};
        for (const [p, c] of Object.entries(VSOP_L)) {
            helio[p] = normDeg(c[0] + c[1] * T + c[2] * T * T);
        }

        // Earth heliocentric position
        const eL = helio.Earth * DEG;
        const ex = Math.cos(eL);
        const ey = Math.sin(eL);

        // Sun geocentric longitude in Earth's sky
        const sunGeoLon = normDeg(helio.Earth + 180.0);

        // 2. Geocentric positions, Earth distances, and Tidal forces
        const bodies = {};
        let totalPlanetaryTidal = 0;

        for (const [p, data] of Object.entries(PLANET_DATA)) {
            if (p === 'Earth') continue;

            const pL = helio[p] * DEG;
            const px = data.a * Math.cos(pL);
            const py = data.a * Math.sin(pL);

            // Vector from Earth to planet
            const dx = px - ex;
            const dy = py - ey;
            const distAU = Math.hypot(dx, dy);
            const geoLon = normDeg(Math.atan2(dy, dx) * RAD);

            // Quadrupole tidal axis (0 to 180°)
            const quadAxis = geoLon % 180.0;

            // Instantaneous relative tidal force (Moon = 1.0)
            const tidalRel = (data.mass / Math.pow(distAU, 3)) / MOON_TIDAL_CONST;
            totalPlanetaryTidal += tidalRel;

            bodies[p] = {
                name: p,
                nameDE: data.nameDE,
                symbol: data.symbol,
                color: data.color,
                helioLon: helio[p],
                geoLon: geoLon,
                distAU: distAU,
                quadAxis: quadAxis,
                tidalRel: tidalRel
            };
        }

        // Add Sun's geocentric state
        // Sun mass = 332,946 M_Earth, dist = 1.0 AU
        const sunTidalRel = (332946.0 / 1.0) / MOON_TIDAL_CONST; // ~0.46
        bodies.Sun = {
            name: 'Sun',
            nameDE: 'Sonne',
            symbol: '☀️',
            color: '#ffff55',
            helioLon: 0,
            geoLon: sunGeoLon,
            distAU: 1.0,
            quadAxis: sunGeoLon % 180.0,
            tidalRel: sunTidalRel
        };

        // 3. Find Aspects (Conjunctions <= 10°, Oppositions >= 170°)
        const aspects = [];
        const bodyKeys = Object.keys(bodies);
        for (let i = 0; i < bodyKeys.length; i++) {
            for (let j = i + 1; j < bodyKeys.length; j++) {
                const b1 = bodies[bodyKeys[i]];
                const b2 = bodies[bodyKeys[j]];
                const diff = angularDiff(b1.geoLon, b2.geoLon);
                if (diff <= 10.0) {
                    aspects.push({
                        type: 'Conjunction',
                        symbol: '☌',
                        b1: b1.name,
                        b2: b2.name,
                        angle: diff,
                        label: `${b1.symbol} ${b1.name} ☌ ${b2.symbol} ${b2.name} (${diff.toFixed(1)}°)`
                    });
                } else if (diff >= 170.0) {
                    aspects.push({
                        type: 'Opposition',
                        symbol: '☍',
                        b1: b1.name,
                        b2: b2.name,
                        angle: 180.0 - diff,
                        label: `${b1.symbol} ${b1.name} ☍ ${b2.symbol} ${b2.name} (${diff.toFixed(1)}°)`
                    });
                }
            }
        }

        // 4. Find Best Alignment Cluster in Earth's Sky (or along Quadrupole Axis)
        // Check angular clusters in both 360° (sky sector) and 180° (quadrupole tidal beam)
        const allGeo = bodyKeys.map(k => ({ name: k, lon: bodies[k].geoLon, axis: bodies[k].quadAxis, tidal: bodies[k].tidalRel }));
        
        // Find best quadrupole alignment (cone of ±12.5°, i.e. 25° window)
        let bestQuad = { bodies: [], spread: 360, center: 0, tidalSum: 0 };
        const quadSorted = allGeo.slice().sort((a, b) => a.axis - b.axis);
        const extQuad = [...quadSorted, ...quadSorted.map(item => ({ ...item, axis: item.axis + 180 }))];

        for (let i = 0; i < quadSorted.length; i++) {
            const group = [extQuad[i]];
            const minA = extQuad[i].axis;
            let maxA = minA;
            let tSum = extQuad[i].tidal;

            for (let j = i + 1; j < extQuad.length; j++) {
                if (extQuad[j].axis - minA > 25.0) break;
                if (group.some(g => g.name === extQuad[j].name)) break;
                group.push(extQuad[j]);
                maxA = extQuad[j].axis;
                tSum += extQuad[j].tidal;
            }

            if (group.length > bestQuad.bodies.length ||
                (group.length === bestQuad.bodies.length && (maxA - minA) < bestQuad.spread)) {
                bestQuad = {
                    bodies: group.map(g => g.name),
                    spread: maxA - minA,
                    center: ((minA + maxA) / 2) % 180,
                    tidalSum: tSum
                };
            }
        }

        // 5. Planetary Alignment Index (0.0 to 1.0) and Multiplier (1.000 to 1.030)
        // Count score: 2 bodies = 0.2, 3 bodies = 0.5, 4 bodies = 0.75, 5+ = 1.0
        let countScore = 0;
        if (bestQuad.bodies.length >= 5) countScore = 1.00;
        else if (bestQuad.bodies.length === 4) countScore = 0.75;
        else if (bestQuad.bodies.length === 3) countScore = 0.50;
        else if (bestQuad.bodies.length === 2) countScore = 0.25;

        // Tightness score: 0° spread = 1.0, 25° spread = 0.0
        const tightnessScore = bestQuad.spread <= 25.0 ? (1.0 - bestQuad.spread / 25.0) : 0;

        // Alignment Index composite: 60% count, 40% tightness
        const index = Math.max(0, Math.min(1.0, countScore * 0.6 + tightnessScore * 0.4));

        // Coulomb Stress Trigger Multiplier: 1.000x to 1.030x (+0% to +3.0%)
        // Modulates the Gaia rhythm intervals
        const multiplier = 1.000 + (index * 0.030);

        // Classification
        let level = "LOW";
        let levelColor = "#88bbff";
        if (bestQuad.bodies.length >= 5) {
            level = "GRAND ALIGNMENT";
            levelColor = "#ff33ff";
        } else if (bestQuad.bodies.length === 4) {
            level = "MAJOR ALIGNMENT";
            levelColor = "#ff8800";
        } else if (bestQuad.bodies.length === 3) {
            level = "MODERATE ALIGNMENT";
            levelColor = "#ffe066";
        } else if (bestQuad.bodies.length === 2) {
            level = "MINOR ALIGNMENT";
            levelColor = "#00e5ff";
        }

        // Summary string for UI
        const symbolsStr = bestQuad.bodies.map(name => bodies[name]?.symbol || name).join(' ');
        const summaryText = `${symbolsStr} (${level})`;

        return {
            timestamp: nowMs,
            helio: helio,
            bodies: bodies,
            aspects: aspects,
            alignment: bestQuad,
            index: parseFloat(index.toFixed(3)),
            indexPercent: Math.round(index * 100),
            multiplier: parseFloat(multiplier.toFixed(4)),
            level: level,
            levelColor: levelColor,
            summaryText: summaryText,
            totalPlanetaryTidal: totalPlanetaryTidal
        };
    }

    /**
     * Draw an interactive Solar System Orrery with alignment axes on a canvas.
     */
    function drawPlanetWheel(canvas, state) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // High-DPI handling
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const displayW = rect.width || canvas.width || 300;
        const displayH = rect.height || canvas.height || 300;

        if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
            canvas.width = Math.round(displayW * dpr);
            canvas.height = Math.round(displayH * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, displayW, displayH);

        const cx = displayW / 2;
        const cy = displayH / 2;
        const maxR = Math.min(cx, cy) - 16;

        // Radial orbit scales (log-spaced for clean visibility of inner + outer planets)
        const orbitRadii = {
            Mercury: maxR * 0.18,
            Venus:   maxR * 0.28,
            Earth:   maxR * 0.40,
            Mars:    maxR * 0.52,
            Jupiter: maxR * 0.65,
            Saturn:  maxR * 0.77,
            Uranus:  maxR * 0.88,
            Neptune: maxR * 0.98
        };

        const alignedSet = new Set(state.alignment.bodies);

        // 1. Draw Orbit Rings
        for (const [p, r] of Object.entries(orbitRadii)) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = alignedSet.has(p) ? 'rgba(255, 220, 100, 0.25)' : 'rgba(80, 100, 140, 0.18)';
            ctx.lineWidth = alignedSet.has(p) ? 1.5 : 1.0;
            ctx.stroke();
        }

        // 2. Draw Alignment Beam / Cone
        if (state.alignment.bodies.length >= 2) {
            const radAngle = (state.alignment.center - 90) * DEG;
            const spreadRad = Math.max(state.alignment.spread * DEG, 0.15);

            // Primary cone
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, maxR * 1.02, radAngle - spreadRad / 2, radAngle + spreadRad / 2);
            ctx.closePath();
            ctx.fillStyle = `rgba(255, 200, 50, ${0.06 + state.index * 0.12})`;
            ctx.fill();

            // Opposite quadrupole beam (180°)
            const oppAngle = radAngle + Math.PI;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, maxR * 1.02, oppAngle - spreadRad / 2, oppAngle + spreadRad / 2);
            ctx.closePath();
            ctx.fillStyle = `rgba(255, 150, 50, ${0.04 + state.index * 0.08})`;
            ctx.fill();
        }

        // 3. Central Sun with Corona
        const sunGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
        sunGrad.addColorStop(0, '#ffffff');
        sunGrad.addColorStop(0.3, '#ffee44');
        sunGrad.addColorStop(0.8, '#ff8800');
        sunGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fillStyle = sunGrad;
        ctx.fill();

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#ffcc00';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☀️', cx, cy);

        // 4. Draw Planets
        for (const [p, r] of Object.entries(orbitRadii)) {
            const helioLon = state.helio[p];
            if (helioLon === undefined) continue;

            const angle = (helioLon - 90) * DEG;
            const px = cx + r * Math.cos(angle);
            const py = cy + r * Math.sin(angle);

            const isAligned = alignedSet.has(p);
            const dotR = isAligned ? 5 : 3.5;

            // Highlight ring for aligned planets
            if (isAligned) {
                ctx.beginPath();
                ctx.arc(px, py, dotR + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#ffe066';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Connect line to Sun
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(px, py);
                ctx.strokeStyle = 'rgba(255, 224, 102, 0.4)';
                ctx.setLineDash([2, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Planet dot
            ctx.beginPath();
            ctx.arc(px, py, dotR, 0, Math.PI * 2);
            ctx.fillStyle = PLANET_DATA[p]?.color || '#ffffff';
            ctx.fill();

            // Symbol & Name label
            const sym = PLANET_DATA[p]?.symbol || '';
            ctx.font = isAligned ? 'bold 12px sans-serif' : '10px sans-serif';
            ctx.fillStyle = isAligned ? '#ffffff' : '#88aacc';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(sym, px, py - dotR - 2);
        }

        ctx.restore();
    }

    // Public API
    global.PlanetaryAlignment = {
        compute: computePlanetaryState,
        drawWheel: drawPlanetWheel,
        PLANET_DATA: PLANET_DATA,
        angularDiff: angularDiff
    };

})(typeof window !== 'undefined' ? window : global);
