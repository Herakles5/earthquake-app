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

        this.canvas3D = document.getElementById('visualizer-3d-canvas');
        this.dancerBar = document.getElementById('vis-dancer-bar');
        this.hint3D = document.getElementById('vis-3d-hint');
        this.loading3D = document.getElementById('vis-3d-loading');
        this.loadingText3D = document.getElementById('vis-3d-loading-text');

        // 3D Cyber Dancer State
        this.currentDancer = 'miku';
        this.cameraDistance = 3.6;
        this.cameraAngleX = 0;
        this.cameraAngleY = 0.22;
        this.cameraTargetY = 1.05;
        this.dancers = {
            miku: {
                name: 'Hatsune Miku',
                url: 'models/miku_-_dance_animation.glb',
                scale: 1.0,
                offsetX: 0.0,
                offsetY: -0.12,
                offsetZ: 0.0,
                targetY: 1.05,
                style: 'Pop Idol Dance'
            },
            wednesday: {
                name: 'Wednesday Addams',
                url: 'models/wednesday_gangnam_style.glb',
                scale: 475.0,
                offsetX: 0.0,
                offsetY: 1.405,
                offsetZ: -1.05,
                targetY: 1.05,
                style: 'Gangnam Style'
            },
            stormtrooper: {
                name: 'Stormtrooper',
                url: 'models/dancing_stormtrooper.glb',
                scale: 0.695,
                offsetX: 0.0,
                offsetY: -0.026,
                offsetZ: 0.0,
                targetY: 1.10,
                style: 'Galactic Breakdance'
            },
            chicken: {
                name: 'Skeleton Chicken',
                url: 'models/skeleton_chicken_dance_1.glb',
                scale: 0.73,
                offsetX: 0.0,
                offsetY: 0.18,
                offsetZ: 0.0,
                targetY: 1.05,
                style: 'Funky Chicken Disco'
            },
            hiphop: {
                name: 'Hip-Hop Boy',
                url: 'models/hip_hop_dancing.glb',
                scale: 0.0453,
                offsetX: 0.0,
                offsetY: -0.011,
                offsetZ: 0.0,
                targetY: 1.05,
                style: 'Street Shuffling'
            }
        };

        this.is3DInitialized = false;
        this.modelCache = {};
        this.activeModel = null;
        this.activeMixer = null;
        this.activeAction = null;
        this.modelBaseY = 0;
        this.danceSpeed = 1.0;
        this.lastFrameTime3D = performance.now();
        this.cameraAngleX = 0;
        this.cameraAngleY = 0.22;
        this.cameraDistance = 4.2;
        this.isUserOrbiting = false;

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
            const w = container.clientWidth || 800;
            const h = container.clientHeight || 500;
            this.canvas.width = w;
            this.canvas.height = h;
            if (this.renderer3D && this.camera3D) {
                this.renderer3D.setSize(w, h);
                this.camera3D.aspect = w / h;
                this.camera3D.updateProjectionMatrix();
            }
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

        if (mode === 'dance3d') {
            this.canvas.style.display = 'none';
            if (this.canvas3D) this.canvas3D.style.display = 'block';
            if (this.dancerBar) this.dancerBar.style.display = 'flex';
            if (this.hint3D) this.hint3D.style.display = 'block';

            if (!this.is3DInitialized) {
                this.init3DScene();
            }
            if (this.renderer3D && this.camera3D && this.canvas3D) {
                const w = this.canvas3D.parentElement.clientWidth || 800;
                const h = this.canvas3D.parentElement.clientHeight || 500;
                this.renderer3D.setSize(w, h);
                this.camera3D.aspect = w / h;
                this.camera3D.updateProjectionMatrix();
            }
            window.AionApp?.showToast('Modus: 3D CYBER DANCER');
        } else {
            this.canvas.style.display = 'block';
            if (this.canvas3D) this.canvas3D.style.display = 'none';
            if (this.dancerBar) this.dancerBar.style.display = 'none';
            if (this.hint3D) this.hint3D.style.display = 'none';
            if (this.loading3D) this.loading3D.style.display = 'none';
            window.AionApp?.showToast(`Modus: ${mode.toUpperCase()}`);
        }
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

        const metrics = this.updateAudioData();

        if (this.currentMode === 'dance3d') {
            this.render3DDancer(metrics);
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;

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

    /* =========================================================================
       3D CYBER DANCER STAGE & BEAT-REACTIVE SKELETAL AVATAR ENGINE
       ========================================================================= */

    init3DScene() {
        if (typeof THREE === 'undefined') {
            console.error('Three.js is not loaded.');
            return;
        }

        const container = this.canvas3D.parentElement;
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 500;

        // 1. WebGL Renderer
        this.renderer3D = new THREE.WebGLRenderer({
            canvas: this.canvas3D,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer3D.setSize(w, h);
        if (THREE.sRGBEncoding) {
            this.renderer3D.outputEncoding = THREE.sRGBEncoding;
        }

        // 2. Scene & Orbit Camera
        this.scene3D = new THREE.Scene();
        this.camera3D = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this.cameraAngleX = 0;
        this.cameraAngleY = 0.25;
        this.cameraDistance = 4.3;
        this.updateCameraOrbit();

        // 3. Cyberpunk Stage
        const stageGroup = new THREE.Group();

        // Cylindrical Stage Podium
        const stageGeo = new THREE.CylinderGeometry(2.35, 2.5, 0.14, 48);
        const stageMat = new THREE.MeshStandardMaterial({
            color: 0x060812,
            roughness: 0.25,
            metalness: 0.85
        });
        this.stageMesh = new THREE.Mesh(stageGeo, stageMat);
        this.stageMesh.position.y = -0.07;
        stageGroup.add(this.stageMesh);

        // Neon Outer Rim
        const rimGeo = new THREE.TorusGeometry(2.42, 0.035, 16, 64);
        rimGeo.rotateX(Math.PI / 2);
        this.rimMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
        this.stageRim = new THREE.Mesh(rimGeo, this.rimMat);
        this.stageRim.position.y = 0.002;
        stageGroup.add(this.stageRim);

        // Audio-Reactive Pulse Ring
        const pulseGeo = new THREE.RingGeometry(2.32, 2.52, 64);
        pulseGeo.rotateX(-Math.PI / 2);
        this.pulseMat = new THREE.MeshBasicMaterial({
            color: 0xff00aa,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide
        });
        this.stagePulse = new THREE.Mesh(pulseGeo, this.pulseMat);
        this.stagePulse.position.y = 0.005;
        stageGroup.add(this.stagePulse);

        // Polar Cyber Grid on floor
        const gridHelper = new THREE.PolarGridHelper(2.35, 16, 8, 32, 0x00ffcc, 0x3d1768);
        gridHelper.position.y = 0.008;
        stageGroup.add(gridHelper);

        this.scene3D.add(stageGroup);

        // 4. Ambient and Spot Lights
        this.scene3D.add(new THREE.AmbientLight(0x221a38, 1.4));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
        keyLight.position.set(0, 6, 4.5);
        this.scene3D.add(keyLight);

        this.spotCyan = new THREE.SpotLight(0x00ffcc, 3.5, 15, Math.PI / 4, 0.35);
        this.spotCyan.position.set(-2.6, 4.0, 2.6);
        this.spotCyan.target.position.set(0, 1.0, 0);
        this.scene3D.add(this.spotCyan);
        this.scene3D.add(this.spotCyan.target);

        this.spotMagenta = new THREE.SpotLight(0xff00aa, 3.5, 15, Math.PI / 4, 0.35);
        this.spotMagenta.position.set(2.6, 4.0, 2.6);
        this.spotMagenta.target.position.set(0, 1.0, 0);
        this.scene3D.add(this.spotMagenta);
        this.scene3D.add(this.spotMagenta.target);

        this.spotRim = new THREE.SpotLight(0x9d4edd, 2.8, 15, Math.PI / 3, 0.5);
        this.spotRim.position.set(0, 3.6, -2.6);
        this.spotRim.target.position.set(0, 1.0, 0);
        this.scene3D.add(this.spotRim);
        this.scene3D.add(this.spotRim.target);

        // 5. Floating Cosmic Dust Particles
        const partCount = 140;
        const partGeo = new THREE.BufferGeometry();
        const partPos = new Float32Array(partCount * 3);
        for (let i = 0; i < partCount * 3; i += 3) {
            const r = 0.8 + Math.random() * 2.5;
            const theta = Math.random() * Math.PI * 2;
            partPos[i] = Math.cos(theta) * r;
            partPos[i + 1] = Math.random() * 3.5;
            partPos[i + 2] = Math.sin(theta) * r;
        }
        partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
        const partMat = new THREE.PointsMaterial({
            color: 0x00ffcc,
            size: 0.04,
            transparent: true,
            opacity: 0.65
        });
        this.particles3D = new THREE.Points(partGeo, partMat);
        this.scene3D.add(this.particles3D);

        // 6. Interactive Orbit & Drag Controls with Multi-Touch Pinch-to-Zoom
        let isPointerDown = false;
        let lastPointerX = 0;
        let lastPointerY = 0;
        let initialPinchDistance = null;
        let initialCameraDistance = null;

        const getPinchDistance = (touches) => {
            if (!touches || touches.length < 2) return null;
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        };

        const onPointerDown = (e) => {
            if (e.touches && e.touches.length === 2) {
                initialPinchDistance = getPinchDistance(e.touches);
                initialCameraDistance = this.cameraDistance;
                return;
            }
            isPointerDown = true;
            this.isUserOrbiting = true;
            lastPointerX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            lastPointerY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
        };

        const onPointerMove = (e) => {
            if (e.touches && e.touches.length === 2 && initialPinchDistance) {
                const currentPinch = getPinchDistance(e.touches);
                if (currentPinch && initialPinchDistance > 0) {
                    const ratio = initialPinchDistance / currentPinch;
                    this.cameraDistance = Math.max(0.6, Math.min(25.0, initialCameraDistance * ratio));
                    this.updateCameraOrbit();
                }
                return;
            }
            if (!isPointerDown) return;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
            const dx = clientX - lastPointerX;
            const dy = clientY - lastPointerY;
            lastPointerX = clientX;
            lastPointerY = clientY;

            this.cameraAngleX -= dx * 0.007;
            this.cameraAngleY = Math.max(-0.25, Math.min(1.35, this.cameraAngleY + dy * 0.007));
            this.updateCameraOrbit();
        };

        const onPointerUp = () => {
            isPointerDown = false;
            initialPinchDistance = null;
            setTimeout(() => { this.isUserOrbiting = false; }, 2500);
        };

        this.canvas3D.addEventListener('mousedown', onPointerDown);
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);

        this.canvas3D.addEventListener('touchstart', onPointerDown, { passive: true });
        window.addEventListener('touchmove', onPointerMove, { passive: true });
        window.addEventListener('touchend', onPointerUp);

        // Generous Wide-Angle & Close-Up Zoom (0.6m to 25.0m)
        this.canvas3D.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.cameraDistance = Math.max(0.6, Math.min(25.0, this.cameraDistance + e.deltaY * 0.006));
            this.updateCameraOrbit();
        }, { passive: false });

        this.is3DInitialized = true;
        this.switchDancer(this.currentDancer || 'miku');
    }

    updateCameraOrbit() {
        if (!this.camera3D) return;
        const targetY = this.cameraTargetY || 1.05;
        const x = Math.sin(this.cameraAngleX) * Math.cos(this.cameraAngleY) * this.cameraDistance;
        const y = targetY + Math.sin(this.cameraAngleY) * this.cameraDistance;
        const z = Math.cos(this.cameraAngleX) * Math.cos(this.cameraAngleY) * this.cameraDistance;
        this.camera3D.position.set(x, y, z);
        this.camera3D.lookAt(0, targetY, 0);
    }

    switchDancer(dancerKey) {
        if (!this.dancers[dancerKey]) return;
        this.currentDancer = dancerKey;
        const cfg = this.dancers[dancerKey];
        this.cameraTargetY = cfg.targetY || 1.05;

        document.querySelectorAll('.vis-dancer-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.model === dancerKey);
        });

        if (this.activeModel) {
            this.scene3D.remove(this.activeModel);
            this.activeModel = null;
        }
        if (this.activeAction) {
            this.activeAction.stop();
            this.activeAction = null;
        }

        if (this.modelCache[dancerKey]) {
            const cached = this.modelCache[dancerKey];
            this.activeModel = cached.scene;
            this.activeMixer = cached.mixer;
            this.activeAction = cached.action;
            this.modelBaseY = cached.baseY;
            this.currentBones = cached.bones;
            this.scene3D.add(this.activeModel);
            if (this.activeAction) {
                this.activeAction.reset();
                this.activeAction.play();
            }
            this.updateCameraOrbit();
            window.AionApp?.showToast(`💃 3D DANCER: ${cfg.name} (${cfg.style})`);
            return;
        }

        // Load model via GLTFLoader
        if (this.loading3D) {
            this.loading3D.style.display = 'block';
            if (this.loadingText3D) this.loadingText3D.textContent = `LADE 3D AVATAR: ${cfg.name.toUpperCase()}...`;
        }

        const loader = new THREE.GLTFLoader();
        loader.load(cfg.url, (gltf) => {
            const model = gltf.scene;

            // Apply rock-solid calibrated scaling & ground alignment
            const scale = cfg.scale !== undefined ? cfg.scale : 1.0;
            const baseY = cfg.offsetY !== undefined ? cfg.offsetY : 0.0;
            const baseX = cfg.offsetX !== undefined ? cfg.offsetX : 0.0;
            const baseZ = cfg.offsetZ !== undefined ? cfg.offsetZ : 0.0;

            model.scale.set(scale, scale, scale);
            model.position.set(baseX, baseY, baseZ);

            // Find key skeletal bones for procedural beat groove
            const bones = {};
            const findBone = (patterns) => {
                let found = null;
                model.traverse((child) => {
                    if (found) return;
                    if (child.isBone || child.type === 'Bone') {
                        const name = child.name.toLowerCase();
                        for (const pat of patterns) {
                            if (name.includes(pat.toLowerCase())) {
                                found = child;
                                return;
                            }
                        }
                    }
                });
                return found;
            };

            bones.head = findBone(['head_034', 'mixamorig:head_06', 'mixamorig:head_00', 'head_05', 'head', 'neck']);
            bones.spine = findBone(['spine2_04', 'spine2_064', 'spine_01_06', 'spine_01_01', 'spine2', 'spine1', 'spine', 'chest']);
            bones.hips = findBone(['pelvis_02', 'mixamorig:hips', 'hip_0111', 'hips', 'pelvis']);
            bones.leftArm = findBone(['upperarm_l_048', 'mixamorig:leftarm', 'l_arm_019', 'leftarm', 'arm_l', 'l_arm', 'upperarm_l']);
            bones.rightArm = findBone(['upperarm_r_010', 'mixamorig:rightarm', 'r_arm_047', 'rightarm', 'arm_r', 'r_arm', 'upperarm_r']);

            // Set up shadows, double-sided materials & disable frustum culling on skinned meshes
            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) {
                        child.material.side = THREE.DoubleSide;
                        child.material.metalness = child.material.metalness || 0.15;
                    }
                }
            });

            // Animation setup
            let mixer = null;
            let action = null;
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                action = mixer.clipAction(gltf.animations[0]);
                action.setLoop(THREE.LoopRepeat);
                action.play();
            }

            this.modelCache[dancerKey] = {
                scene: model,
                mixer: mixer,
                action: action,
                baseY: baseY,
                bones: bones
            };

            if (this.currentDancer === dancerKey) {
                this.activeModel = model;
                this.activeMixer = mixer;
                this.activeAction = action;
                this.modelBaseY = baseY;
                this.currentBones = bones;
                this.scene3D.add(model);
                this.updateCameraOrbit();
            }

            if (this.loading3D) this.loading3D.style.display = 'none';
            window.AionApp?.showToast(`💃 3D DANCER: ${cfg.name} (${cfg.style})`);
        }, undefined, (err) => {
            console.error('Failed to load dancer model:', err);
            if (this.loading3D) this.loading3D.style.display = 'none';
            window.AionApp?.showToast(`Fehler beim Laden von ${cfg.name}`);
        });
    }

    render3DDancer(metrics) {
        if (!this.is3DInitialized || !this.renderer3D || !this.scene3D || !this.camera3D) return;

        const now = performance.now();
        const delta = Math.min((now - this.lastFrameTime3D) / 1000, 0.08);
        this.lastFrameTime3D = now;

        const bass = metrics.bass || 0;
        const mid = metrics.mid || 0;
        const high = metrics.high || 0;
        const energy = metrics.energy || 0;

        // 1. Dynamic Tempo & BPM Tracking
        if (this.beatDetected) {
            if (this.lastBeatTimestamp) {
                const interval = (now - this.lastBeatTimestamp) / 1000;
                if (interval >= 0.28 && interval <= 1.25) { // 48 - 214 BPM
                    const instantBpm = 60 / interval;
                    this.estimatedBpm = this.estimatedBpm 
                        ? this.estimatedBpm * 0.70 + instantBpm * 0.30 
                        : instantBpm;
                }
            }
            this.lastBeatTimestamp = now;
            this.beatImpact = 1.0;
        } else {
            this.beatImpact = (this.beatImpact || 0) * 0.88;
        }

        const effectiveBpm = Math.max(75, Math.min(175, this.estimatedBpm || 124));
        const beatFrequency = effectiveBpm / 60;
        this.groovePhase = (this.groovePhase || 0) + delta * beatFrequency * Math.PI * 2;

        // 2. Playback Speed Synchronized to Song BPM and Music Energy
        const tempoRatio = effectiveBpm / 125.0;
        const speedFromEnergy = 0.82 + energy * 0.45;
        const targetSpeed = tempoRatio * speedFromEnergy;
        this.danceSpeed += (targetSpeed - this.danceSpeed) * 0.14;

        if (this.activeMixer) {
            this.activeMixer.update(delta * this.danceSpeed);
        }

        // 3. Procedural Skeletal Groove (Mittanzen / Body Motion to the Music)
        const bones = this.currentBones;
        if (bones) {
            const beatHit = this.beatImpact || 0;
            const grooveSin = Math.sin(this.groovePhase);
            const grooveCos = Math.cos(this.groovePhase);
            const doubleBeat = Math.sin(this.groovePhase * 2);

            // A. Head & Neck: Head-nodding on kicks and rhythmic lateral sway
            if (bones.head) {
                const headNod = (beatHit * 0.32 + Math.abs(doubleBeat) * 0.12) * Math.max(0.35, energy);
                const headSway = grooveSin * 0.16 * mid;
                const headRoll = grooveCos * 0.08 * energy;

                bones.head.rotateX(headNod);
                bones.head.rotateZ(headSway);
                bones.head.rotateY(headRoll);
            }

            // B. Spine & Chest: Torso leans, dips and twists into the groove
            if (bones.spine) {
                const spineLean = grooveSin * 0.18 * energy;
                const spineDip = (beatHit * 0.20 + doubleBeat * 0.08) * bass;
                const spineTwist = grooveCos * 0.15 * mid;

                bones.spine.rotateZ(spineLean);
                bones.spine.rotateX(spineDip);
                bones.spine.rotateY(spineTwist);
            }

            // C. Hips & Pelvis: Counter-rhythm hip swivel
            if (bones.hips) {
                const hipSwivel = -grooveSin * 0.22 * energy;
                const hipTilt = -grooveCos * 0.12 * energy;

                bones.hips.rotateY(hipSwivel);
                bones.hips.rotateZ(hipTilt);
            }

            // D. Arms: Flare wider on high energy and pump to the rhythm
            if (bones.leftArm) {
                const lPump = (beatHit * 0.18 + energy * 0.22);
                bones.leftArm.rotateZ(-lPump);
                bones.leftArm.rotateX(grooveSin * 0.15 * energy);
            }
            if (bones.rightArm) {
                const rPump = (beatHit * 0.18 + energy * 0.22);
                bones.rightArm.rotateZ(rPump);
                bones.rightArm.rotateX(-grooveSin * 0.15 * energy);
            }
        }

        // 4. Dynamic Floor Hop & Character Bounce
        if (this.activeModel) {
            const bassHop = (this.beatDetected ? 0.06 : 0.0) * bass + Math.abs(Math.sin(this.groovePhase)) * 0.018 * energy;
            this.activeModel.position.y = this.modelBaseY + bassHop;
        }

        // 5. Audio-Reactive Stage Floor Pulses & Neon Ripple
        if (this.stagePulse && this.pulseMat) {
            const ringScale = 1.0 + (this.beatDetected ? 0.38 : bass * 0.16);
            this.stagePulse.scale.set(ringScale, ringScale, 1.0);
            this.pulseMat.opacity = 0.25 + bass * 0.75;
        }

        if (this.rimMat) {
            this.rimMat.color.setHSL((now * 0.00015 + bass * 0.25) % 1.0, 1.0, 0.55);
        }

        // 6. Reactive Spotlights & Stage Atmosphere
        if (this.spotCyan) this.spotCyan.intensity = 2.2 + bass * 7.0;
        if (this.spotMagenta) this.spotMagenta.intensity = 2.2 + mid * 7.0;
        if (this.spotRim) this.spotRim.intensity = 1.6 + high * 5.0;

        // 7. Floating Cosmic Dust Swirl
        if (this.particles3D) {
            this.particles3D.rotation.y += 0.0015 + energy * 0.008;
        }

        // 8. Beat Camera Punch & Orbit Drift
        this.cameraPunch = (this.cameraPunch || 0) * 0.85 + (this.beatDetected ? 0.09 * bass : 0.0);
        const currentDist = Math.max(0.6, Math.min(25.0, this.cameraDistance - this.cameraPunch));

        if (!this.isUserOrbiting) {
            this.cameraAngleX += 0.0012 + energy * 0.0018;
        }

        // Update Camera Position with Punch Distance
        const targetY = this.cameraTargetY || 1.05;
        const x = Math.sin(this.cameraAngleX) * Math.cos(this.cameraAngleY) * currentDist;
        const y = targetY + Math.sin(this.cameraAngleY) * currentDist;
        const z = Math.cos(this.cameraAngleX) * Math.cos(this.cameraAngleY) * currentDist;
        this.camera3D.position.set(x, y, z);
        this.camera3D.lookAt(0, targetY, 0);

        this.renderer3D.render(this.scene3D, this.camera3D);
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

        document.querySelectorAll('.vis-dancer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchDancer(btn.dataset.model));
        });

        // Quick Zoom & Camera Reset Buttons
        document.getElementById('btn-vis-zoom-in')?.addEventListener('click', () => {
            this.cameraDistance = Math.max(0.6, this.cameraDistance - 0.8);
            this.updateCameraOrbit();
        });
        document.getElementById('btn-vis-zoom-out')?.addEventListener('click', () => {
            this.cameraDistance = Math.min(25.0, this.cameraDistance + 0.8);
            this.updateCameraOrbit();
        });
        document.getElementById('btn-vis-cam-reset')?.addEventListener('click', () => {
            this.cameraDistance = 3.6;
            this.cameraAngleX = 0;
            this.cameraAngleY = 0.22;
            this.updateCameraOrbit();
        });

        // Keyboard Shortcuts for Zooming (+ / - / 0)
        window.addEventListener('keydown', (e) => {
            if (this.currentMode !== 'dance3d') return;
            if (e.key === '+' || e.key === '=') {
                this.cameraDistance = Math.max(0.6, this.cameraDistance - 0.6);
                this.updateCameraOrbit();
            } else if (e.key === '-' || e.key === '_') {
                this.cameraDistance = Math.min(25.0, this.cameraDistance + 0.6);
                this.updateCameraOrbit();
            } else if (e.key === '0') {
                this.cameraDistance = 3.6;
                this.cameraAngleX = 0;
                this.cameraAngleY = 0.22;
                this.updateCameraOrbit();
            }
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
