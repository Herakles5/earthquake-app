/**
 * AION NEURO-SPECTRUM AUDIO-REACTIVE VISUALIZER
 * Realtime 60 FPS Visualizer with 4 modes:
 * 1. Nebula Galaxy (cosmic particle vortex with bass shockwaves)
 * 2. Neural Cognitive Sphere (3D morphed wireframe mesh)
 * 3. Cyberpunk Equalizer (glowing neon pillars with peak hold)
 * 4. Lissajous Scope (laser oscilloscope entropy curves)
 * 
 * Includes:
 * - Dynamic AGC (Auto Gain Control) & Sensitivity Pre-Amp (1x - 5x)
 * - Logarithmic Octave Bass/Mid/High Binning
 * - Built-in Cyber-Beat Synthesizer (Instant test track)
 * - Live System/Mic/Gaming Audio Capture
 */

class ReactiveVisualizer {
    constructor() {
        this.canvas = document.getElementById('visualizer-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.hudEnergy = document.getElementById('hud-energy');
        this.hudBeat = document.getElementById('hud-beat');
        this.hudFreq = document.getElementById('hud-freq');
        this.hudSignal = document.getElementById('hud-signal');

        this.currentMode = 'nebula';
        this.currentSource = 'ambient'; // 'ambient' | 'mic' | 'testbeat'

        this.analyser = null;
        this.micStream = null;
        this.micSource = null;
        this.dataArray = null;
        this.freqArray = null;

        // Sensitivity pre-amp multiplier (default 3.5x, up to 10.0x)
        this.sensitivity = 3.5;
        this.sensSlider = document.getElementById('slider-vis-sens');
        this.sensValEl = document.getElementById('val-vis-sens');

        // Test-Beat Generator state
        this.testBeatTimer = null;
        this.testBeatGain = null;

        // Visualizer internal state
        this.rotation = 0;
        this.beatDetected = false;
        this.beatDecay = 0;
        this.beatThreshold = 0.35;
        this.shockwaves = [];
        this.particles = [];
        this.particleGroups = [[], [], []];
        this.peakBars = [];

        // Dynamic AGC, Energy tracking & Signal Hysteresis
        this.rollingPeak = 25;
        this.smoothEnergy = 0.12;
        this.signalHoldFrames = 0;

        this.initCanvasSize();
        this.initParticles();
        this.initEvents();
        this.render();
    }

    initCanvasSize() {
        const resize = () => {
            const container = this.canvas.parentElement;
            this.canvas.width = container.clientWidth || 800;
            this.canvas.height = container.clientHeight || 500;
        };
        window.addEventListener('resize', resize);
        setTimeout(resize, 100);
    }

    initParticles() {
        this.particles = [];
        this.particleGroups = [[], [], []];
        const count = 220; // High visual fidelity with stable 60+ FPS
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.pow(Math.random(), 0.6) * 380;
            const groupIdx = i % 3;
            const p = {
                angle: angle,
                dist: dist,
                baseDist: dist,
                speed: (Math.random() * 0.005 + 0.002) * (Math.random() > 0.5 ? 1 : -1),
                size: Math.random() * 2.2 + 1.2,
                px: 0,
                py: 0
            };
            this.particles.push(p);
            this.particleGroups[groupIdx].push(p);
        }
    }

