/**
 * AION QUANTUM TETRIS ENGINE
 * Full SRS (Super Rotation System), Ghost Piece, Hold Queue,
 * Particle Physics, Combos, Levels, Highscore & WebAudio SFX.
 */

class QuantumTetris {
    constructor() {
        this.canvas = document.getElementById('tetris-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.holdCanvas = document.getElementById('tetris-hold-canvas');
        this.holdCtx = this.holdCanvas.getContext('2d');
        this.nextCanvas = document.getElementById('tetris-next-canvas');
        this.nextCtx = this.nextCanvas.getContext('2d');

        this.scoreEl = document.getElementById('tetris-score');
        this.linesEl = document.getElementById('tetris-lines');
        this.levelEl = document.getElementById('tetris-level');
        this.speedEl = document.getElementById('tetris-speed');
        this.highEl = document.getElementById('tetris-highscore');
        this.overlay = document.getElementById('tetris-overlay');
        this.overlayTitle = document.getElementById('tetris-overlay-title');
        this.overlayMsg = document.getElementById('tetris-overlay-msg');
        this.startBtn = document.getElementById('btn-tetris-start');

        this.mainStartBtn = document.getElementById('btn-tetris-main-start');
        this.mainPauseBtn = document.getElementById('btn-tetris-main-pause');

        // Dimensions: 10 columns x 20 rows compact (180 x 360 px, -30% block size)
        this.cols = 10;
        this.rows = 20;
        this.gridSize = 18;

        // Colors per Tetromino
        this.colors = {
            I: '#00f0ff', // Cyan
            J: '#0033ff', // Deep Blue
            L: '#ff8800', // Orange
            O: '#ffff00', // Yellow
            S: '#00ff66', // Green
            T: '#aa00ff', // Purple / Magenta
            Z: '#ff0044'  // Neon Red
        };

        this.glows = {
            I: 'rgba(0, 240, 255, 0.7)',
            J: 'rgba(0, 51, 255, 0.7)',
            L: 'rgba(255, 136, 0, 0.7)',
            O: 'rgba(255, 255, 0, 0.7)',
            S: 'rgba(0, 255, 102, 0.7)',
            T: 'rgba(170, 0, 255, 0.7)',
            Z: 'rgba(255, 0, 68, 0.7)'
        };

        // 7 standard pieces
        this.shapes = {
            I: [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
            J: [[1,0,0], [1,1,1], [0,0,0]],
            L: [[0,0,1], [1,1,1], [0,0,0]],
            O: [[1,1], [1,1]],
            S: [[0,1,1], [1,1,0], [0,0,0]],
            T: [[0,1,0], [1,1,1], [0,0,0]],
            Z: [[1,1,0], [0,1,1], [0,0,0]]
        };

        this.bag = [];
        this.board = [];
        this.currentPiece = null;
        this.nextPieces = [];
        this.holdPieceType = null;
        this.canHold = true;

        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.combo = -1;
        this.highscore = parseInt(localStorage.getItem('aion_tetris_highscore') || '0', 10);
        this.highEl.textContent = this.highscore.toLocaleString();

        this.particles = [];
        this.lineClearAnimations = [];

        this.lastTime = 0;
        this.dropCounter = 0;
        this.dropInterval = 850;
        this.isRunning = false;
        this.isPaused = false;

        this.initBoard();
        this.initControls();
        this.render();
    }

    initBoard() {
        this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    getBag() {
        if (this.bag.length === 0) {
            const types = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
            // Fisher-Yates shuffle
            for (let i = types.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [types[i], types[j]] = [types[j], types[i]];
            }
            this.bag = types;
        }
        return this.bag.pop();
    }

    spawnPiece() {
        while (this.nextPieces.length < 4) {
            this.nextPieces.push(this.getBag());
        }
        const type = this.nextPieces.shift();
        const matrix = this.shapes[type].map(row => [...row]);
        this.currentPiece = {
            type: type,
            matrix: matrix,
            x: Math.floor((this.cols - matrix[0].length) / 2),
            y: type === 'I' ? -1 : 0
        };

        this.canHold = true;

        // Collision check on spawn -> Game Over
        if (this.checkCollision(this.currentPiece.x, this.currentPiece.y, this.currentPiece.matrix)) {
            this.gameOver();
        }
        this.drawNext();
    }

    checkCollision(offsetX, offsetY, matrix) {
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x] !== 0) {
                    const bx = offsetX + x;
                    const by = offsetY + y;
                    if (bx < 0 || bx >= this.cols || by >= this.rows) return true;
                    if (by >= 0 && this.board[by][bx] !== 0) return true;
                }
            }
        }
        return false;
    }

    rotateMatrix(matrix, dir = 1) {
        const N = matrix.length;
        const result = matrix.map((row, i) =>
            row.map((val, j) => matrix[j][i])
        );
        if (dir > 0) {
            return result.map(row => row.reverse());
        } else {
            return result.reverse();
        }
    }

    rotate(dir = 1) {
        if (!this.currentPiece || !this.isRunning || this.isPaused) return;
        const oldMatrix = this.currentPiece.matrix;
        const newMatrix = this.rotateMatrix(oldMatrix, dir);
        
        const kicks = [0, -1, 1, -2, 2];
        for (let k of kicks) {
            if (!this.checkCollision(this.currentPiece.x + k, this.currentPiece.y, newMatrix)) {
                this.currentPiece.x += k;
                this.currentPiece.matrix = newMatrix;
                this.playTone(480, 0.05, 'triangle');
                return;
            }
        }
    }

    move(dir) {
        if (!this.currentPiece || !this.isRunning || this.isPaused) return;
        if (!this.checkCollision(this.currentPiece.x + dir, this.currentPiece.y, this.currentPiece.matrix)) {
            this.currentPiece.x += dir;
            this.playTone(260, 0.03, 'sine');
        }
    }

    softDrop() {
        if (!this.currentPiece || !this.isRunning || this.isPaused) return;
        if (!this.checkCollision(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
            this.currentPiece.y += 1;
            this.score += 1;
            this.scoreEl.textContent = this.score.toLocaleString();
            this.dropCounter = 0;
        } else {
            this.lockPiece();
        }
    }

    hardDrop() {
        if (!this.currentPiece || !this.isRunning || this.isPaused) return;
        let dropped = 0;
        while (!this.checkCollision(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
            this.currentPiece.y += 1;
            dropped++;
        }
        this.score += dropped * 2;
        this.scoreEl.textContent = this.score.toLocaleString();
        this.playTone(180, 0.08, 'sawtooth');
        this.createDropParticles();
        this.lockPiece();
    }

    hold() {
        if (!this.canHold || !this.currentPiece || !this.isRunning || this.isPaused) return;
        const currentType = this.currentPiece.type;
        if (!this.holdPieceType) {
            this.holdPieceType = currentType;
            this.spawnPiece();
        } else {
            const temp = this.holdPieceType;
            this.holdPieceType = currentType;
            const matrix = this.shapes[temp].map(row => [...row]);
            this.currentPiece = {
                type: temp,
                matrix: matrix,
                x: Math.floor((this.cols - matrix[0].length) / 2),
                y: temp === 'I' ? -1 : 0
            };
        }
        this.canHold = false;
        this.playTone(360, 0.06, 'sine');
        this.drawHold();
    }

    lockPiece() {
        const { x: px, y: py, matrix, type } = this.currentPiece;
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x] !== 0) {
                    const bx = px + x;
                    const by = py + y;
                    if (by >= 0 && by < this.rows && bx >= 0 && bx < this.cols) {
                        this.board[by][bx] = type;
                    }
                }
            }
        }

        this.checkLines();
        this.spawnPiece();
    }

    checkLines() {
        const fullRows = [];
        for (let r = this.rows - 1; r >= 0; r--) {
            if (this.board[r].every(val => val !== 0)) {
                fullRows.push(r);
            }
        }

        if (fullRows.length > 0) {
            this.combo++;
            const count = fullRows.length;
            const basePoints = [0, 100, 300, 500, 800];
            const earned = (basePoints[count] || 800) * this.level + (this.combo > 0 ? this.combo * 50 * this.level : 0);
            this.score += earned;
            this.lines += count;
            this.level = Math.floor(this.lines / 6) + 1;
            this.dropInterval = Math.max(65, Math.floor(850 * Math.pow(0.80, this.level - 1)));

            this.scoreEl.textContent = this.score.toLocaleString();
            this.linesEl.textContent = this.lines.toString();
            this.levelEl.textContent = this.level.toString();
            if (this.speedEl) {
                this.speedEl.textContent = (850 / this.dropInterval).toFixed(1) + 'x';
            }

            if (this.score > this.highscore) {
                this.highscore = this.score;
                this.highEl.textContent = this.highscore.toLocaleString();
                localStorage.setItem('aion_tetris_highscore', this.highscore.toString());
            }

            fullRows.forEach(r => {
                for (let c = 0; c < this.cols; c++) {
                    const col = this.colors[this.board[r][c]] || '#00ffcc';
                    for (let p = 0; p < 3; p++) {
                        this.particles.push({
                            x: c * this.gridSize + this.gridSize / 2,
                            y: r * this.gridSize + this.gridSize / 2,
                            vx: (Math.random() - 0.5) * 8,
                            vy: (Math.random() - 0.5) * 8 - 2,
                            color: col,
                            life: 1.0,
                            size: Math.random() * 4 + 2
                        });
                    }
                }
            });

            for (let r of fullRows) {
                this.board.splice(r, 1);
                this.board.unshift(Array(this.cols).fill(0));
            }

            if (count === 4) {
                this.playTetrisClearSound();
                window.AionApp?.showToast('⚡ TETRIS! +800 BONUS');
            } else {
                this.playTone(550 + count * 80, 0.15, 'square');
            }
        } else {
            this.combo = -1;
        }
    }

    createDropParticles() {
        if (!this.currentPiece) return;
        const { x: px, y: py, matrix, type } = this.currentPiece;
        const col = this.colors[type] || '#00ffcc';
        for (let x = 0; x < matrix[0].length; x++) {
            this.particles.push({
                x: (px + x) * this.gridSize + this.gridSize / 2,
                y: (py + matrix.length) * this.gridSize,
                vx: (Math.random() - 0.5) * 4,
                vy: -Math.random() * 3,
                color: col,
                life: 0.7,
                size: 3
            });
        }
    }

    getGhostY() {
        if (!this.currentPiece) return 0;
        let gy = this.currentPiece.y;
        while (!this.checkCollision(this.currentPiece.x, gy + 1, this.currentPiece.matrix)) {
            gy++;
        }
        return gy;
    }

    start() {
        this.initBoard();
        this.score = 0;
        this.lines = 0;
        this.level = 1;
        this.combo = -1;
        this.dropInterval = 850;
        this.scoreEl.textContent = '0';
        this.linesEl.textContent = '0';
        this.levelEl.textContent = '1';
        if (this.speedEl) this.speedEl.textContent = '1.0x';
        this.nextPieces = [];
        this.holdPieceType = null;
        this.drawHold();
        this.spawnPiece();
        this.isRunning = true;
        this.isPaused = false;
        this.overlay.classList.add('hidden');
        this.mainStartBtn.textContent = '🔄 NEUSTART';
        this.mainPauseBtn.textContent = '⏸ PAUSE';
        this.playTone(600, 0.1, 'sine');
        window.AionApp?.showToast('🕹️ Quantum Tetris Started! [A/D] Move, [W] Rotate');
    }

    pause() {
        if (!this.isRunning) {
            this.start();
            return;
        }
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            this.overlayTitle.textContent = 'PAUSIERT';
            this.overlayMsg.textContent = 'Drücke LEERTASTE, P oder Fortsetzen';
            this.startBtn.textContent = '▶ WEITERSPIELEN';
            this.mainPauseBtn.textContent = '▶ WEITER';
            this.overlay.classList.remove('hidden');
        } else {
            this.overlay.classList.add('hidden');
            this.mainPauseBtn.textContent = '⏸ PAUSE';
        }
    }

    gameOver() {
        this.isRunning = false;
        this.overlayTitle.textContent = 'GAME OVER';
        this.overlayMsg.textContent = `Erreichte Punktzahl: ${this.score.toLocaleString()}`;
        this.startBtn.textContent = '▶ NOCHMAL SPIELEN';
        this.mainStartBtn.textContent = '▶ START SPIEL';
        this.overlay.classList.remove('hidden');
        this.playTone(120, 0.4, 'sawtooth');
    }

    update(time = 0) {
        requestAnimationFrame(this.update.bind(this));
        if (!document.getElementById('tab-tetris')?.classList.contains('active')) {
            return;
        }

        const delta = time - this.lastTime;
        this.lastTime = time;

        if (this.isRunning && !this.isPaused) {
            this.dropCounter += delta;
            if (this.dropCounter > this.dropInterval) {
                this.softDrop();
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15;
            p.life -= 0.025;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        this.render();
    }

    render() {
        if (!document.getElementById('tab-tetris')?.classList.contains('active')) {
            return;
        }
        this.ctx.fillStyle = '#06080e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.strokeStyle = 'rgba(0, 255, 204, 0.05)';
        this.ctx.lineWidth = 1;
        for (let c = 0; c <= this.cols; c++) {
            this.ctx.beginPath();
            this.ctx.moveTo(c * this.gridSize, 0);
            this.ctx.lineTo(c * this.gridSize, this.canvas.height);
            this.ctx.stroke();
        }
        for (let r = 0; r <= this.rows; r++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, r * this.gridSize);
            this.ctx.lineTo(this.canvas.width, r * this.gridSize);
            this.ctx.stroke();
        }

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cell = this.board[r][c];
                if (cell !== 0) {
                    this.drawBlock(this.ctx, c * this.gridSize, r * this.gridSize, cell);
                }
            }
        }

        if (this.currentPiece && this.isRunning && !this.isPaused) {
            const ghostY = this.getGhostY();
            const { x: px, matrix, type } = this.currentPiece;
            for (let y = 0; y < matrix.length; y++) {
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x] !== 0) {
                        const bx = (px + x) * this.gridSize;
                        const by = (ghostY + y) * this.gridSize;
                        this.drawGhostBlock(this.ctx, bx, by, type);
                    }
                }
            }

            const { y: py } = this.currentPiece;
            for (let y = 0; y < matrix.length; y++) {
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x] !== 0) {
                        const bx = (px + x) * this.gridSize;
                        const by = (py + y) * this.gridSize;
                        this.drawBlock(this.ctx, bx, by, type);
                    }
                }
            }
        }

        for (const p of this.particles) {
            this.ctx.globalAlpha = Math.max(0, p.life);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(p.x, p.y, p.size, p.size);
        }
        this.ctx.globalAlpha = 1.0;
    }

    drawBlock(ctx, x, y, type) {
        const col = this.colors[type] || '#00ffcc';
        const sz = this.gridSize;

        ctx.fillStyle = col;
        ctx.fillRect(x + 1, y + 1, sz - 2, sz - 2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x + 2, y + 2, sz - 4, 3);
        ctx.fillRect(x + 2, y + 2, 3, sz - 4);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x + 2, y + sz - 5, sz - 4, 3);
        ctx.fillRect(x + sz - 5, y + 2, 3, sz - 4);
    }

    drawGhostBlock(ctx, x, y, type) {
        const col = this.colors[type] || '#00ffcc';
        const sz = this.gridSize;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(0, 255, 204, 0.08)';
        ctx.fillRect(x + 2, y + 2, sz - 4, sz - 4);
        ctx.strokeRect(x + 2, y + 2, sz - 4, sz - 4);
        ctx.restore();
    }

    drawHold() {
        this.holdCtx.clearRect(0, 0, this.holdCanvas.width, this.holdCanvas.height);
        if (!this.holdPieceType) return;
        const matrix = this.shapes[this.holdPieceType];
        const bs = 13;
        const ox = (this.holdCanvas.width - matrix[0].length * bs) / 2;
        const oy = (this.holdCanvas.height - matrix.length * bs) / 2;
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x] !== 0) {
                    this.drawMiniBlock(this.holdCtx, ox + x * bs, oy + y * bs, bs, this.holdPieceType);
                }
            }
        }
    }

    drawNext() {
        this.nextCtx.clearRect(0, 0, this.nextCanvas.width, this.nextCanvas.height);
        const bs = 12;
        let startY = 8;
        for (let i = 0; i < Math.min(3, this.nextPieces.length); i++) {
            const type = this.nextPieces[i];
            const matrix = this.shapes[type];
            const ox = (this.nextCanvas.width - matrix[0].length * bs) / 2;
            for (let y = 0; y < matrix.length; y++) {
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x] !== 0) {
                        this.drawMiniBlock(this.nextCtx, ox + x * bs, startY + y * bs, bs, type);
                    }
                }
            }
            startY += 46;
        }
    }

    drawMiniBlock(ctx, x, y, size, type) {
        const col = this.colors[type] || '#00ffcc';
        ctx.fillStyle = col;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(x + 1, y + 1, size - 2, 2);
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
            gain.gain.setValueAtTime(0.08, actx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
            osc.connect(gain);
            gain.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + duration);
        } catch (e) {}
    }

    playTetrisClearSound() {
        if (!window.AionApp?.audioAllowed) return;
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
            setTimeout(() => this.playTone(freq, 0.18, 'triangle'), idx * 60);
        });
    }

    initControls() {
        window.addEventListener('keydown', (e) => {
            if (document.getElementById('tab-tetris').classList.contains('active')) {
                // If not running, pressing Space or Enter starts the game!
                if (!this.isRunning) {
                    if (e.code === 'Space' || e.code === 'Enter') {
                        e.preventDefault();
                        this.start();
                        return;
                    }
                }

                switch(e.code) {
                    case 'ArrowLeft':
                    case 'KeyA':
                        e.preventDefault();
                        this.move(-1);
                        break;
                    case 'ArrowRight':
                    case 'KeyD':
                        e.preventDefault();
                        this.move(1);
                        break;
                    case 'ArrowDown':
                    case 'KeyS':
                        e.preventDefault();
                        this.softDrop();
                        break;
                    case 'ArrowUp':
                    case 'KeyW':
                    case 'KeyX':
                        e.preventDefault();
                        this.rotate(1);
                        break;
                    case 'KeyZ':
                        e.preventDefault();
                        this.rotate(-1);
                        break;
                    case 'Space':
                        e.preventDefault();
                        this.hardDrop();
                        break;
                    case 'KeyC':
                    case 'ShiftLeft':
                    case 'ShiftRight':
                        e.preventDefault();
                        this.hold();
                        break;
                    case 'KeyP':
                    case 'Escape':
                        e.preventDefault();
                        this.pause();
                        break;
                }
            }
        });

        // Overlay Start Button
        this.startBtn?.addEventListener('click', () => {
            if (!this.isRunning) this.start();
            else if (this.isPaused) this.pause();
        });

        // Dedicated Sidebar Buttons
        this.mainStartBtn?.addEventListener('click', () => this.start());
        this.mainPauseBtn?.addEventListener('click', () => this.pause());

        // Touch button handlers
        document.getElementById('btn-t-hold')?.addEventListener('click', () => this.hold());
        document.getElementById('btn-t-left')?.addEventListener('click', () => this.move(-1));
        document.getElementById('btn-t-rotate')?.addEventListener('click', () => this.rotate(1));
        document.getElementById('btn-t-right')?.addEventListener('click', () => this.move(1));
        document.getElementById('btn-t-down')?.addEventListener('click', () => this.softDrop());
        document.getElementById('btn-t-drop')?.addEventListener('click', () => this.hardDrop());

        requestAnimationFrame(this.update.bind(this));
    }
}
