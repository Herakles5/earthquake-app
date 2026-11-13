/**
 * AION AMBIENT SANCTUARY & DJ DEEP BASS ENGINE
 * 100% Realtime Procedural WebAudio Soundscape & Sub-Bass Synthesizer
 * No audio files — infinite evolving soundscapes, binaural theta waves,
 * analog 808 sub-kicks, sidechained deep basslines & autonomous AION AUTO-DJ!
 */

class AmbientSanctuary {
    constructor() {
        this.isPlaying = false;
        this.isAutoDj = false;
        this.autoDjTimer = null;
        this.autoDjCycleCount = 0;

        this.ctx = null;
        this.masterGain = null;
        this.masterBus = null;
        this.masterCompressor = null;
        this.bassBus = null;
        this.bassDuckGain = null;
        this.padDuckGain = null;
        this.subShelf = null;
        this.subShaper = null;
        this.analyser = null;

        // Channel Gains
        this.gains = {
            drone: null,
            binaural: null,
            chords: null,
            rain: null,
            wind: null,
            chimes: null,
            subkick: null,
            bassline: null,
            subdrive: null
        };

        this.nodes = {};
        this.chordTimer = null;
        this.chimeTimer = null;

        // DJ Deep Bass Engine State
        this.bpm = 112;
        this.subFreq = 38;
        this.groove = 'deepdub'; // 'deepdub' | 'rolling' | 'halftime' | 'heartbeat'
        this.currentChordIdx = 0;
        this.chordRoots = [146.83, 130.81, 164.81, 174.61, 196.00]; // D3, C3, E3, F3, G3
        this.stepIndex = 0;
        this.nextNoteTime = 0;
        this.schedulerTimer = null;
        this.isBuildingDrop = false;
        this.lastBassHitTime = 0;
        this.noiseBuffer = null;

        // UI elements
        this.toggleBtn = document.getElementById('btn-ambient-toggle');
        this.autoDjBtn = document.getElementById('btn-ambient-autodj');
        this.randomBtn = document.getElementById('btn-ambient-random');
        this.autoDjBanner = document.getElementById('autodj-banner');
        this.autoDjStatus = document.getElementById('autodj-status-text');

        this.bpmSlider = document.getElementById('slider-dj-bpm');
        this.bpmValEl = document.getElementById('val-dj-bpm');
        this.subFreqSlider = document.getElementById('slider-dj-subfreq');
        this.subFreqValEl = document.getElementById('val-dj-subfreq');
        this.bassDropBtn = document.getElementById('btn-dj-bassdrop');

        this.miniCanvas = document.getElementById('ambient-mini-canvas');
        this.miniCtx = this.miniCanvas.getContext('2d');

        // Channel Sliders
        this.sliders = {
            drone: document.getElementById('slider-drone'),
            binaural: document.getElementById('slider-binaural'),
            chords: document.getElementById('slider-chords'),
            rain: document.getElementById('slider-rain'),
            wind: document.getElementById('slider-wind'),
            chimes: document.getElementById('slider-chimes'),
            subkick: document.getElementById('slider-subkick'),
            bassline: document.getElementById('slider-bassline'),
            subdrive: document.getElementById('slider-subdrive')
        };

        this.presets = {
            cosmic_void: {
                drone: 80, binaural: 40, chords: 50, rain: 20, wind: 60, chimes: 20,
                subkick: 45, bassline: 55, subdrive: 65, bpm: 88, subFreq: 38, groove: 'heartbeat'
            },
            theta_meditation: {
                drone: 55, binaural: 90, chords: 65, rain: 15, wind: 25, chimes: 45,
                subkick: 0, bassline: 15, subdrive: 45, bpm: 68, subFreq: 40, groove: 'heartbeat'
            },
            stellar_rain: {
                drone: 35, binaural: 35, chords: 40, rain: 90, wind: 70, chimes: 10,
                subkick: 20, bassline: 30, subdrive: 50, bpm: 80, subFreq: 42, groove: 'heartbeat'
            },
            cyber_aurora: {
                drone: 70, binaural: 50, chords: 85, rain: 25, wind: 40, chimes: 65,
                subkick: 55, bassline: 65, subdrive: 70, bpm: 108, subFreq: 40, groove: 'deepdub'
            },
            zen_temple: {
                drone: 45, binaural: 60, chords: 70, rain: 40, wind: 20, chimes: 90,
                subkick: 0, bassline: 0, subdrive: 40, bpm: 72, subFreq: 43, groove: 'heartbeat'
            },
            dj_dub: {
                drone: 75, binaural: 25, chords: 65, rain: 20, wind: 45, chimes: 25,
                subkick: 88, bassline: 90, subdrive: 85, bpm: 112, subFreq: 38, groove: 'deepdub'
            },
            dj_cyber: {
                drone: 80, binaural: 20, chords: 70, rain: 15, wind: 55, chimes: 35,
                subkick: 95, bassline: 95, subdrive: 90, bpm: 124, subFreq: 40, groove: 'rolling'
            },
            dj_quake: {
                drone: 90, binaural: 30, chords: 50, rain: 10, wind: 40, chimes: 15,
                subkick: 95, bassline: 90, subdrive: 95, bpm: 84, subFreq: 34, groove: 'halftime'
            }
        };

        this.initEvents();
        this.renderMiniWaveform();
    }

    initAudio() {
        if (this.ctx) return;
        this.ctx = window.AionApp.getAudioContext();
        const now = this.ctx.currentTime;

        // Shared noise buffer for rain, wind & risers
        const noiseLen = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
        const ndata = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) {
            ndata[i] = Math.random() * 2 - 1;
        }