    setSource(source) {
        this.currentSource = source;
        const actx = window.AionApp.getAudioContext();

        // Cleanup test beat if active
        if (source !== 'testbeat') {
            this.stopTestBeat();
        }

        // Cleanup mic if not in mic mode
        if (source !== 'mic' && this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }

        document.getElementById('btn-source-ambient')?.classList.remove('active');
        document.getElementById('btn-source-mic')?.classList.remove('active');
        document.getElementById('btn-source-testbeat')?.classList.remove('active');

        if (source === 'ambient') {
            document.getElementById('btn-source-ambient')?.classList.add('active');
            if (window.ambientSanctuary && window.ambientSanctuary.analyser) {
                this.analyser = window.ambientSanctuary.analyser;
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
            }
            window.AionApp?.showToast('Audio Quelle: Ambient Sanctuary');
        } else if (source === 'mic') {
            document.getElementById('btn-source-mic')?.classList.add('active');
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const constraints = {
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        latency: { ideal: 0.005 },
                        channelCount: { ideal: 2 }
                    },
                    video: false
                };

                navigator.mediaDevices.enumerateDevices().then(devices => {
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    // Prefer dual_out monitor directly for zero-latency capture
                    const targetDevice = audioInputs.find(d => 
                        d.label.toLowerCase().includes('dual_out') ||
                        d.label.toLowerCase().includes('spotify')
                    );
                    if (targetDevice && targetDevice.deviceId) {
                        constraints.audio.deviceId = { ideal: targetDevice.deviceId };
                    }
                    return navigator.mediaDevices.getUserMedia(constraints);
                }).then(stream => {
                    this.micStream = stream;
                    if (!actx) return;
                    if (actx.state === 'suspended') actx.resume();

                    this.micSource = actx.createMediaStreamSource(stream);
                    this.analyser = actx.createAnalyser();
                    this.analyser.fftSize = 512;
                    this.analyser.smoothingTimeConstant = 0.05; // Zero visual lag (instant transient response)
                    this.micSource.connect(this.analyser);

                    // WebAudio Keep-Alive silent node: keeps Firefox pull clock permanently running
                    if (!this.keepAliveGain) {
                        this.keepAliveGain = actx.createGain();
                        this.keepAliveGain.gain.setValueAtTime(0, actx.currentTime);
                        this.keepAliveGain.connect(actx.destination);
                    }
                    try { this.analyser.connect(this.keepAliveGain); } catch(e) {}

                    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
                    
                    const track = stream.getAudioTracks()[0];
                    if (track) {
                        track.onended = () => {
                            console.warn('Live audio track ended, auto-reconnecting stream...');
                            if (this.currentSource === 'mic') {
                                setTimeout(() => this.setSource('mic'), 500);
                            }
                        };
                    }
                    const label = track?.label || 'Desktop / System Stream';
                    window.AionApp?.showToast(`🎙️ Live Audio Input Aktiv (${label})`);
                }).catch(err => {
                    console.warn('Live audio capture retry:', err);
                    window.AionApp?.showToast('🎙️ Live Audio wird synchronisiert...');
                    setTimeout(() => {
                        if (this.currentSource === 'mic') this.setSource('mic');
                    }, 1500);
                });
            }
        } else if (source === 'testbeat') {
            document.getElementById('btn-source-testbeat')?.classList.add('active');
            this.startTestBeat();
            window.AionApp?.showToast('⚡ Cyber Synthwave Test-Track gestartet!');
        }
    }

    startTestBeat() {
        const actx = window.AionApp.getAudioContext();
        if (!actx) return;
        if (actx.state === 'suspended') actx.resume();

        this.testBeatGain = actx.createGain();
        this.testBeatGain.gain.setValueAtTime(0.4, actx.currentTime);

        this.analyser = actx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.8;

        this.testBeatGain.connect(this.analyser);
        this.analyser.connect(actx.destination);

        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);

        let step = 0;
        const bpm = 124;
        const intervalMs = (60 / bpm / 2) * 1000; // 16th notes

        const synthNotes = [110, 110, 130.81, 146.83, 164.81, 146.83, 130.81, 98];

        const tickBeat = () => {
            if (this.currentSource !== 'testbeat') return;
            const now = actx.currentTime;

            // Kick Drum on quarter notes (steps 0, 4, 8, 12)
            if (step % 4 === 0) {
                const kickOsc = actx.createOscillator();
                const kickGain = actx.createGain();
                kickOsc.type = 'sine';
                kickOsc.frequency.setValueAtTime(140, now);
                kickOsc.frequency.exponentialRampToValueAtTime(35, now + 0.12);
                kickGain.gain.setValueAtTime(0.6, now);
                kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                kickOsc.connect(kickGain);
                kickGain.connect(this.testBeatGain);
                kickOsc.start(now);
                kickOsc.stop(now + 0.2);
            }

            // Synth Bass Arpeggio on every 8th note
            if (step % 2 === 0) {
                const note = synthNotes[(step / 2) % synthNotes.length];
                const bassOsc = actx.createOscillator();
                const bFilter = actx.createBiquadFilter();
                const bassGain = actx.createGain();

                bassOsc.type = 'sawtooth';
                bassOsc.frequency.setValueAtTime(note, now);

                bFilter.type = 'lowpass';
                bFilter.frequency.setValueAtTime(450 + Math.sin(step * 0.4) * 350, now);

                bassGain.gain.setValueAtTime(0.2, now);
                bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

                bassOsc.connect(bFilter);
                bFilter.connect(bassGain);
                bassGain.connect(this.testBeatGain);
                bassOsc.start(now);
                bassOsc.stop(now + 0.16);
            }

            step = (step + 1) % 16;
            this.testBeatTimer = setTimeout(tickBeat, intervalMs);
        };

        tickBeat();
    }

    stopTestBeat() {
        if (this.testBeatTimer) clearTimeout(this.testBeatTimer);
        if (this.testBeatGain) {
            try { this.testBeatGain.disconnect(); } catch(e) {}
            this.testBeatGain = null;
        }
    }

    setMode(mode) {
        this.currentMode = mode;
        document.querySelectorAll('.vis-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        window.AionApp?.showToast(`Modus: ${mode.toUpperCase()}`);
    }

    updateAudioData() {
        // Continuous AudioContext Watchdog: ensure it is always running
        const actx = window.AionApp.getAudioContext();
        if (actx && actx.state === 'suspended') {
            actx.resume().catch(() => {});
        }

        // Live Mic / System Audio Stream Watchdog
        if (this.currentSource === 'mic' && this.micStream) {
            const track = this.micStream.getAudioTracks()[0];
            if (track && (track.readyState === 'ended' || !track.enabled)) {
                if (!this.isReconnecting) {
                    this.isReconnecting = true;
                    setTimeout(() => {
                        this.setSource('mic');
                        this.isReconnecting = false;
                    }, 800);
                }
            }
        }

        if (!this.analyser) {
            if (this.currentSource === 'mic') {
                return { energy: 0.14, bass: 0.1, mid: 0, high: 0, domFreq: 0, agcScale: 1.0 };
            }
            if (window.ambientSanctuary && window.ambientSanctuary.analyser) {
                this.analyser = window.ambientSanctuary.analyser;
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
            } else {
                return { energy: 0.12, bass: 0, mid: 0, high: 0, domFreq: 0, agcScale: 1.0 };
            }
        }

        this.analyser.getByteTimeDomainData(this.dataArray);
        this.analyser.getByteFrequencyData(this.freqArray);

        const binCount = this.freqArray.length;

        // 1. Calculate direct RMS audio power
        let sumSquares = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            const norm = (this.dataArray[i] - 128) / 128.0;
            sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / this.dataArray.length);

        // 2. Find peak frequency, starting at index 1 to ignore DC offset (0 Hz artifact)
        let maxRaw = 0;
        let maxIndex = 1;
        for (let i = 1; i < binCount; i++) {
            if (this.freqArray[i] > maxRaw) {
                maxRaw = this.freqArray[i];
                maxIndex = i;
            }
        }

        // 3. Fast adaptive AGC tracking (Instant attack, rapid 0.5s decay)
        if (maxRaw > this.rollingPeak) {
            this.rollingPeak = maxRaw;
        } else {
            this.rollingPeak = Math.max(14, this.rollingPeak * 0.95);
        }

        // 4. Pre-Amp Gain Multiplier (sensitivity range 1.0x - 10.0x)
        const effectivePeak = Math.max(8, this.rollingPeak);
        const gainMult = (this.sensitivity / 2.5);
        const agcScale = (255.0 / effectivePeak) * gainMult;

        // 5. Band Integration
        const bassEnd = Math.max(2, Math.floor(binCount * 0.15));
        const midEnd = Math.floor(binCount * 0.55);

        let bassSum = 0, midSum = 0, highSum = 0, totalSum = 0;
        for (let i = 1; i < binCount; i++) {
            const amplified = Math.min(255, this.freqArray[i] * agcScale);
            totalSum += amplified;

            if (i < bassEnd) bassSum += amplified;
            else if (i < midEnd) midSum += amplified;
            else highSum += amplified;
        }

        const freqEnergy = totalSum / ((binCount - 1) * 255.0);
        const rmsEnergy = Math.min(1.0, rms * 8.0 * gainMult);
        const rawEnergy = Math.max(freqEnergy, rmsEnergy);

        // 6. Smooth energy: instant attack, punchy transient response
        if (rawEnergy > this.smoothEnergy) {
            this.smoothEnergy = rawEnergy;
        } else {
            this.smoothEnergy = this.smoothEnergy * 0.80 + rawEnergy * 0.20;
        }

        // 7. Sensitivity-Scaled Signal Detection & Hysteresis Hold (360 frames / ~6.0s for Spotify gapless flow)
        const amplifiedPeak = maxRaw * gainMult;
        const amplifiedRms = rms * gainMult;
        const instantSignal = amplifiedPeak >= 2 || amplifiedRms >= 0.0006;

        if (instantSignal) {
            this.signalHoldFrames = 360; // 6 seconds persistent hold over inter-song buffers & intros
        } else if (this.signalHoldFrames > 0) {
            this.signalHoldFrames--;
        }

        const hasSignal = instantSignal || (this.signalHoldFrames > 0);

        // Continuous fluid organic dance energy: never collapses to zero during playback or song breaks!
        const energy = hasSignal 
            ? Math.min(1.0, Math.max(0.14, this.smoothEnergy))
            : Math.max(0.10, this.smoothEnergy * 0.5);

        const bass = Math.min(1.0, (bassSum / ((bassEnd - 1) * 255.0)) * 1.3);
        const mid = Math.min(1.0, midSum / ((midEnd - bassEnd) * 255.0));
        const high = Math.min(1.0, highSum / ((binCount - midEnd) * 255.0));

        // Dominant frequency calculation (accurate pitch tracking)
        const nyquist = (window.AionApp.getAudioContext()?.sampleRate || 44100) / 2;
        let domFreq = 0;
        if (hasSignal && maxRaw >= 2) {
            domFreq = Math.round((maxIndex / binCount) * nyquist);
        }

        // Adaptive Beat Detection with Shockwave Cap
        this.beatThreshold = (this.beatThreshold || 0.35) * 0.95 + bass * 0.05;
        const triggerThreshold = Math.max(0.26, this.beatThreshold * 1.30);

        if (bass > triggerThreshold && this.beatDecay <= 0) {
            this.beatDetected = true;
            this.beatDecay = 10;
            if (this.shockwaves.length < 5) {
                this.shockwaves.push({ r: 20, maxR: 280, alpha: 1.0, color: '#ff00ff' });
            }
        } else {
            this.beatDetected = false;
            if (this.beatDecay > 0) this.beatDecay--;
        }

        // Update HUD indicators
        this.hudEnergy.textContent = `${Math.round(energy * 100)}%`;
        this.hudFreq.textContent = domFreq > 0 ? `${domFreq} Hz` : (hasSignal ? 'TRACKING' : '--- Hz');

        if (this.hudSignal) {
            if (!hasSignal) {
                this.hudSignal.textContent = 'STANDBY / AMBIENT FLOW';
                this.hudSignal.style.color = '#8892b0';
            } else if (energy > 0.65) {
                this.hudSignal.textContent = 'SIGNAL PEAK 🔥';
                this.hudSignal.style.color = '#ff00ff';
            } else if (instantSignal) {
                this.hudSignal.textContent = 'SIGNAL OPTIMAL ✨';
                this.hudSignal.style.color = '#00ffcc';
            } else {
                this.hudSignal.textContent = 'STREAM BUFFERING 🎵';
                this.hudSignal.style.color = '#ffd166';
            }
        }

        if (this.beatDetected) {
            this.hudBeat.textContent = 'BASS HIT!';
            this.hudBeat.classList.add('active');
        } else {
            this.hudBeat.textContent = 'TRACKING';
            this.hudBeat.classList.remove('active');
        }

        return { energy, bass, mid, high, domFreq, agcScale };
    }

    render() {
        requestAnimationFrame(this.render.bind(this));
        if (!document.getElementById('tab-visualizer')?.classList.contains('active')) {
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        const metrics = this.updateAudioData();

        // Smooth background fade
        this.ctx.fillStyle = 'rgba(4, 5, 8, 0.22)';
        this.ctx.fillRect(0, 0, w, h);

        this.rotation += 0.005 + metrics.bass * 0.02;

        // Draw Shockwaves
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const sw = this.shockwaves[i];
            sw.r += 7 + metrics.bass * 6;
            sw.alpha -= 0.028;
            if (sw.alpha <= 0 || sw.r >= sw.maxR) {
                this.shockwaves.splice(i, 1);
                continue;
            }
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, sw.r, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(255, 0, 255, ${sw.alpha * 0.8})`;
            this.ctx.lineWidth = 2.8;
            this.ctx.stroke();
        }

        switch (this.currentMode) {
            case 'nebula':
                this.renderNebula(cx, cy, metrics);
                break;
            case 'sphere':
                this.renderNeuralSphere(cx, cy, metrics);
                break;
            case 'bars':
                this.renderEqualizerBars(w, h, metrics);
                break;
            case 'lissajous':
                this.renderLissajousScope(cx, cy, metrics);
                break;
        }
    }

    renderNebula(cx, cy, { energy, bass, mid, high }) {
        const coreR = 25 + bass * 55;
        const grad = this.ctx.createRadialGradient(cx, cy, 4, cx, cy, coreR);
        grad.addColorStop(0, 'rgba(0, 255, 204, 0.95)');
        grad.addColorStop(0.5, 'rgba(157, 78, 221, 0.65)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.ctx.beginPath();
        this.ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        this.ctx.fillStyle = grad;
        this.ctx.fill();

        // Update particle positions with continuous, fluid galactic dance
        const rot = this.rotation;
        const bassOffset = bass * 50;
        const baselineDrift = 1.8;
        const reactiveSpeed = (energy * 3.8) * (this.sensitivity / 2.5);
        const speedMultiplier = baselineDrift + reactiveSpeed;
        const cosmicBreath = Math.sin(performance.now() * 0.0016) * 10;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            p.angle += p.speed * speedMultiplier;
            const distDynamic = p.baseDist + Math.sin(p.angle * 3 + rot) * (bassOffset + energy * 20) + cosmicBreath;
            p.px = cx + Math.cos(p.angle + rot) * distDynamic;
            p.py = cy + Math.sin(p.angle + rot) * distDynamic;
        }

        const haloColors = [
            'rgba(0, 255, 204, 0.22)',
            'rgba(255, 0, 255, 0.22)',
            'rgba(157, 78, 221, 0.25)'
        ];
        const coreColors = [
            '#00ffcc',
            '#ff00ff',
            '#bd7eff'
        ];

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';

        // Pass 1: Glowing Halos (batch drawn per color group, 0 shadowBlur)
        for (let g = 0; g < 3; g++) {
            const group = this.particleGroups[g];
            this.ctx.fillStyle = haloColors[g];
            this.ctx.beginPath();
            for (let i = 0; i < group.length; i++) {
                const p = group[i];
                const haloR = (p.size + high * 3.0) * 2.5;
                this.ctx.moveTo(p.px + haloR, p.py);
                this.ctx.arc(p.px, p.py, haloR, 0, Math.PI * 2);
            }
            this.ctx.fill();
        }

        // Pass 2: Crisp Star Cores (batch drawn per color group)
        for (let g = 0; g < 3; g++) {
            const group = this.particleGroups[g];
            this.ctx.fillStyle = coreColors[g];
            this.ctx.beginPath();
            for (let i = 0; i < group.length; i++) {
                const p = group[i];
                const sz = p.size + high * 1.5;
                this.ctx.moveTo(p.px + sz, p.py);
                this.ctx.arc(p.px, p.py, sz, 0, Math.PI * 2);
            }
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    renderNeuralSphere(cx, cy, { energy, bass, mid, agcScale }) {
        this.ctx.save();
        this.ctx.translate(cx, cy);

        const latSegments = 16;
        const lonSegments = 24;
        const baseRadius = Math.min(cx, cy) * 0.52;

        this.ctx.strokeStyle = '#00ffcc';
        this.ctx.lineWidth = 1.3;

        for (let i = 0; i < latSegments; i++) {
            const theta = (i / latSegments) * Math.PI;
            this.ctx.beginPath();

            for (let j = 0; j <= lonSegments; j++) {
                const phi = (j / lonSegments) * Math.PI * 2 + this.rotation;
                const freqMod = this.freqArray ? ((this.freqArray[(i * 4 + j) % this.freqArray.length] * (agcScale || 1)) / 255) : 0;
                const r = baseRadius * (1 + Math.min(0.6, freqMod * 0.45) + bass * 0.2);

                const x = r * Math.sin(theta) * Math.cos(phi);
                const y = r * Math.cos(theta);

                if (j === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.strokeStyle = `rgba(0, 255, 204, ${0.35 + (i / latSegments) * 0.5})`;
            this.ctx.stroke();
        }

        this.ctx.beginPath();
        this.ctx.arc(0, 0, 18 + bass * 30, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(255, 0, 255, 0.85)';
        this.ctx.fill();

        this.ctx.beginPath();
        this.ctx.arc(0, 0, 10 + bass * 15, 0, Math.PI * 2);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();

        this.ctx.restore();
    }

    renderEqualizerBars(w, h, { energy, bass, agcScale }) {
        if (!this.freqArray) return;
        const bars = 48;
        const spacing = 4;
        const totalW = w * 0.85;
        const barW = (totalW / bars) - spacing;
        const startX = (w - totalW) / 2;

        for (let i = 0; i < bars; i++) {
            const binIdx = Math.floor((i / bars) * (this.freqArray.length * 0.75));
            const val = Math.min(1.0, (this.freqArray[binIdx] * (agcScale || 1.0)) / 255.0);
            const barH = Math.max(5, val * (h * 0.68));
            const x = startX + i * (barW + spacing);
            const y = h * 0.82 - barH;

            if (!this.peakBars[i] || barH > this.peakBars[i]) {
                this.peakBars[i] = barH;
            } else {
                this.peakBars[i] = Math.max(0, this.peakBars[i] - 2.0);
            }

            const grad = this.ctx.createLinearGradient(x, y, x, h * 0.82);
            grad.addColorStop(0, '#00ffcc');
            grad.addColorStop(0.5, '#9d4edd');
            grad.addColorStop(1, '#ff0055');

            this.ctx.fillStyle = grad;
            this.ctx.fillRect(x, y, barW, barH);

            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(x, h * 0.82 - this.peakBars[i] - 3, barW, 2);
        }

        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, h * 0.82);
        this.ctx.lineTo(startX + totalW, h * 0.82);
        this.ctx.stroke();
    }

    renderLissajousScope(cx, cy, { energy, bass, mid, agcScale }) {
        if (!this.dataArray) return;
        const count = this.dataArray.length;
        const radius = Math.min(cx, cy) * 0.65;

        this.ctx.save();
        this.ctx.translate(cx, cy);

        const a = 3 + Math.floor(bass * 3);
        const b = 2 + Math.floor(mid * 3);
        const delta = this.rotation * 2;

        // Curve 1: Primary Scope
        this.ctx.beginPath();
        for (let i = 0; i <= count; i++) {
            const t = (i / count) * Math.PI * 2;
            const audioVal = ((this.dataArray[i % count] - 128) / 128) * this.sensitivity;
            const r = radius * (1 + audioVal * 0.5);

            const x = r * Math.sin(a * t + delta);
            const y = r * Math.cos(b * t);

            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        // Halo
        this.ctx.lineWidth = 5.0;
        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.25)';
        this.ctx.stroke();
        // Sharp core
        this.ctx.lineWidth = 2.0;
        this.ctx.strokeStyle = '#00ffcc';
        this.ctx.stroke();

        // Curve 2: Harmonic Secondary Scope
        this.ctx.beginPath();
        for (let i = 0; i <= count; i += 2) {
            const t = (i / count) * Math.PI * 2;
            const audioVal = ((this.dataArray[i % count] - 128) / 128) * this.sensitivity;
            const r = (radius * 0.6) * (1 + audioVal * 0.6);
            const x = r * Math.cos(t * 2 + delta);
            const y = r * Math.sin(t * 3);
            if (i === 0) this.ctx.moveTo(x, y);
            else this.ctx.lineTo(x, y);
        }
        // Halo
        this.ctx.lineWidth = 4.0;
        this.ctx.strokeStyle = 'rgba(255, 0, 255, 0.25)';
        this.ctx.stroke();
        // Sharp core
        this.ctx.lineWidth = 1.8;
        this.ctx.strokeStyle = '#ff00ff';
        this.ctx.stroke();

        this.ctx.restore();
    }

    initEvents() {
        document.getElementById('btn-source-ambient')?.addEventListener('click', () => this.setSource('ambient'));
        document.getElementById('btn-source-mic')?.addEventListener('click', () => this.setSource('mic'));
        document.getElementById('btn-source-testbeat')?.addEventListener('click', () => this.setSource('testbeat'));

        this.sensSlider?.addEventListener('input', (e) => {
            this.sensitivity = parseInt(e.target.value, 10) / 10.0;
            this.sensValEl.textContent = `${this.sensitivity.toFixed(1)}x`;
        });

        document.querySelectorAll('.vis-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
        });

        document.getElementById('btn-vis-fullscreen')?.addEventListener('click', () => {
            const container = this.canvas.parentElement;
            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen();
            }
        });
    }
}
