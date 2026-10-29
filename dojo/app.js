/**
 * AION CREATIVE LAB & ARCADE - MAIN ORCHESTRATOR
 * Tab switcher, WebAudio context coordinator, master mute, and FPS monitor.
 */

class AionApp {
    constructor() {
        this.audioAllowed = false;
        this.audioCtx = null;
        this.fpsEl = document.getElementById('fps-counter');
        this.muteBtn = document.getElementById('btn-master-mute');
        this.toastContainer = document.getElementById('toast-container');

        this.initAudioContext();
        this.initTabs();
        this.initFPSMeter();
    }

    getAudioContext() {
        if (!this.audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioCtx();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
        }
        return this.audioCtx;
    }

    initAudioContext() {
        const unlock = () => {
            this.audioAllowed = true;
            this.getAudioContext();
            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('click', unlock);
        window.addEventListener('keydown', unlock);

        // Resume AudioContext on tab focus / visibility change
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
        });
        window.addEventListener('focus', () => {
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => {});
            }
        });

        this.muteBtn.addEventListener('click', () => {
            this.audioAllowed = !this.audioAllowed;
            if (!this.audioAllowed) {
                if (this.audioCtx) this.audioCtx.suspend();
                this.muteBtn.textContent = '🔇 MUTE';
                this.muteBtn.style.borderColor = '#ff3366';
                this.muteBtn.style.color = '#ff3366';
                this.showToast('Audio Muted');
            } else {
                if (this.audioCtx) this.audioCtx.resume();
                this.muteBtn.textContent = '🔊 ON';
                this.muteBtn.style.borderColor = '#00ffcc';
                this.muteBtn.style.color = '#00ffcc';
                this.showToast('Audio Unmuted');
            }
        });
    }

    initTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchTab(tab.dataset.tab);
            });
        });

        const savedTab = localStorage.getItem('aion_active_tab') || 'visualizer';
        this.switchTab(savedTab);
    }

    switchTab(tabKey) {
        try { localStorage.setItem('aion_active_tab', tabKey); } catch(e) {}

        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabKey);
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabKey}`);
        });

        // Specific pause handling when switching away
        if (tabKey !== 'tetris' && window.quantumTetris && window.quantumTetris.isRunning) {
            if (!window.quantumTetris.isPaused) window.quantumTetris.pause();
        }

        if (tabKey === 'visualizer' && window.reactiveVisualizer) {
            window.reactiveVisualizer.initCanvasSize();
        }
    }

    showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    initFPSMeter() {
        let frameCount = 0;
        let lastFpsUpdate = performance.now();

        const countFPS = (now) => {
            frameCount++;
            if (now - lastFpsUpdate >= 1000) {
                const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
                this.fpsEl.textContent = `${fps} FPS`;
                frameCount = 0;
                lastFpsUpdate = now;
            }
            requestAnimationFrame(countFPS);
        };
        requestAnimationFrame(countFPS);
    }
}

// Global bootstrap
window.addEventListener('DOMContentLoaded', () => {
    window.AionApp = new AionApp();
    window.ambientSanctuary = new AmbientSanctuary();
    window.reactiveVisualizer = new ReactiveVisualizer();
    window.quantumTetris = new QuantumTetris();
    window.cyberBoxing = new CyberBoxingDojo();

    console.log('%cAION CREATIVE LAB & ARCADE INITIALIZED', 'color: #00ffcc; font-weight: bold; font-size: 14px;');
});