        // 1. Master Buses & Analog Sub-Mastering Chain
        this.masterBus = this.ctx.createGain();
        this.masterBus.gain.setValueAtTime(1.0, now);

        this.bassBus = this.ctx.createGain();
        this.bassBus.gain.setValueAtTime(1.0, now);

        this.bassDuckGain = this.ctx.createGain();
        this.bassDuckGain.gain.setValueAtTime(1.0, now);
        this.bassDuckGain.connect(this.bassBus);

        this.padDuckGain = this.ctx.createGain();
        this.padDuckGain.gain.setValueAtTime(1.0, now);
        this.padDuckGain.connect(this.masterBus);

        // DC blocker at 20Hz to keep subwoofers clean & eliminate infrasonic rumble
        this.subDcBlocker = this.ctx.createBiquadFilter();
        this.subDcBlocker.type = 'highpass';
        this.subDcBlocker.frequency.setValueAtTime(20, now);
        this.subDcBlocker.Q.setValueAtTime(0.7, now);

        // Low-Shelf Sub-Bass Boost controlled by "subdrive"
        this.subShelf = this.ctx.createBiquadFilter();
        this.subShelf.type = 'lowshelf';
        this.subShelf.frequency.setValueAtTime(72, now);

        // Warm Tube Saturation WaveShaper (generates 2nd & 3rd harmonics for rich bass translation)
        this.subShaper = this.ctx.createWaveShaper();
        this.subShaper.oversample = '2x';

