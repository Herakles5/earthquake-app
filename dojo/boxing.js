/**
 * AION CYBER BOXING REFLEX DOJO
 * 3D Wireframe Canvas Boxing Arcade Game
 * 
 * Features:
 * - 12 Rounds Tournament with 3:00 Min (180s) Total Match Clock
 * - Dual Health AND Stamina for BOTH Fighters (Aion & Player)
 * - Anti-Spam Defense: Aion guards all non-counter punches (1 chip damage)
 * - Stamina Consumption on punches and blocks
 * - Massive Counter Damage during Stun Windows (after Dodge / Parry)
 * - Knockdown System with Absolute K.O. and Points Decision
 * - Persistent Hall of Fame / Highscore System with Player Name Entry
 * - Full Keyboard, Mouse and Touch Controls with 60 FPS Canvas Rendering
 */

class CyberBoxingDojo {
    constructor() {
        this.canvas = document.getElementById('boxing-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.roundEl = document.getElementById('box-round');
        this.timerEl = document.getElementById('box-timer');
        this.scoreEl = document.getElementById('box-score');
        this.comboEl = document.getElementById('box-combo');
        this.reactionEl = document.getElementById('box-reaction');
        this.accuracyEl = document.getElementById('box-accuracy');
        this.dangerEl = document.getElementById('box-danger');

        // Opponent (Aion) Bars
        this.aionHpBar = document.getElementById('aion-hp-bar');
        this.aionHpVal = document.getElementById('aion-hp-val');
        this.aionStaminaBar = document.getElementById('aion-stamina-bar');
        this.aionStaminaVal = document.getElementById('aion-stamina-val');

        // Player Bars
        this.playerHpBar = document.getElementById('player-hp-bar');
        this.playerHpVal = document.getElementById('player-hp-val');
        this.playerStaminaBar = document.getElementById('player-stamina-bar');
        this.playerStaminaVal = document.getElementById('player-stamina-val');

        // UI Modals & Elements
        this.promptBanner = document.getElementById('boxing-prompt');
        this.promptAction = document.getElementById('boxing-prompt-action');
        this.promptKey = document.getElementById('boxing-prompt-key');
        this.overlay = document.getElementById('boxing-overlay');
        this.startBtn = document.getElementById('btn-boxing-start');
        this.sideRestartBtn = document.getElementById('btn-boxing-restart-side');

        // Highscore / Hall of Fame Elements
        this.scoreInputWrap = document.getElementById('boxing-score-input-wrap');
        this.nameInput = document.getElementById('boxing-name-input');
        this.btnSaveScore = document.getElementById('btn-boxing-save-score');
        this.hofModal = document.getElementById('boxing-hof-modal');
        this.hofTableBody = document.getElementById('hof-table-body');
        this.btnHofTrigger = document.getElementById('btn-boxing-hof-trigger');
        this.btnViewHof = document.getElementById('btn-boxing-view-hof');
        this.btnCloseHof = document.getElementById('btn-close-hof');
        this.btnClearHof = document.getElementById('btn-clear-hof');

        // Game State
        this.isPlaying = false;
        this.lastActionTime = 0;
        this.round = 1;
        this.maxRounds = 12;
        this.matchTimeLeft = 180; // Total 3 minutes countdown (180 seconds)
        this.score = 0;
        this.combo = 0;
        this.totalPrompts = 0;
        this.successfulDefenses = 0;
        this.aionKnockdowns = 0;

        // Dual Fighter Stats
        this.playerHp = 100;
        this.playerStamina = 100;
        this.aionHp = 100;
        this.aionStamina = 100;

        // Player Physical Posture: 'neutral' | 'dodge_left' | 'block' | 'dodge_right' | 'punch'
        this.playerState = 'neutral';
        this.playerXOffset = 0;
        this.resetMoveTimer = null;

        // Enemy State: 'idle' | 'charging' | 'striking' | 'stunned'
        this.aionState = 'idle';
        this.incomingAttack = null;
        this.attackTimer = null;
        this.matchInterval = null;
        this.staminaInterval = null;

        // Visual Particles & Floaters
        this.particles = [];
        this.floatingTexts = [];

        this.initHallOfFame();
        this.initControls();
        this.render();
    }

    start() {
        this.isPlaying = true;
        this.round = 1;
        this.matchTimeLeft = 180; // 3 Minutes (180s)
        this.score = 0;
        this.combo = 0;
        this.totalPrompts = 0;
        this.successfulDefenses = 0;
        this.aionKnockdowns = 0;

        this.playerHp = 100;
        this.playerStamina = 100;
        this.aionHp = 100;
        this.aionStamina = 100;

        this.playerState = 'neutral';
        this.playerXOffset = 0;
        this.aionState = 'idle';
        this.incomingAttack = null;
        this.lastActionTime = 0;

        this.updateUI();
        this.updateDangerUI();
        this.overlay.classList.add('hidden');
        this.scoreInputWrap.classList.add('hidden');

        // 1. Match Timer Countdown (180s continuous clock)
        if (this.matchInterval) clearInterval(this.matchInterval);
        this.matchInterval = setInterval(() => {
            if (!this.isPlaying) return;
            this.matchTimeLeft--;

            // Update MM:SS display
            const minutes = Math.floor(this.matchTimeLeft / 60);
            const seconds = this.matchTimeLeft % 60;
            this.timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            // 12 Rounds Progression: 15s per round
            const targetRound = Math.min(12, Math.floor((180 - this.matchTimeLeft) / 15) + 1);
            if (targetRound > this.round) {
                this.advanceToRound(targetRound);
            }

            this.updateDangerUI();

            // Match Time Expired after 12 rounds!
            if (this.matchTimeLeft <= 0) {
                const won = this.playerHp > this.aionHp || this.score >= 2500;
                this.endGame(won, 'DECISION');
            }
        }, 1000);

        // 2. Continuous Dual Stamina Loop (every 100ms)
        if (this.staminaInterval) clearInterval(this.staminaInterval);
        this.staminaInterval = setInterval(() => {
            if (!this.isPlaying) return;

            // Player Stamina Regeneration (+1.2% per tick when not blocking/punching)
            if (this.playerState === 'neutral' || this.playerState.startsWith('dodge')) {
                if (this.playerStamina < 100) {
                    this.playerStamina = Math.min(100, this.playerStamina + 1.2);
                }
            }

            // Aion Stamina Regeneration (+1.0% per tick unless stunned)
            if (this.aionState !== 'stunned') {
                if (this.aionStamina < 100) {
                    this.aionStamina = Math.min(100, this.aionStamina + 1.0);
                }
            }

            this.updateStaminaBars();
        }, 100);

        this.scheduleNextAionAttack(1800);
        this.playBellSound();
        this.showFloatingText('ROUND 1 - FIGHT!', '#00ffcc', 1400);
        window.AionApp?.showToast('🥊 12-Runden Meisterschaft gestartet! W=Deckung, Q/E=Ausweichen, SPACE=Schlagen');
    }

    advanceToRound(newRound) {
        this.round = newRound;
        this.roundEl.textContent = `${this.round} / 12`;
        this.playBellSound();
        this.showFloatingText(`🔔 RUNDE ${this.round} / 12!`, '#ffd166', 1500);

        // Breather recovery for both fighters
        this.playerStamina = 100;
        this.aionStamina = 100;
        this.playerHp = Math.min(100, this.playerHp + 12);
        this.aionHp = Math.min(100, this.aionHp + 10);

        this.updateUI();
        this.updateDangerUI();
        window.AionApp?.showToast(`🔔 RUNDE ${this.round} / 12! Durchhalten bis zum Gong!`);
    }

    scheduleNextAionAttack(delay = null) {
        if (!this.isPlaying) return;
        if (this.attackTimer) clearTimeout(this.attackTimer);

        if (delay === null) {
            // Speed up attacks progressively across 12 rounds
            const roundSpeedup = (this.round - 1) * 85;
            const elapsed = 180 - this.matchTimeLeft;
            const timeSpeedup = elapsed * 3;
            delay = Math.max(600, 1800 - roundSpeedup - timeSpeedup);
        }

        this.attackTimer = setTimeout(() => {
            if (!this.isPlaying) return;
            this.telegraphAttack();
        }, delay);
    }

    telegraphAttack() {
        if (!this.isPlaying || this.aionState === 'stunned') return;

        // Dynamic Telegraph charge time (gets sharper in later rounds: 2.2s -> 0.75s)
        const roundPenalty = (this.round - 1) * 110;
        const timePenalty = (180 - this.matchTimeLeft) * 3.5;
        const comboPenalty = Math.min(250, this.combo * 15);
        const dynamicBaseCharge = Math.max(720, 2100 - roundPenalty - timePenalty - comboPenalty);

        const attacks = [
            {
                name: 'RECHTER HAKEN',
                label: '⚠️ RECHTER HAKEN! WEICHE LINKS AUS [Q] ODER BLOCK [W]!',
                safeMoves: ['dodge_left', 'block'],
                chargeTime: dynamicBaseCharge
            },
            {
                name: 'LINKER JAB',
                label: '⚠️ LINKER JAB! WEICHE RECHTS AUS [E] ODER BLOCK [W]!',
                safeMoves: ['dodge_right', 'block'],
                chargeTime: dynamicBaseCharge
            },
            {
                name: 'OVERHEAD CROSS',
                label: '⚠️ HEAVY OVERHEAD! HEBE DIE DECKUNG [W]!',
                safeMoves: ['block'],
                chargeTime: Math.max(750, dynamicBaseCharge + 150)
            }
        ];

        const attack = attacks[Math.floor(Math.random() * attacks.length)];
        this.aionState = 'charging';
        this.totalPrompts++;

        const startTime = performance.now();
        this.incomingAttack = {
            ...attack,
            startTime: startTime,
            strikeTime: startTime + attack.chargeTime,
            resolved: false
        };

        // Show telegraph warning banner
        this.promptAction.textContent = attack.label;
        this.promptKey.textContent = attack.safeMoves.includes('dodge_left') ? '[ Q / ◀ ]' : (attack.safeMoves.includes('dodge_right') ? '[ E / ▶ ]' : '[ W / ▲ ]');
        this.promptBanner.style.background = 'rgba(255, 0, 85, 0.95)';
        this.promptBanner.style.boxShadow = '0 0 35px rgba(255, 0, 85, 0.9)';
        this.promptBanner.classList.remove('hidden');

        this.playTone(280, 0.15, 'sawtooth');

        // Strike impact execution after charge window
        setTimeout(() => {
            if (this.isPlaying && this.incomingAttack && !this.incomingAttack.resolved) {
                this.executeAionStrike();
            }
        }, attack.chargeTime);
    }

    executeAionStrike() {
        if (!this.incomingAttack) return;
        this.incomingAttack.resolved = true;
        this.aionState = 'striking';
        this.promptBanner.classList.add('hidden');

        const isSafe = this.incomingAttack.safeMoves.includes(this.playerState);

        if (isSafe) {
            // Player successfully defended!
            this.successfulDefenses++;
            this.combo++;
            this.score += 250 + this.combo * 35;

            const reactionMs = Math.round(performance.now() - this.incomingAttack.startTime);
            this.reactionEl.textContent = `${reactionMs} ms`;

            if (this.playerState === 'block') {
                // High Block: 0 HP damage, costs 10% stamina, staggers Aion
                this.playerStamina = Math.max(0, this.playerStamina - 10);
                this.showFloatingText('🛡️ GEBLOCKT! (-10% STAMINA)', '#00ffcc', 800);
                this.playTone(480, 0.12, 'triangle');
                this.triggerAionStun(1800);
            } else {
                // Perfect Dodge: 0 damage, 0 stamina cost, Aion whiffs and loses 30% stamina!
                this.aionStamina = Math.max(0, this.aionStamina - 30);
                this.showFloatingText('💨 PERFECT DODGE! AION VERFEHLT!', '#ff00ff', 900);
                this.playTone(620, 0.12, 'sine');
                this.triggerAionStun(2400);
            }
        } else {
            // Undefended Hit: Player takes heavy blow!
            this.combo = 0;
            this.comboEl.textContent = '0x';
            this.playerHp = Math.max(0, this.playerHp - 18);
            this.playerStamina = Math.max(0, this.playerStamina - 14);

            this.showFloatingText('💥 TREFFER ERHALTEN! -18 HP', '#ff0044', 900);
            this.playTone(110, 0.35, 'sawtooth');
            this.spawnScreenShake();
            this.updateUI();

            if (this.playerHp <= 0) {
                this.endGame(false, 'KO');
                return;
            }

            this.aionState = 'idle';
            this.scheduleNextAionAttack(1600);
        }
    }

    triggerAionStun(duration = 2200) {
        this.aionState = 'stunned';
        this.promptAction.textContent = '⚡ AION IST BENOMMEN! SCHLAGE JETZT ZU! [LEERTASTE]';
        this.promptKey.textContent = '[ LEERTASTE / F ]';
        this.promptBanner.style.background = 'rgba(0, 255, 204, 0.95)';
        this.promptBanner.style.boxShadow = '0 0 35px rgba(0, 255, 204, 0.9)';
        this.promptBanner.classList.remove('hidden');

        // Dynamic stun duration based on round
        const stunDuration = Math.max(1100, duration - (this.round - 1) * 90);
        if (this.attackTimer) clearTimeout(this.attackTimer);

        this.attackTimer = setTimeout(() => {
            if (this.isPlaying && this.aionState === 'stunned') {
                this.aionState = 'idle';
                this.promptBanner.classList.add('hidden');
                this.scheduleNextAionAttack();
            }
        }, stunDuration);
    }

    // ================= PLAYER ACTIONS =================
    playerDodgeLeft() {
        if (!this.isPlaying) this.start();
        this.playerState = 'dodge_left';
        this.playerXOffset = -80;
        this.showFloatingText('AUSWEICHEN ◀', '#00ffcc', 400);
        this.playTone(520, 0.05, 'sine');

        clearTimeout(this.resetMoveTimer);
        this.resetMoveTimer = setTimeout(() => {
            this.playerState = 'neutral';
            this.playerXOffset = 0;
        }, 650);
    }

    playerHighBlock() {
        if (!this.isPlaying) this.start();
        this.playerState = 'block';
        this.playerXOffset = 0;
        this.showFloatingText('DECKUNG HOCH 🛡️', '#00ffcc', 400);
        this.playTone(380, 0.05, 'triangle');

        clearTimeout(this.resetMoveTimer);
        this.resetMoveTimer = setTimeout(() => {
            this.playerState = 'neutral';
        }, 800);
    }

    playerDodgeRight() {
        if (!this.isPlaying) this.start();
        this.playerState = 'dodge_right';
        this.playerXOffset = 80;
        this.showFloatingText('AUSWEICHEN ▶', '#00ffcc', 400);
        this.playTone(520, 0.05, 'sine');

        clearTimeout(this.resetMoveTimer);
        this.resetMoveTimer = setTimeout(() => {
            this.playerState = 'neutral';
            this.playerXOffset = 0;
        }, 650);
    }

    playerPunch() {
        if (!this.isPlaying) {
            this.start();
            return;
        }

        // Anti-Spam Stamina Check: Punch requires at least 8% stamina
        if (this.playerStamina < 8) {
            this.showFloatingText('⚠️ ZU ERSCHÖPFT! KEINE STAMINA!', '#ff3366', 600);
            this.playTone(140, 0.1, 'sawtooth');
            return;
        }

        // Deduct punch stamina (5%)
        this.playerStamina = Math.max(0, this.playerStamina - 5);
        this.updateStaminaBars();

        this.playerState = 'punch';
        clearTimeout(this.resetMoveTimer);
        this.resetMoveTimer = setTimeout(() => {
            this.playerState = 'neutral';
        }, 220);

        if (this.aionState === 'stunned') {
            // ================= CRITICAL COUNTER HIT =================
            const dmg = 20 + this.combo * 4;
            this.aionHp = Math.max(0, this.aionHp - dmg);
            this.aionStamina = Math.max(0, this.aionStamina - 25);
            this.score += 450 + this.combo * 100;
            this.combo++;

            this.showFloatingText(`🔥 KRITISCHER KONTER! -${dmg} HP`, '#ffd166', 900);
            this.spawnPunchParticles(true);
            this.playTone(190, 0.25, 'triangle');
            this.playTone(380, 0.15, 'sawtooth');

            this.updateUI();

            if (this.aionHp <= 0) {
                this.handleAionKnockdown();
                return;
            }

            // Aion recovers from stun after receiving heavy blow
            this.aionState = 'idle';
            this.promptBanner.classList.add('hidden');
            this.scheduleNextAionAttack(1400);
        } else {
            // ================= AION HAS GUARD UP (ANTI-SPAM) =================
            // Normal punch outside of counter-stun window is blocked!
            const dmg = 1; // Only 1 chip damage
            this.aionHp = Math.max(0, this.aionHp - dmg);
            this.playerStamina = Math.max(0, this.playerStamina - 3); // Extra stamina drain absorbed by guard
            this.score += 20;

            this.showFloatingText('🛡️ AION BLOCKT AB! (-1 HP)', '#8892b0', 400);
            this.spawnPunchParticles(false);
            this.playTone(280, 0.05, 'triangle');
            this.updateUI();

            if (this.aionHp <= 0) {
                this.handleAionKnockdown();
            }
        }
    }

    handleAionKnockdown() {
        this.aionState = 'stunned';
        this.promptBanner.classList.add('hidden');
        if (this.attackTimer) clearTimeout(this.attackTimer);

        this.aionKnockdowns++;

        // Absolute K.O. Condition: 3 knockdowns total or in the final 12th round!
        if (this.aionKnockdowns >= 3 || this.round >= 12) {
            this.endGame(true, 'KO');
            return;
        }

        // Round Knockdown: Next round starts!
        this.showFloatingText(`🔔 KNOCKDOWN! RUNDE ${this.round} GEWONNEN!`, '#ffd166', 1600);
        this.playBellSound();
        window.AionApp?.showToast(`🥊 KNOCKDOWN (${this.aionKnockdowns}/3)! Runde ${this.round + 1} startet...`);

        setTimeout(() => {
            if (!this.isPlaying) return;
            const nextRound = Math.min(12, this.round + 1);
            this.advanceToRound(nextRound);
            this.aionHp = 100;
            this.aionStamina = 100;
            this.aionState = 'idle';
            this.updateUI();
            this.scheduleNextAionAttack(1800);
        }, 2000);
    }

    updateUI() {
        this.roundEl.textContent = `${this.round} / 12`;
        this.scoreEl.textContent = this.score.toLocaleString();
        this.comboEl.textContent = `${this.combo}x`;

        // Health Bars
        this.playerHpVal.textContent = `${Math.round(this.playerHp)}%`;
        this.playerHpBar.style.width = `${Math.max(0, this.playerHp)}%`;
        this.aionHpVal.textContent = `${Math.round(this.aionHp)}%`;
        this.aionHpBar.style.width = `${Math.max(0, this.aionHp)}%`;

        this.updateStaminaBars();

        const acc = this.totalPrompts > 0 ? Math.round((this.successfulDefenses / this.totalPrompts) * 100) : 100;
        this.accuracyEl.textContent = `${acc}%`;
    }

    updateStaminaBars() {
        this.playerStaminaVal.textContent = `${Math.round(this.playerStamina)}%`;
        this.playerStaminaBar.style.width = `${Math.max(0, this.playerStamina)}%`;
        this.aionStaminaVal.textContent = `${Math.round(this.aionStamina)}%`;
        this.aionStaminaBar.style.width = `${Math.max(0, this.aionStamina)}%`;
    }

    updateDangerUI() {
        if (!this.dangerEl) return;
        let text = `RUNDE ${this.round} (LVL 1 - WARMUP)`;
        let color = '#00ffcc';

        if (this.round >= 10) {
            text = `RUNDE ${this.round} (LVL 4 - TITAN SPEED 💀)`;
            color = '#ff0055';
        } else if (this.round >= 7) {
            text = `RUNDE ${this.round} (LVL 3 - HYPER SPEED ⚡⚡)`;
            color = '#ff00aa';
        } else if (this.round >= 4) {
            text = `RUNDE ${this.round} (LVL 2 - FAST ⚡)`;
            color = '#ffd166';
        }

        this.dangerEl.textContent = text;
        this.dangerEl.style.color = color;
        this.dangerEl.style.textShadow = `0 0 10px ${color}`;
    }

    spawnPunchParticles(isCritical = false) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const color = isCritical ? '#ffd166' : '#00ffcc';
        const count = isCritical ? 30 : 12;

        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: w / 2,
                y: h * 0.42,
                vx: (Math.random() - 0.5) * (isCritical ? 16 : 8),
                vy: (Math.random() - 0.5) * (isCritical ? 16 : 8),
                color: color,
                size: Math.random() * (isCritical ? 5 : 3) + 2,
                life: 1.0
            });
        }
    }

    showFloatingText(text, color = '#fff', duration = 800) {
        this.floatingTexts.push({
            text: text,
            color: color,
            x: this.canvas.width / 2,
            y: this.canvas.height * 0.38,
            life: 1.0,
            fadeSpeed: 1000 / (duration * 60)
        });
    }

    spawnScreenShake() {
        this.playerXOffset = 18;
        setTimeout(() => this.playerXOffset = -18, 50);
        setTimeout(() => this.playerXOffset = 0, 120);
    }

    // ================= GAME OVER & HIGHSCORE =================
    endGame(playerWon, reason = 'DECISION') {
        this.isPlaying = false;
        if (this.matchInterval) clearInterval(this.matchInterval);
        if (this.staminaInterval) clearInterval(this.staminaInterval);
        if (this.attackTimer) clearTimeout(this.attackTimer);
        this.promptBanner.classList.add('hidden');

        let title = '';
        let desc = '';
        let statusTag = '';

        const playedSec = 180 - this.matchTimeLeft;
        const m = Math.floor(playedSec / 60);
        const s = playedSec % 60;
        const timeFormatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        if (playerWon) {
            this.playBellSound();
            if (reason === 'KO') {
                title = '🏆 ABSOLUTER K.O. SIEG! - WELTMEISTER!';
                desc = `Sensationeller K.O.! Du hast Aion auf die Bretter geschickt. Runden: ${this.round}/12 | Kampfzeit: ${timeFormatted} | Endscore: ${this.score.toLocaleString()}`;
                statusTag = 'K.O. SIEG';
            } else {
                title = '🏆 SIEG NACH PUNKTEN (12 RUNDEN)!';
                desc = `Volle 12 Runden überstanden und nach Punkten triumphiert! Kampfzeit: 03:00 | Endscore: ${this.score.toLocaleString()}`;
                statusTag = 'PUNKTSIEG';
            }
        } else {
            if (reason === 'KO') {
                title = '⚡ KNOCKOUT - AION SIEGT';
                desc = `Deine Deckung wurde in Runde ${this.round}/12 durchbrochen! Kampfzeit: ${timeFormatted} | Endscore: ${this.score.toLocaleString()}`;
                statusTag = 'K.O. NIEDERLAGE';
            } else {
                title = '⚡ PUNKTNIEDERLAGE NACH 12 RUNDEN';
                desc = `Alle 12 Runden gekämpft, aber Aion lag nach Punkten vorn! Endscore: ${this.score.toLocaleString()}`;
                statusTag = 'PUNKTVERLUST';
            }
        }

        document.getElementById('boxing-overlay-title').textContent = title;
        document.getElementById('boxing-overlay-desc').textContent = desc;
        this.startBtn.textContent = '▶ REMATCH STARTEN';

        // Reveal Highscore input wrap
        this.currentMatchResult = {
            rounds: `${this.round} / 12`,
            time: timeFormatted,
            score: this.score,
            status: statusTag
        };

        this.scoreInputWrap.classList.remove('hidden');
        this.overlay.classList.remove('hidden');
        this.nameInput.value = '';
        setTimeout(() => this.nameInput.focus(), 100);
    }

    // ================= HALL OF FAME / HIGHSCORE LOGIC =================
    initHallOfFame() {
        this.btnSaveScore?.addEventListener('click', () => this.submitScore());
        this.nameInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitScore();
            }
        });

        this.btnHofTrigger?.addEventListener('click', () => this.openHallOfFame());
        this.btnViewHof?.addEventListener('click', () => this.openHallOfFame());
        this.btnCloseHof?.addEventListener('click', () => this.closeHallOfFame());
        this.btnClearHof?.addEventListener('click', () => this.clearHallOfFame());
    }

    getHallOfFameData() {
        const defaultScores = [
            { name: 'CYBER_VIPER', rounds: '12 / 12', time: '02:48', score: 18450, status: 'K.O. SIEG' },
            { name: 'NEO_TITAN', rounds: '12 / 12', time: '03:00', score: 14200, status: 'PUNKTSIEG' },
            { name: 'CHRONOS_01', rounds: '11 / 12', time: '02:35', score: 11800, status: 'K.O. SIEG' },
            { name: 'PHANTOM_BOX', rounds: '9 / 12', time: '02:05', score: 8900, status: 'K.O. NIEDERLAGE' },
            { name: 'ROOKIE_STRIKE', rounds: '6 / 12', time: '01:28', score: 5400, status: 'K.O. NIEDERLAGE' }
        ];

        const saved = localStorage.getItem('aion_boxing_hof');
        if (!saved) {
            localStorage.setItem('aion_boxing_hof', JSON.stringify(defaultScores));
            return defaultScores;
        }
        try {
            return JSON.parse(saved);
        } catch(e) {
            return defaultScores;
        }
    }

    submitScore() {
        const name = (this.nameInput.value || '').trim() || 'CHAMPION';
        const scores = this.getHallOfFameData();

        const newEntry = {
            name: name.toUpperCase().slice(0, 12),
            rounds: this.currentMatchResult ? this.currentMatchResult.rounds : `${this.round} / 12`,
            time: this.currentMatchResult ? this.currentMatchResult.time : '03:00',
            score: this.score,
            status: this.currentMatchResult ? this.currentMatchResult.status : 'BEENDET'
        };

        scores.push(newEntry);
        scores.sort((a, b) => b.score - a.score);
        const top15 = scores.slice(0, 15);
        localStorage.setItem('aion_boxing_hof', JSON.stringify(top15));

        this.scoreInputWrap.classList.add('hidden');
        window.AionApp?.showToast(`🏆 Score von ${newEntry.name} gespeichert!`);
        this.renderHallOfFameTable();
        this.openHallOfFame();
    }

    renderHallOfFameTable() {
        const scores = this.getHallOfFameData();
        this.hofTableBody.innerHTML = '';

        scores.forEach((item, index) => {
            const tr = document.createElement('tr');
            const medal = index === 0 ? '🥇 ' : (index === 1 ? '🥈 ' : (index === 2 ? '🥉 ' : ''));
            const statusColor = item.status.includes('SIEG') ? '#00ffcc' : '#ff0055';

            tr.innerHTML = `
                <td><strong>${medal}${index + 1}</strong></td>
                <td style="color: #ffd166; font-weight: bold;">${item.name}</td>
                <td>${item.rounds}</td>
                <td>${item.time}</td>
                <td style="color: #00ffcc; font-weight: bold;">${item.score.toLocaleString()}</td>
                <td style="color: ${statusColor}; font-size: 10px;">${item.status}</td>
            `;
            this.hofTableBody.appendChild(tr);
        });
    }

    openHallOfFame() {
        this.renderHallOfFameTable();
        this.hofModal.classList.remove('hidden');
    }

    closeHallOfFame() {
        this.hofModal.classList.add('hidden');
    }

    clearHallOfFame() {
        if (confirm('Bestenliste wirklich auf Werkseinstellung zurücksetzen?')) {
            localStorage.removeItem('aion_boxing_hof');
            this.renderHallOfFameTable();
            window.AionApp?.showToast('Bestenliste zurückgesetzt.');
        }
    }

    // ================= SOUND & SFX =================
    playBellSound() {
        if (!window.AionApp?.audioAllowed) return;
        const actx = window.AionApp.getAudioContext();
        if (!actx) return;
        [880, 880, 1174].forEach((freq, idx) => {
            setTimeout(() => {
                const osc = actx.createOscillator();
                const gain = actx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, actx.currentTime);
                gain.gain.setValueAtTime(0.2, actx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.8);
                osc.connect(gain);
                gain.connect(actx.destination);
                osc.start();
                osc.stop(actx.currentTime + 0.85);
            }, idx * 220);
        });
    }

    playTone(freq, duration = 0.1, type = 'sine') {
        if (!window.AionApp?.audioAllowed) return;
        try {
            const actx = window.AionApp.getAudioContext();
            if (!actx) return;
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, actx.currentTime);
            gain.gain.setValueAtTime(0.12, actx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
            osc.connect(gain);
            gain.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + duration);
        } catch(e) {}
    }

    // ================= 60 FPS CANVAS RENDERING =================
    render() {
        requestAnimationFrame(this.render.bind(this));
        if (!document.getElementById('tab-boxing')?.classList.contains('active')) {
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;

        this.ctx.clearRect(0, 0, w, h);

        // Dark Canvas BG
        this.ctx.fillStyle = '#060810';
        this.ctx.fillRect(0, 0, w, h);

        // 3D Perspective Ring Floor Grid (Batched draw call)
        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.22)';
        this.ctx.lineWidth = 1;
        const floorY = h * 0.58;
        this.ctx.beginPath();
        for (let x = -w * 0.4; x <= w * 1.4; x += 45) {
            this.ctx.moveTo(x, h);
            this.ctx.lineTo(cx + (x - cx) * 0.35, floorY);
        }
        for (let y = floorY; y <= h; y += 22) {
            const progress = (y - floorY) / (h - floorY);
            const span = w * (0.35 + progress * 0.65);
            this.ctx.moveTo(cx - span / 2, y);
            this.ctx.lineTo(cx + span / 2, y);
        }
        this.ctx.stroke();

        // Ring Ropes (Neon Cyan & Magenta)
        const ropeHeights = [floorY - 120, floorY - 80, floorY - 40];
        ropeHeights.forEach((ry, idx) => {
            this.ctx.beginPath();
            this.ctx.strokeStyle = idx % 2 === 0 ? 'rgba(0, 255, 204, 0.8)' : 'rgba(255, 0, 255, 0.8)';
            this.ctx.lineWidth = 2.5;
            this.ctx.moveTo(20, ry + 30);
            this.ctx.lineTo(cx, ry);
            this.ctx.lineTo(w - 20, ry + 30);
            this.ctx.stroke();
        });

        // Aion Wireframe Hologram Fighter Silhouette
        this.renderAionHologram(cx, floorY - 70);

        // Render Player Gloves & Posture in Foreground
        this.renderPlayerGloves(cx, h);

        // Draw Floating Texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.y -= 1.2;
            ft.life -= ft.fadeSpeed;
            if (ft.life <= 0) {
                this.floatingTexts.splice(i, 1);
                continue;
            }
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, ft.life);
            this.ctx.font = 'bold 20px Orbitron, sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            this.ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
            this.ctx.fillStyle = ft.color;
            this.ctx.fillText(ft.text, ft.x, ft.y);
            this.ctx.restore();
        }

        // Draw Hit Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.035;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, p.life);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(p.x, p.y, p.size, p.size);
            this.ctx.restore();
        }
    }

    renderAionHologram(x, y) {
        const time = performance.now() * 0.003;
        const bobY = Math.sin(time * 3) * 6;

        this.ctx.save();
        this.ctx.translate(x, y + bobY);

        let glowColor = '#ff00ff';
        let haloColor = 'rgba(255, 0, 255, 0.25)';
        if (this.aionState === 'charging') {
            glowColor = '#ff0044';
            haloColor = 'rgba(255, 0, 68, 0.35)';
        } else if (this.aionState === 'stunned') {
            glowColor = '#ffd166';
            haloColor = 'rgba(255, 209, 102, 0.35)';
        }

        // Halo Pass
        this.ctx.lineWidth = 4;
        this.ctx.strokeStyle = haloColor;
        this.ctx.beginPath();
        this.ctx.arc(0, -60, 26, 0, Math.PI * 2);
        this.ctx.moveTo(0, -34);
        this.ctx.lineTo(0, 45);
        this.ctx.lineTo(-30, -10);
        this.ctx.lineTo(0, -34);
        this.ctx.lineTo(30, -10);
        this.ctx.lineTo(0, 45);
        this.ctx.stroke();

        // Sharp Core Pass
        this.ctx.lineWidth = 1.8;
        this.ctx.strokeStyle = glowColor;
        this.ctx.beginPath();
        this.ctx.arc(0, -60, 26, 0, Math.PI * 2);
        this.ctx.moveTo(0, -34);
        this.ctx.lineTo(0, 45);
        this.ctx.lineTo(-30, -10);
        this.ctx.lineTo(0, -34);
        this.ctx.lineTo(30, -10);
        this.ctx.lineTo(0, 45);
        this.ctx.stroke();

        // Visor line
        this.ctx.beginPath();
        this.ctx.moveTo(-16, -60);
        this.ctx.lineTo(16, -60);
        this.ctx.lineWidth = 3.5;
        this.ctx.strokeStyle = this.aionState === 'stunned' ? '#ffd166' : '#00ffcc';
        this.ctx.stroke();

        // Aion Gloves
        const gLeftX = -45 + Math.sin(time * 5) * 8;
        const gRightX = 45 - Math.sin(time * 5) * 8;
        const gY = -15 + Math.cos(time * 4) * 6;

        this.ctx.beginPath();
        this.ctx.arc(gLeftX, gY, 16, 0, Math.PI * 2);
        this.ctx.fillStyle = this.aionState === 'charging' ? 'rgba(255, 0, 68, 0.85)' : 'rgba(255, 0, 85, 0.5)';
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(gRightX, gY, 16, 0, Math.PI * 2);
        this.ctx.fillStyle = this.aionState === 'charging' ? 'rgba(255, 0, 68, 0.85)' : 'rgba(255, 0, 85, 0.5)';
        this.ctx.fill();
        this.ctx.stroke();

        // Stars over head if stunned
        if (this.aionState === 'stunned') {
            const starAngle = time * 8;
            for (let i = 0; i < 3; i++) {
                const sa = starAngle + (i * Math.PI * 2 / 3);
                const sx = Math.cos(sa) * 35;
                const sy = -95 + Math.sin(sa) * 12;
                this.ctx.fillStyle = '#ffd166';
                this.ctx.fillRect(sx - 3, sy - 3, 6, 6);
            }
        }

        this.ctx.restore();
    }

    renderPlayerGloves(cx, h) {
        this.ctx.save();
        const px = cx + this.playerXOffset;
        const py = h - 65;

        let leftGloveX = px - 70;
        let rightGloveX = px + 70;
        let leftGloveY = py;
        let rightGloveY = py;

        if (this.playerState === 'block') {
            leftGloveX = px - 25;
            rightGloveX = px + 25;
            leftGloveY = py - 40;
            rightGloveY = py - 40;

            // Cyan Energy Shield
            this.ctx.lineWidth = 6;
            this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.3)';
            this.ctx.beginPath();
            this.ctx.arc(px, py - 40, 55, Math.PI * 0.8, Math.PI * 2.2);
            this.ctx.stroke();

            this.ctx.lineWidth = 2.5;
            this.ctx.strokeStyle = '#00ffcc';
            this.ctx.stroke();
        } else if (this.playerState === 'punch') {
            rightGloveX = px + 15;
            rightGloveY = py - 95; // Extended punch animation
        }

        // Draw Player Cyan Boxing Gloves
        [{ x: leftGloveX, y: leftGloveY }, { x: rightGloveX, y: rightGloveY }].forEach(g => {
            // Glow Halo
            this.ctx.beginPath();
            this.ctx.arc(g.x, g.y, 28, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(0, 255, 204, 0.22)';
            this.ctx.fill();

            // Core Glove
            this.ctx.beginPath();
            this.ctx.arc(g.x, g.y, 22, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(0, 255, 204, 0.9)';
            this.ctx.fill();
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Highlight dot
            this.ctx.beginPath();
            this.ctx.arc(g.x - 6, g.y - 6, 6, 0, Math.PI * 2);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.fill();
        });

        this.ctx.restore();
    }

    initControls() {
        this.startBtn?.addEventListener('click', () => this.start());
        this.sideRestartBtn?.addEventListener('click', () => this.start());

        const handleAction = (actionFn) => {
            const now = Date.now();
            if (now - this.lastActionTime < 140) return;
            this.lastActionTime = now;
            actionFn();
        };

        window.addEventListener('keydown', (e) => {
            if (document.getElementById('tab-boxing')?.classList.contains('active')) {
                // If Hall of Fame name input is active, don't trigger boxing keys
                if (document.activeElement === this.nameInput) return;

                if (e.repeat) return; // Prevent continuous input if key is held down!
                const key = e.key.toLowerCase();
                const code = e.code;

                if (key === 'q' || code === 'ArrowLeft') {
                    e.preventDefault();
                    handleAction(() => this.playerDodgeLeft());
                } else if (key === 'w' || code === 'ArrowUp') {
                    e.preventDefault();
                    handleAction(() => this.playerHighBlock());
                } else if (key === 'e' || code === 'ArrowRight') {
                    e.preventDefault();
                    handleAction(() => this.playerDodgeRight());
                } else if (key === ' ' || key === 'f' || key === 'enter') {
                    e.preventDefault();
                    handleAction(() => this.playerPunch());
                }
            }
        });

        // Touch & On-Screen Buttons
        document.getElementById('btn-box-dodge-l')?.addEventListener('click', () => handleAction(() => this.playerDodgeLeft()));
        document.getElementById('btn-box-block')?.addEventListener('click', () => handleAction(() => this.playerHighBlock()));
        document.getElementById('btn-box-dodge-r')?.addEventListener('click', () => handleAction(() => this.playerDodgeRight()));
        document.getElementById('btn-box-counter')?.addEventListener('click', () => handleAction(() => this.playerPunch()));
    }
}
