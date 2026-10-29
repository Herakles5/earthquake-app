/**
 * AION AMBIENT SANCTUARY
 * 100% Realtime Procedural WebAudio Soundscape Synthesizer
 * No audio files, infinite evolving soundscapes, theta binaural beats & generative chords.
 * Includes autonomous AION AUTO-DJ MODE that morphs moods & crossfades layers continuously!
 */

class AmbientSanctuary {
    constructor() {
        this.isPlaying = false;
        this.isAutoDj = false;
        this.autoDjTimer = null;
        this.ctx = null;
        this.masterGain = null;
        this.analyser = null;

        // Channel Gains
        this.gains = {
            drone: null,
            binaural: null,
            chords: null,
            rain: null,
            wind: null,
            chimes: null
        };

        this.nodes = {};
        this.chordTimer = null;
        this.chimeTimer = null;

        // UI elements
        this.toggleBtn = document.getElementById('btn-ambient-toggle');
        this.autoDjBtn = document.getElementById('btn-ambient-autodj');
        this.randomBtn = document.getElementById('btn-ambient-random');
        this.autoDjBanner = document.getElementById('autodj-banner');
        this.autoDjStatus = document.getElementById('autodj-status-text');

        this.miniCanvas = document.getElementById('ambient-mini-canvas');
        this.miniCtx = this.miniCanvas.getContext('2d');

        // Sliders
        this.sliders = {
            drone: document.getElementById('slider-drone'),
            binaural: document.getElementById('slider-binaural'),
            chords: document.getElementById('slider-chords'),
            rain: document.getElementById('slider-rain'),
            wind: document.getElementById('slider-wind'),
            chimes: document.getElementById('slider-chimes')
        };

        this.presets = {
            cosmic_void: { drone: 80, binaural: 40, chords: 50, rain: 20, wind: 60, chimes: 20 },
            theta_meditation: { drone: 50, binaural: 90, chords: 65, rain: 15, wind: 25, chimes: 45 },
            stellar_rain: { drone: 30, binaural: 35, chords: 40, rain: 90, wind: 70, chimes: 10 },
            cyber_aurora: { drone: 70, binaural: 50, chords: 85, rain: 25, wind: 40, chimes: 65 },
            zen_temple: { drone: 45, binaural: 60, chords: 70, rain: 40, wind: 20, chimes: 90 }
        };

        this.initEvents();
        this.renderMiniWaveform();
    }