        // Master Bus Limiter / Glue Compressor
        this.masterCompressor = this.ctx.createDynamicsCompressor();
        this.masterCompressor.threshold.setValueAtTime(-11, now);
        this.masterCompressor.knee.setValueAtTime(12, now);
        this.masterCompressor.ratio.setValueAtTime(4.5, now);
        this.masterCompressor.attack.setValueAtTime(0.003, now);
        this.masterCompressor.release.setValueAtTime(0.14, now);

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.82, now);

        // Higher resolution FFT (1024) so Visualizer accurately detects 35-60 Hz sub-bass!
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.45;

        // Wire Sub Chain -> Master Chain -> Analyser -> Output
        this.bassBus.connect(this.subDcBlocker);
        this.subDcBlocker.connect(this.subShelf);
        this.subShelf.connect(this.subShaper);
        this.subShaper.connect(this.masterBus);

        this.masterBus.connect(this.masterCompressor);
        this.masterCompressor.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        // Apply initial subdrive curve & boost
        const drivePct = parseInt(this.sliders.subdrive?.value || 70, 10);
        this.applySubDrive(drivePct);

        // Build Synth Layers
        this.buildSubDrone();
        this.buildBinauralTheta();
        this.buildEtherealChords();
        this.buildPinkNoiseRain();
        this.buildSolarWind();
        this.buildZenChimes();
        this.buildDeepBassEngine();
    }

    makeWarmSubCurve(drivePct) {
        const samples = 1024;
        const curve = new Float32Array(samples);
        const amt = Math.max(0, Math.min(1, drivePct / 100));
        const k = 1.2 + amt * 4.8;
        const norm = Math.tanh(k);
        const asym = 0.14 * amt;
        const zeroOffset = Math.tanh(-asym * 0.5 * k) / norm;

        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            const shaped = Math.tanh((x + asym * (x * x - 0.5)) * k) / norm;
            curve[i] = shaped - zeroOffset;
        }
        return curve;
    }

    applySubDrive(percent) {
        if (!this.ctx || !this.subShelf || !this.subShaper) return;
        const now = this.ctx.currentTime;
        const boostDb = (percent / 100) * 11.5; // Up to +11.5 dB low-end shelf @ 72 Hz
        this.subShelf.gain.linearRampToValueAtTime(boostDb, now + 0.08);
        this.subShaper.curve = this.makeWarmSubCurve(percent);
    }

    buildSubDrone() {
        const now = this.ctx.currentTime;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.drone.value / 100) * 0.42, now);

        const osc1 = this.ctx.createOscillator(); // Pure chest sub-octave
        const osc2 = this.ctx.createOscillator(); // Warm fifth/harmonic body
        const filter = this.ctx.createBiquadFilter();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(this.subFreq, now);
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(this.subFreq * 1.5, now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(105, now);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(this.bassBus);

        osc1.start();
        osc2.start();

        this.gains.drone = gain;
        this.nodes.drone = [osc1, osc2, filter];
    }

    buildBinauralTheta() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.binaural.value / 100) * 0.28, this.ctx.currentTime);

        const oscL = this.ctx.createOscillator();
        const oscR = this.ctx.createOscillator();
        const panL = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        const panR = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

        oscL.type = 'sine';
        oscL.frequency.setValueAtTime(432.0, this.ctx.currentTime);
        oscR.type = 'sine';
        oscR.frequency.setValueAtTime(438.0, this.ctx.currentTime);

        if (panL && panR) {
            panL.pan.setValueAtTime(-1.0, this.ctx.currentTime);
            panR.pan.setValueAtTime(1.0, this.ctx.currentTime);
            oscL.connect(panL);
            panL.connect(gain);
            oscR.connect(panR);
            panR.connect(gain);
        } else {
            oscL.connect(gain);
            oscR.connect(gain);
        }

        gain.connect(this.masterBus);
        oscL.start();
        oscR.start();

        this.gains.binaural = gain;
        this.nodes.binaural = [oscL, oscR];
    }

    buildEtherealChords() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.chords.value / 100) * 0.28, this.ctx.currentTime);
        gain.connect(this.padDuckGain);
        this.gains.chords = gain;

        const chordPitches = [
            [146.83, 220.00, 293.66, 370.00], // D Maj9
            [130.81, 196.00, 261.63, 329.63], // C add9
            [164.81, 246.94, 329.63, 392.00], // Em7
            [174.61, 261.63, 349.23, 440.00], // F Maj7
            [196.00, 293.66, 392.00, 493.88]  // G Maj9
        ];

        let chordIndex = 0;
        let activeChordOscs = [];

        const playNextChord = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            this.currentChordIdx = chordIndex;
            const chord = chordPitches[chordIndex];
            chordIndex = (chordIndex + 1) % chordPitches.length;

            activeChordOscs.forEach(({ osc, vGain }) => {
                try {
                    vGain.gain.linearRampToValueAtTime(0.0001, now + 3.0);
                    setTimeout(() => {
                        try { osc.stop(); osc.disconnect(); } catch (e) {}
                    }, 3200);
                } catch (e) {}
            });
            activeChordOscs = [];

            chord.forEach(freq => {
                const osc = this.ctx.createOscillator();
                const vGain = this.ctx.createGain();
                const vFilter = this.ctx.createBiquadFilter();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now);

                vFilter.type = 'lowpass';
                vFilter.frequency.setValueAtTime(680, now);

                vGain.gain.setValueAtTime(0.0001, now);
                vGain.gain.linearRampToValueAtTime(0.08, now + 3.2);

                osc.connect(vFilter);
                vFilter.connect(vGain);
                vGain.connect(gain);

                osc.start(now);
                activeChordOscs.push({ osc, vGain });
            });

            this.chordTimer = setTimeout(playNextChord, 8000);
        };

        this.startChordEngine = () => {
            playNextChord();
        };

        this.stopChordEngine = () => {
            if (this.chordTimer) clearTimeout(this.chordTimer);
            activeChordOscs.forEach(({ osc }) => {
                try { osc.stop(); osc.disconnect(); } catch (e) {}
            });
            activeChordOscs = [];
        };
    }

    buildPinkNoiseRain() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.rain.value / 100) * 0.22, this.ctx.currentTime);

        const bufferSize = this.ctx.sampleRate * 4;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
            b6 = white * 0.115926;
        }

        const whiteNoise = this.ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;

        const rainFilter = this.ctx.createBiquadFilter();
        rainFilter.type = 'lowpass';
        rainFilter.frequency.setValueAtTime(1400, this.ctx.currentTime);

        whiteNoise.connect(rainFilter);
        rainFilter.connect(gain);
        gain.connect(this.masterBus);

        whiteNoise.start();
        this.gains.rain = gain;
        this.nodes.rain = [whiteNoise, rainFilter];
    }

    buildSolarWind() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.wind.value / 100) * 0.20, this.ctx.currentTime);

        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.loop = true;

        const bpFilter = this.ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.Q.setValueAtTime(3.5, this.ctx.currentTime);
        bpFilter.frequency.setValueAtTime(380, this.ctx.currentTime);

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.08, this.ctx.currentTime);
        lfoGain.gain.setValueAtTime(220, this.ctx.currentTime);

        lfo.connect(lfoGain);
        lfoGain.connect(bpFilter.frequency);

        noise.connect(bpFilter);
        bpFilter.connect(gain);
        gain.connect(this.masterBus);

        noise.start();
        lfo.start();

        this.gains.wind = gain;
        this.nodes.wind = [noise, bpFilter, lfo];
    }

    buildZenChimes() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime((this.sliders.chimes.value / 100) * 0.35, this.ctx.currentTime);
        gain.connect(this.masterBus);
        this.gains.chimes = gain;

        const chimePentatonic = [587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];

        const scheduleChime = () => {
            if (!this.isPlaying) return;
            const now = this.ctx.currentTime;
            const freq = chimePentatonic[Math.floor(Math.random() * chimePentatonic.length)];

            const osc = this.ctx.createOscillator();
            const noteGain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);

            noteGain.gain.setValueAtTime(0.12, now);
            noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);

            osc.connect(noteGain);
            noteGain.connect(gain);

            osc.start(now);
            osc.stop(now + 4.6);

            const nextDelay = 1800 + Math.random() * 4200;
            this.chimeTimer = setTimeout(scheduleChime, nextDelay);
        };

        this.startChimeEngine = () => {
            scheduleChime();
        };

        this.stopChimeEngine = () => {
            if (this.chimeTimer) clearTimeout(this.chimeTimer);
        };
    }

    // ================= DJ DEEP BASS & SUB-KICK ENGINE =================
    buildDeepBassEngine() {
        const now = this.ctx.currentTime;

        const kickGain = this.ctx.createGain();
        const kickPct = parseInt(this.sliders.subkick?.value || 60, 10);
        kickGain.gain.setValueAtTime((kickPct / 100) * 0.92, now);
        kickGain.connect(this.bassBus);
        this.gains.subkick = kickGain;

        const bassGain = this.ctx.createGain();
        const bassPct = parseInt(this.sliders.bassline?.value || 65, 10);
        bassGain.gain.setValueAtTime((bassPct / 100) * 0.72, now);
        bassGain.connect(this.bassDuckGain);
        this.gains.bassline = bassGain;
    }

    getSubRootHz() {
        // Transpose current chord root cleanly into the user's selected deep sub range [0.85 * subFreq .. ~1.55 * subFreq]
        let f = this.chordRoots[this.currentChordIdx] || 146.83;
        const maxSub = Math.max(56, this.subFreq * 1.55);
        while (f > maxSub && f > 32) {
            f *= 0.5;
        }
        return Math.max(29, f);
    }

    triggerSubKick(time, velocity = 1.0, isDropImpact = false) {
        if (!this.ctx || !this.gains.subkick) return;
        const kickSlider = parseInt(this.sliders.subkick?.value || 0, 10);
        if (kickSlider <= 1 && !isDropImpact) return;

        const tailLen = isDropImpact ? 1.15 : (this.groove === 'halftime' ? 0.68 : 0.44);
        const baseFreq = isDropImpact ? Math.max(30, this.subFreq - 4) : this.subFreq;

        // 1. Deep 808 Sub Sine Oscillator
        const subOsc = this.ctx.createOscillator();
        const subEnv = this.ctx.createGain();
        subOsc.type = 'sine';

        subOsc.frequency.setValueAtTime(baseFreq * 3.4, time);
        subOsc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, time + 0.025);
        subOsc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.14);

        const peakAmp = (isDropImpact ? 1.1 : 0.95) * velocity;
        subEnv.gain.setValueAtTime(0.0001, time);
        subEnv.gain.linearRampToValueAtTime(peakAmp, time + 0.005);
        subEnv.gain.exponentialRampToValueAtTime(peakAmp * 0.45, time + 0.16);
        subEnv.gain.exponentialRampToValueAtTime(0.0001, time + tailLen);

        subOsc.connect(subEnv);
        subEnv.connect(this.gains.subkick);

        // 2. Subtle Transient Punch Click (helps kick cut through headphones/laptops)
        const clickOsc = this.ctx.createOscillator();
        const clickEnv = this.ctx.createGain();
        clickOsc.type = 'triangle';
        clickOsc.frequency.setValueAtTime(175, time);
        clickOsc.frequency.exponentialRampToValueAtTime(52, time + 0.025);

        clickEnv.gain.setValueAtTime(0.0001, time);
        clickEnv.gain.linearRampToValueAtTime(0.28 * velocity, time + 0.002);
        clickEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.032);

        clickOsc.connect(clickEnv);
        clickEnv.connect(this.gains.subkick);

        subOsc.start(time);
        subOsc.stop(time + tailLen + 0.04);
        subOsc.onended = () => {
            try { subOsc.disconnect(); subEnv.disconnect(); } catch (e) {}
        };
        clickOsc.start(time);
        clickOsc.stop(time + 0.05);
        clickOsc.onended = () => {
            try { clickOsc.disconnect(); clickEnv.disconnect(); } catch (e) {}
        };

        // 3. DJ Click-Free Sidechain Ducking on Bassline & Chords so Sub-Kick slams cleanly
        if (this.bassDuckGain) {
            this.bassDuckGain.gain.cancelScheduledValues(time);
            this.bassDuckGain.gain.setTargetAtTime(0.22, time, 0.003);
            this.bassDuckGain.gain.setTargetAtTime(1.0, time + 0.016, 0.055);
        }
        if (this.padDuckGain) {
            this.padDuckGain.gain.cancelScheduledValues(time);
            this.padDuckGain.gain.setTargetAtTime(0.68, time, 0.004);
            this.padDuckGain.gain.setTargetAtTime(1.0, time + 0.018, 0.075);
        }

        // Visual feedback timestamp
        this.lastBassHitTime = performance.now();
    }

    triggerBassNote(time, freq, durationSec, accent = false) {
        if (!this.ctx || !this.gains.bassline) return;
        const bassSlider = parseInt(this.sliders.bassline?.value || 0, 10);
        if (bassSlider <= 1) return;

        // Dual oscillator: Pure sine chest-sub + filtered analog sawtooth warmth
        const subOsc = this.ctx.createOscillator();
        const harmOsc = this.ctx.createOscillator();
        const subLevel = this.ctx.createGain();
        const harmLevel = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();

        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(freq, time);

        harmOsc.type = 'sawtooth';
        harmOsc.frequency.setValueAtTime(freq, time);
        harmOsc.detune.setValueAtTime(accent ? 6 : 3, time);

        subLevel.gain.setValueAtTime(0.85, time);
        harmLevel.gain.setValueAtTime(accent ? 0.34 : 0.22, time);

        // Resonant analog bass filter sweep
        filter.type = 'lowpass';
        filter.Q.setValueAtTime(accent ? 3.8 : 2.6, time);
        const startCut = accent ? 340 : 210;
        const endCut = Math.max(78, this.subFreq * 2.1);
        filter.frequency.setValueAtTime(startCut, time);
        filter.frequency.exponentialRampToValueAtTime(endCut, time + Math.min(durationSec, 0.22));

        // Amplitude envelope
        const amp = accent ? 0.78 : 0.62;
        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(amp, time + 0.008);
        env.gain.setValueAtTime(amp * 0.85, time + Math.max(0.02, durationSec - 0.04));
        env.gain.exponentialRampToValueAtTime(0.0001, time + durationSec + 0.04);

        subOsc.connect(subLevel);
        harmOsc.connect(harmLevel);
        subLevel.connect(env);
        harmLevel.connect(filter);
        filter.connect(env);
        env.connect(this.gains.bassline);

        subOsc.start(time);
        harmOsc.start(time);
        subOsc.stop(time + durationSec + 0.06);
        harmOsc.stop(time + durationSec + 0.06);
        subOsc.onended = () => {
            try {
                subOsc.disconnect(); harmOsc.disconnect();
                subLevel.disconnect(); harmLevel.disconnect();
                filter.disconnect(); env.disconnect();
            } catch (e) {}
        };
    }

    scheduleGrooveStep(step, time) {
        if (!this.isPlaying || !this.ctx) return;

        // Hold back kick/bass during drop anticipation buildup
        if (this.isBuildingDrop) return;

        const secPer16th = (60 / this.bpm) / 4;
        const rootHz = this.getSubRootHz();

        if (this.groove === 'deepdub') {
            // Hypnotic 4-on-the-floor kick + bouncy syncopated sub groove
            if (step % 4 === 0) {
                this.triggerSubKick(time, 1.0);
            } else if (step === 15) {
                this.triggerSubKick(time, 0.38);
            }

            const bassSteps = {
                2: { mult: 1.0, len: 1.4, acc: true },
                3: { mult: 1.0, len: 0.9, acc: false },
                6: { mult: 1.0, len: 1.3, acc: true },
                7: { mult: 1.5, len: 0.8, acc: false },
                10: { mult: 1.0, len: 1.4, acc: true },
                11: { mult: 1.0, len: 0.9, acc: false },
                14: { mult: 1.335, len: 1.1, acc: true },
                15: { mult: 1.189, len: 0.9, acc: false }
            };
            const hit = bassSteps[step];
            if (hit) {
                this.triggerBassNote(time, rootHz * hit.mult, secPer16th * hit.len, hit.acc);
            }
        } else if (this.groove === 'rolling') {
            // Driving club/psy rolling 16th-note deep bassline
            if (step % 4 === 0) {
                this.triggerSubKick(time, 1.0);
            } else {
                const isOffbeat = (step % 4 === 2);
                const mult = (step === 14) ? 1.5 : (step === 15 ? 1.189 : 1.0);
                this.triggerBassNote(time, rootHz * mult, secPer16th * 0.85, isOffbeat);
            }
        } else if (this.groove === 'halftime') {
            // Massive slow halftime 808 drops
            if (step === 0) {
                this.triggerSubKick(time, 1.0);
                this.triggerBassNote(time, rootHz, secPer16th * 4.8, true);
            } else if (step === 6) {
                this.triggerSubKick(time, 0.72);
                this.triggerBassNote(time, rootHz * 1.189, secPer16th * 3.2, false);
            } else if (step === 10) {
                this.triggerSubKick(time, 0.96);
                this.triggerBassNote(time, rootHz, secPer16th * 4.5, true);
            } else if (step === 14) {
                this.triggerBassNote(time, rootHz * 1.5, secPer16th * 1.8, false);
            }
        } else {
            // 'heartbeat': Gentle meditative double-thump pulse & sustained warm sub
            if (step === 0) {
                this.triggerSubKick(time, 0.88);
                this.triggerBassNote(time, rootHz, secPer16th * 6.5, false);
            } else if (step === 2) {
                this.triggerSubKick(time, 0.52);
            } else if (step === 8) {
                this.triggerSubKick(time, 0.68);
                this.triggerBassNote(time, rootHz, secPer16th * 6.5, false);
            }
        }
    }

    startGrooveEngine() {
        if (this.schedulerTimer) clearInterval(this.schedulerTimer);
        if (!this.ctx) return;

        this.stepIndex = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.05;

        const lookaheadSec = 0.12;
        this.schedulerTimer = setInterval(() => {
            if (!this.isPlaying || !this.ctx) return;

            // Fast recovery if browser suspended timer while tab was backgrounded
            if (this.nextNoteTime < this.ctx.currentTime - 0.5) {
                this.nextNoteTime = this.ctx.currentTime + 0.05;
            }

            const secPer16th = (60 / this.bpm) / 4;
            while (this.nextNoteTime < this.ctx.currentTime + lookaheadSec) {
                this.scheduleGrooveStep(this.stepIndex, this.nextNoteTime);
                this.nextNoteTime += secPer16th;
                this.stepIndex = (this.stepIndex + 1) % 16;
            }
        }, 25);
    }

    stopGrooveEngine() {
        if (this.schedulerTimer) {
            clearInterval(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        this.isBuildingDrop = false;
    }

    triggerBassDrop(autoTrigger = false) {
        if (!this.isPlaying) {
            this.start();
        }
        if (!this.ctx || this.isBuildingDrop) return;

        // Ensure bass sliders are boosted enough to feel the drop!
        const kickVal = parseInt(this.sliders.subkick?.value || 0, 10);
        const bassVal = parseInt(this.sliders.bassline?.value || 0, 10);
        const driveVal = parseInt(this.sliders.subdrive?.value || 0, 10);

        if (kickVal < 75 && this.sliders.subkick) {
            this.sliders.subkick.value = 92;
            this.setChannelVolume('subkick', 92);
        }
        if (bassVal < 75 && this.sliders.bassline) {
            this.sliders.bassline.value = 90;
            this.setChannelVolume('bassline', 90);
        }
        if (driveVal < 75 && this.sliders.subdrive) {
            this.sliders.subdrive.value = 88;
            this.setChannelVolume('subdrive', 88);
        }

        const now = this.ctx.currentTime;
        const buildDuration = 1.65;
        this.isBuildingDrop = true;
        this.bassDropBtn?.classList.add('dropping');

        // 1. DJ Tension Riser Filter Sweep
        if (this.noiseBuffer) {
            const riserNoise = this.ctx.createBufferSource();
            riserNoise.buffer = this.noiseBuffer;
            riserNoise.loop = true;

            const riserFilter = this.ctx.createBiquadFilter();
            riserFilter.type = 'bandpass';
            riserFilter.Q.setValueAtTime(4.5, now);
            riserFilter.frequency.setValueAtTime(220, now);
            riserFilter.frequency.exponentialRampToValueAtTime(2600, now + buildDuration - 0.15);

            const riserGain = this.ctx.createGain();
            riserGain.gain.setValueAtTime(0.001, now);
            riserGain.gain.linearRampToValueAtTime(0.18, now + buildDuration - 0.25);
            riserGain.gain.linearRampToValueAtTime(0.0001, now + buildDuration);

            riserNoise.connect(riserFilter);
            riserFilter.connect(riserGain);
            riserGain.connect(this.masterBus);

            riserNoise.start(now);
            riserNoise.stop(now + buildDuration + 0.05);
        }

        if (!autoTrigger) {
            window.AionApp?.showToast('⚡ DJ BASS DROP INCOMING...');
        }

        // 2. SLAM IMPACT ON DROP!
        setTimeout(() => {
            if (!this.isPlaying || !this.ctx) {
                this.isBuildingDrop = false;
                this.bassDropBtn?.classList.remove('dropping');
                return;
            }
            const dropTime = this.ctx.currentTime + 0.02;
            this.isBuildingDrop = false;
            this.stepIndex = 0;
            this.nextNoteTime = dropTime;

            // Fire massive earthquake sub-drop impact!
            this.triggerSubKick(dropTime, 1.15, true);
            this.bassDropBtn?.classList.remove('dropping');

            if (this.isAutoDj && this.autoDjStatus) {
                this.autoDjStatus.textContent = `💥 DJ AION: ${this.subFreq} Hz SUB-BASS DROP AKTIVIERT!`;
            } else {
                window.AionApp?.showToast(`💥 ${this.subFreq} Hz DEEP BASS DROP!`);
            }
        }, buildDuration * 1000);
    }

    setGroove(grooveName) {
        if (!['deepdub', 'rolling', 'halftime', 'heartbeat'].includes(grooveName)) return;
        this.groove = grooveName;
        document.querySelectorAll('.groove-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.groove === grooveName);
        });
    }

    setBpm(bpm) {
        const clamped = Math.max(60, Math.min(138, Math.round(bpm)));
        this.bpm = clamped;
        if (this.bpmSlider) this.bpmSlider.value = clamped;
        if (this.bpmValEl) this.bpmValEl.textContent = `${clamped}`;
    }

    setSubFreq(hz) {
        const clamped = Math.max(30, Math.min(60, Math.round(hz)));
        this.subFreq = clamped;
        if (this.subFreqSlider) this.subFreqSlider.value = clamped;
        if (this.subFreqValEl) this.subFreqValEl.textContent = `${clamped} Hz`;

        if (this.ctx && this.nodes.drone) {
            const [osc1, osc2] = this.nodes.drone;
            const now = this.ctx.currentTime;
            osc1.frequency.setTargetAtTime(clamped, now, 0.08);
            osc2.frequency.setTargetAtTime(clamped * 1.5, now, 0.08);
        }
    }

    // ================= PLAYBACK LIFECYCLE =================
    start() {
        this.initAudio();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
            this.masterGain.gain.linearRampToValueAtTime(0.82, this.ctx.currentTime + 0.3);
        }
        this.isPlaying = true;
        this.startChordEngine();
        this.startChimeEngine();
        this.startGrooveEngine();

        // Sync visualizer if currently in ambient mode
        if (window.reactiveVisualizer && window.reactiveVisualizer.currentSource === 'ambient') {
            window.reactiveVisualizer.analyser = this.analyser;
            window.reactiveVisualizer.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            window.reactiveVisualizer.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
        }

        this.toggleBtn.textContent = '⏸ PAUSE SANCTUARY';
        this.toggleBtn.classList.add('active');
        window.AionApp?.showToast('🌌 Ambient & Deep Bass Sanctuary Active');
    }

    pause() {
        this.isPlaying = false;
        this.stopChordEngine();
        this.stopChimeEngine();
        this.stopGrooveEngine();
        this.stopAutoDj();
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
        }
        this.toggleBtn.textContent = '▶ START SANCTUARY';
        this.toggleBtn.classList.remove('active');
        window.AionApp?.showToast('⏸ Ambient Sanctuary Pausiert');
    }

    toggle() {
        if (!this.isPlaying) {
            this.start();
        } else {
            this.pause();
        }
    }

    // ================= AUTO-DJ ENGINE (NOW WITH DEEP BASS SETS) =================
    toggleAutoDj() {
        if (!this.isPlaying) {
            this.start();
        }
        this.isAutoDj = !this.isAutoDj;
        if (this.isAutoDj) {
            this.autoDjCycleCount = 0;
            this.autoDjBtn.textContent = '🎧 AUTO-DJ: AKTIV';
            this.autoDjBtn.classList.add('active');
            this.autoDjBanner.classList.remove('hidden');
            window.AionApp?.showToast('🎛️ AION AUTO-DJ aktiviert! Starte Deep-Bass DJ Mix.');
            this.runAutoDjCycle(true);
        } else {
            this.stopAutoDj();
            window.AionApp?.showToast('Auto-DJ gestoppt (Manuelle Kontrolle).');
        }
    }

    stopAutoDj() {
        this.isAutoDj = false;
        if (this.autoDjTimer) clearTimeout(this.autoDjTimer);
        this.autoDjBtn.textContent = '🎛️ AUTO-DJ: AUS';
        this.autoDjBtn.classList.remove('active');
        this.autoDjBanner.classList.add('hidden');
    }

    runAutoDjCycle(isFirst = false) {
        if (!this.isAutoDj || !this.isPlaying) return;
        this.autoDjCycleCount++;

        const djTransitions = [
            {
                name: 'Deep Dub Observatory ~ 38 Hz 808 Sub-Kick & Rolling Dub Bassline (112 BPM)',
                groove: 'deepdub', bpm: 112, subFreq: 38,
                target: { drone: 80, binaural: 30, chords: 68, rain: 20, wind: 40, chimes: 25, subkick: 88, bassline: 90, subdrive: 85 }
            },
            {
                name: 'Earthquake Sub Drop ~ 34 Hz Halftime 808 & Cosmic Void (84 BPM)',
                groove: 'halftime', bpm: 84, subFreq: 34,
                target: { drone: 90, binaural: 35, chords: 55, rain: 15, wind: 50, chimes: 20, subkick: 95, bassline: 88, subdrive: 95 }
            },
            {
                name: 'Cyber Club Hypnosis ~ Druckvolle 40 Hz Analog-Bassline (122 BPM)',
                groove: 'rolling', bpm: 122, subFreq: 40,
                target: { drone: 75, binaural: 20, chords: 72, rain: 15, wind: 55, chimes: 35, subkick: 92, bassline: 95, subdrive: 88 }
            },
            {
                name: 'Astral Heartbeat Flow ~ Tiefer 42 Hz Puls & 432 Hz Theta (74 BPM)',
                groove: 'heartbeat', bpm: 74, subFreq: 42,
                target: { drone: 70, binaural: 75, chords: 80, rain: 30, wind: 35, chimes: 50, subkick: 68, bassline: 72, subdrive: 75 }
            },
            {
                name: 'Sub-Zero Solar Drift ~ Tiefbass-Resonanz & Resonanter Wind (106 BPM)',
                groove: 'deepdub', bpm: 106, subFreq: 36,
                target: { drone: 85, binaural: 30, chords: 50, rain: 45, wind: 75, chimes: 20, subkick: 82, bassline: 85, subdrive: 82 }
            },
            {
                name: 'Quantum Zen Groove ~ Warmes Analog-Fundament & Glocken (116 BPM)',
                groove: 'deepdub', bpm: 116, subFreq: 39,
                target: { drone: 65, binaural: 40, chords: 82, rain: 25, wind: 25, chimes: 75, subkick: 80, bassline: 84, subdrive: 80 }
            }
        ];

        const chosen = isFirst
            ? djTransitions[0]
            : djTransitions[Math.floor(Math.random() * djTransitions.length)];

        this.setGroove(chosen.groove);
        this.setBpm(chosen.bpm);
        this.setSubFreq(chosen.subFreq);
        this.autoDjStatus.textContent = `DJ AION: ${chosen.name}`;

        // Smooth Crossfade (3s on initial DJ startup so user hears deep bass quickly, 5.5s between sets)
        const steps = isFirst ? 20 : 30;
        const durationMs = isFirst ? 2400 : 5500;
        const intervalMs = durationMs / steps;
        let step = 0;

        const startVals = {};
        Object.keys(this.sliders).forEach(ch => {
            if (this.sliders[ch]) {
                startVals[ch] = parseInt(this.sliders[ch].value, 10);
            }
        });

        const fadeInterval = setInterval(() => {
            if (!this.isAutoDj || !this.isPlaying) {
                clearInterval(fadeInterval);
                return;
            }
            step++;
            const t = step / steps;
            const smoothT = (1 - Math.cos(t * Math.PI)) / 2;

            Object.keys(this.sliders).forEach(ch => {
                if (!this.sliders[ch] || chosen.target[ch] === undefined) return;
                const targetVal = chosen.target[ch];
                const currentVal = Math.round(startVals[ch] + (targetVal - startVals[ch]) * smoothT);
                this.sliders[ch].value = currentVal;
                this.setChannelVolume(ch, currentVal);
            });

            if (step >= steps) {
                clearInterval(fadeInterval);

                // Every 2nd cycle, execute a dramatic DJ Bass Drop for tension & energy!
                if (this.autoDjCycleCount > 1 && this.autoDjCycleCount % 2 === 0) {
                    setTimeout(() => {
                        if (this.isAutoDj && this.isPlaying) this.triggerBassDrop(true);
                    }, 3500);
                }

                const nextWait = 14000 + Math.random() * 8000;
                this.autoDjTimer = setTimeout(() => this.runAutoDjCycle(false), nextWait);
            }
        }, intervalMs);
    }

    setChannelVolume(channel, percent) {
        const valEl = document.getElementById(`val-${channel}`);
        if (valEl) valEl.textContent = `${percent}%`;

        if (channel === 'subdrive') {
            this.applySubDrive(percent);
            return;
        }

        if (this.gains[channel] && this.ctx) {
            const multipliers = {
                drone: 0.42,
                binaural: 0.28,
                chords: 0.28,
                rain: 0.22,
                wind: 0.20,
                chimes: 0.35,
                subkick: 0.92,
                bassline: 0.72
            };
            const mult = multipliers[channel] || 0.25;
            this.gains[channel].gain.linearRampToValueAtTime((percent / 100) * mult, this.ctx.currentTime + 0.08);
        }
    }

    applyPreset(presetKey) {
        if (this.isAutoDj) this.stopAutoDj();
        const preset = this.presets[presetKey];
        if (!preset) return;

        Object.keys(this.sliders).forEach(ch => {
            if (this.sliders[ch] && preset[ch] !== undefined) {
                this.sliders[ch].value = preset[ch];
                this.setChannelVolume(ch, preset[ch]);
            }
        });

        if (preset.bpm) this.setBpm(preset.bpm);
        if (preset.subFreq) this.setSubFreq(preset.subFreq);
        if (preset.groove) this.setGroove(preset.groove);

        document.querySelectorAll('.preset-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === presetKey);
        });

        // Auto-start if user clicks a DJ bass mood preset while paused
        if (presetKey.startsWith('dj_') && !this.isPlaying) {
            this.start();
        }

        window.AionApp?.showToast(`Mood: ${presetKey.replace('_', ' ').toUpperCase()}`);
    }

    applyRandomMood() {
        if (this.isAutoDj) this.stopAutoDj();
        Object.keys(this.sliders).forEach(ch => {
            if (!this.sliders[ch]) return;
            const rVal = (ch === 'subkick' || ch === 'bassline' || ch === 'subdrive')
                ? Math.floor(Math.random() * 65 + 30)
                : Math.floor(Math.random() * 85 + 10);
            this.sliders[ch].value = rVal;
            this.setChannelVolume(ch, rVal);
        });
        const grooves = ['deepdub', 'rolling', 'halftime', 'heartbeat'];
        this.setGroove(grooves[Math.floor(Math.random() * grooves.length)]);
        this.setBpm(Math.floor(Math.random() * 52 + 74));
        this.setSubFreq(Math.floor(Math.random() * 14 + 34));
        document.querySelectorAll('.preset-pill').forEach(btn => btn.classList.remove('active'));
        window.AionApp?.showToast('🎲 Random Ambient & Deep Bass Mood generated!');
    }

    renderMiniWaveform() {
        const draw = () => {
            requestAnimationFrame(draw);
            if (!document.getElementById('tab-ambient')?.classList.contains('active')) {
                return;
            }
            const w = this.miniCanvas.width;
            const h = this.miniCanvas.height;
            this.miniCtx.clearRect(0, 0, w, h);

            if (!this.analyser || !this.isPlaying) {
                this.miniCtx.strokeStyle = 'rgba(0, 255, 204, 0.2)';
                this.miniCtx.lineWidth = 1;
                this.miniCtx.beginPath();
                this.miniCtx.moveTo(0, h / 2);
                this.miniCtx.lineTo(w, h / 2);
                this.miniCtx.stroke();
                return;
            }

            const buffer = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteTimeDomainData(buffer);

            const msSinceKick = performance.now() - this.lastBassHitTime;
            const kickGlow = Math.max(0, 1 - msSinceKick / 280);

            this.miniCtx.lineWidth = 2.0 + kickGlow * 1.5;
            this.miniCtx.strokeStyle = kickGlow > 0.35 ? '#ff3366' : '#9d4edd';
            this.miniCtx.beginPath();

            const sliceWidth = w / buffer.length;
            let x = 0;
            for (let i = 0; i < buffer.length; i++) {
                const v = buffer[i] / 128.0;
                const y = (v * h) / 2;
                if (i === 0) this.miniCtx.moveTo(x, y);
                else this.miniCtx.lineTo(x, y);
                x += sliceWidth;
            }
            this.miniCtx.stroke();
        };
        draw();
    }

    initEvents() {
        this.toggleBtn?.addEventListener('click', () => this.toggle());
        this.autoDjBtn?.addEventListener('click', () => this.toggleAutoDj());
        this.randomBtn?.addEventListener('click', () => this.applyRandomMood());
        this.bassDropBtn?.addEventListener('click', () => this.triggerBassDrop(false));

        Object.keys(this.sliders).forEach(ch => {
            this.sliders[ch]?.addEventListener('input', (e) => {
                if (this.isAutoDj) this.stopAutoDj();
                this.setChannelVolume(ch, parseInt(e.target.value, 10));
            });
        });

        this.bpmSlider?.addEventListener('input', (e) => {
            if (this.isAutoDj) this.stopAutoDj();
            this.setBpm(parseInt(e.target.value, 10));
        });

        this.subFreqSlider?.addEventListener('input', (e) => {
            if (this.isAutoDj) this.stopAutoDj();
            this.setSubFreq(parseInt(e.target.value, 10));
        });

        document.querySelectorAll('.groove-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isAutoDj) this.stopAutoDj();
                this.setGroove(btn.dataset.groove);

                // Auto-enable & boost bass sliders softly if currently muted so clicking a groove plays right away!
                if (parseInt(this.sliders.subkick?.value || 0, 10) < 15 && this.sliders.subkick) {
                    this.sliders.subkick.value = 75;
                    this.setChannelVolume('subkick', 75);
                }
                if (parseInt(this.sliders.bassline?.value || 0, 10) < 15 && this.sliders.bassline) {
                    this.sliders.bassline.value = 78;
                    this.setChannelVolume('bassline', 78);
                }
                if (!this.isPlaying) {
                    this.start();
                }
                window.AionApp?.showToast(`🎧 DJ Groove: ${btn.textContent.trim()}`);
            });
        });

        document.querySelectorAll('.preset-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyPreset(btn.dataset.preset);
            });
        });

        document.getElementById('btn-ambient-to-visualizer')?.addEventListener('click', () => {
            if (!this.isPlaying) {
                this.start();
            }
            window.reactiveVisualizer?.setSource('ambient');
            window.AionApp?.switchTab('visualizer');
        });
    }
}