    initAudio() {
        if (this.ctx) return;
        this.ctx = window.AionApp.getAudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.75, this.ctx.currentTime);

        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.85;

        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        this.buildSubDrone();
        this.buildBinauralTheta();
        this.buildEtherealChords();
        this.buildPinkNoiseRain();
        this.buildSolarWind();
        this.buildZenChimes();
    }

    buildSubDrone() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.drone.value / 100 * 0.45, this.ctx.currentTime);

        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(55.0, this.ctx.currentTime);
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(55.3, this.ctx.currentTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(110, this.ctx.currentTime);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc1.start();
        osc2.start();

        this.gains.drone = gain;
        this.nodes.drone = [osc1, osc2, filter];
    }

    buildBinauralTheta() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.binaural.value / 100 * 0.3, this.ctx.currentTime);

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

        gain.connect(this.masterGain);
        oscL.start();
        oscR.start();

        this.gains.binaural = gain;
        this.nodes.binaural = [oscL, oscR];
    }

    buildEtherealChords() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.chords.value / 100 * 0.28, this.ctx.currentTime);
        gain.connect(this.masterGain);
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
            const chord = chordPitches[chordIndex];
            chordIndex = (chordIndex + 1) % chordPitches.length;

            activeChordOscs.forEach(({ osc, vGain }) => {
                try {
                    vGain.gain.linearRampToValueAtTime(0.0001, now + 3.0);
                    setTimeout(() => { osc.stop(); osc.disconnect(); }, 3200);
                } catch(e) {}
            });
            activeChordOscs = [];

            chord.forEach(freq => {
                const osc = this.ctx.createOscillator();
                const vGain = this.ctx.createGain();
                const vFilter = this.ctx.createBiquadFilter();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now);

                vFilter.type = 'lowpass';
                vFilter.frequency.setValueAtTime(650, now);

                vGain.gain.setValueAtTime(0.0001, now);
                vGain.gain.linearRampToValueAtTime(0.08, now + 3.5);

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
                try { osc.stop(); } catch(e) {}
            });
            activeChordOscs = [];
        };
    }

    buildPinkNoiseRain() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.rain.value / 100 * 0.22, this.ctx.currentTime);

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
        gain.connect(this.masterGain);

        whiteNoise.start();
        this.gains.rain = gain;
        this.nodes.rain = [whiteNoise, rainFilter];
    }

    buildSolarWind() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.wind.value / 100 * 0.2, this.ctx.currentTime);

        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuffer;
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
        gain.connect(this.masterGain);

        noise.start();
        lfo.start();

        this.gains.wind = gain;
        this.nodes.wind = [noise, bpFilter, lfo];
    }

    buildZenChimes() {
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.sliders.chimes.value / 100 * 0.35, this.ctx.currentTime);
        gain.connect(this.masterGain);
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

    start() {
        this.initAudio();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
            this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
            this.masterGain.gain.linearRampToValueAtTime(0.75, this.ctx.currentTime + 0.3);
        }
        this.isPlaying = true;
        this.startChordEngine();
        this.startChimeEngine();

        this.toggleBtn.textContent = '⏸ PAUSE SANCTUARY';
        this.toggleBtn.classList.add('active');
        window.AionApp?.showToast('🌌 Ambient Sanctuary Active');
    }

    pause() {
        this.isPlaying = false;
        this.stopChordEngine();
        this.stopChimeEngine();
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

    // ================= AUTO-DJ ENGINE =================
    toggleAutoDj() {
        if (!this.isPlaying) {
            this.start();
        }
        this.isAutoDj = !this.isAutoDj;
        if (this.isAutoDj) {
            this.autoDjBtn.textContent = '🎧 AUTO-DJ: AKTIV';
            this.autoDjBtn.classList.add('active');
            this.autoDjBanner.classList.remove('hidden');
            window.AionApp?.showToast('🎛️ AION AUTO-DJ aktiviert! Sie mischt jetzt vollautomatisch.');
            this.runAutoDjCycle();
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

    runAutoDjCycle() {
        if (!this.isAutoDj || !this.isPlaying) return;

        const djTransitions = [
            {
                name: 'Astral Flow ~ Tiefbass-Resonanz & Ethereal Pad Boost',
                target: { drone: 85, binaural: 55, chords: 75, rain: 20, wind: 35, chimes: 30 }
            },
            {
                name: 'Stellar Drift ~ 432Hz Theta Trance & Zartes Rauschen',
                target: { drone: 45, binaural: 95, chords: 50, rain: 40, wind: 30, chimes: 50 }
            },
            {
                name: 'Cosmic Rainstorm ~ Kristalliner Wind & Sanfter Regen',
                target: { drone: 30, binaural: 40, chords: 45, rain: 95, wind: 80, chimes: 20 }
            },
            {
                name: 'Zen Bell Sanctuary ~ Gläserne Glocken & Weite Harmonien',
                target: { drone: 50, binaural: 65, chords: 85, rain: 25, wind: 20, chimes: 95 }
            },
            {
                name: 'Deep Void Horizon ~ Minimalistischer Sub-Bass & Raumwind',
                target: { drone: 90, binaural: 30, chords: 35, rain: 15, wind: 70, chimes: 15 }
            }
        ];

        const chosen = djTransitions[Math.floor(Math.random() * djTransitions.length)];
        this.autoDjStatus.textContent = `DJ AION: ${chosen.name}`;

        // Smooth Crossfade over 6 seconds
        const steps = 30;
        const durationMs = 6000;
        const intervalMs = durationMs / steps;
        let step = 0;

        const startVals = {};
        Object.keys(this.sliders).forEach(ch => {
            startVals[ch] = parseInt(this.sliders[ch].value, 10);
        });

        const fadeInterval = setInterval(() => {
            step++;
            const t = step / steps;
            // Smooth sinusoidal interpolation
            const smoothT = (1 - Math.cos(t * Math.PI)) / 2;

            Object.keys(this.sliders).forEach(ch => {
                const targetVal = chosen.target[ch];
                const currentVal = Math.round(startVals[ch] + (targetVal - startVals[ch]) * smoothT);
                this.sliders[ch].value = currentVal;
                this.setChannelVolume(ch, currentVal);
            });

            if (step >= steps) {
                clearInterval(fadeInterval);
                // Schedule next DJ evolution in 12 - 20 seconds
                const nextWait = 12000 + Math.random() * 8000;
                this.autoDjTimer = setTimeout(() => this.runAutoDjCycle(), nextWait);
            }
        }, intervalMs);
    }

    setChannelVolume(channel, percent) {
        const valEl = document.getElementById(`val-${channel}`);
        if (valEl) valEl.textContent = `${percent}%`;
        if (this.gains[channel] && this.ctx) {
            const multipliers = { drone: 0.45, binaural: 0.3, chords: 0.28, rain: 0.22, wind: 0.2, chimes: 0.35 };
            const mult = multipliers[channel] || 0.25;
            this.gains[channel].gain.linearRampToValueAtTime((percent / 100) * mult, this.ctx.currentTime + 0.1);
        }
    }

    applyPreset(presetKey) {
        if (this.isAutoDj) this.stopAutoDj();
        const preset = this.presets[presetKey];
        if (!preset) return;

        Object.keys(preset).forEach(ch => {
            if (this.sliders[ch]) {
                this.sliders[ch].value = preset[ch];
                this.setChannelVolume(ch, preset[ch]);
            }
        });

        document.querySelectorAll('.preset-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === presetKey);
        });

        window.AionApp?.showToast(`Mood: ${presetKey.replace('_', ' ').toUpperCase()}`);
    }

    applyRandomMood() {
        if (this.isAutoDj) this.stopAutoDj();
        Object.keys(this.sliders).forEach(ch => {
            const rVal = Math.floor(Math.random() * 85 + 10);
            this.sliders[ch].value = rVal;
            this.setChannelVolume(ch, rVal);
        });
        document.querySelectorAll('.preset-pill').forEach(btn => btn.classList.remove('active'));
        window.AionApp?.showToast('🎲 Random Ambient Soundscape generated!');
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

            this.miniCtx.lineWidth = 2.0;
            this.miniCtx.strokeStyle = '#9d4edd';
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

        Object.keys(this.sliders).forEach(ch => {
            this.sliders[ch]?.addEventListener('input', (e) => {
                if (this.isAutoDj) this.stopAutoDj();
                this.setChannelVolume(ch, parseInt(e.target.value, 10));
            });
        });

        document.querySelectorAll('.preset-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyPreset(btn.dataset.preset);
            });
        });

        document.getElementById('btn-ambient-to-visualizer')?.addEventListener('click', () => {
            window.AionApp?.switchTab('visualizer');
        });
    }
}
