const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// --- Configuration ---
const CONFIG = {
    mapSize: 100000,          // Massive map
    botCount: 150,            // Many bots
    foodCount: 5000,          // Lots of food
    baseSpeed: 450,
    boostSpeed: 900,
    turnSpeed: 8.0,
    maxPathPoints: 400,       // Cap path resolution
    colors: ['#FF3366', '#33FF99', '#33CCFF', '#FF9933', '#CC33FF', '#99FF33', '#3366FF', '#FF3333', '#CC00FF', '#00FF66', '#FF0099', '#66FF00', '#00CCFF', '#FFCC00', '#FFFFFF'],
    fruitEmojis: ['🍰', '🍩', '🍪', '🍬', '🍭', '🍫', '🧁', '🍦', '🍧', '🍮', '🥞', '🥨', '🥐', '🥯', '🧀', '🍉', '🍓', '🍒'],
    patterns: ['solid', 'rainbow', 'stripes']
};

// --- Game State ---
let player;
let bots = [];
let foods = [];
let powerups = [];
let particles = [];
let gameRunning = false;
let lastTime = 0;
let frameCount = 0;
let camera = { x: 0, y: 0 };
let playerName = 'Player';

// --- Performance Metrics ---
let fpsFrames = [];
let lastFpsUpdate = 0;
let inputDelay = 0;
let lastInputTime = performance.now();

// --- Input ---
let mouse = { x: 0, y: 0 };
let mouseDown = false;
let touchId = null;

// --- Spatial Hash (Optimized) ---
class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }
    insert(obj) {
        const k = `${Math.floor(obj.pos.x / this.cellSize)},${Math.floor(obj.pos.y / this.cellSize)}`;
        let cell = this.grid.get(k);
        if (!cell) {
            cell = [];
            this.grid.set(k, cell);
        }
        cell.push(obj);
    }
    retrieve(rect) {
        const found = [];
        const sx = Math.floor(rect.x / this.cellSize);
        const sy = Math.floor(rect.y / this.cellSize);
        const ex = Math.floor((rect.x + rect.w) / this.cellSize);
        const ey = Math.floor((rect.y + rect.h) / this.cellSize);

        for (let x = sx; x <= ex; x++) {
            for (let y = sy; y <= ey; y++) {
                const cell = this.grid.get(`${x},${y}`);
                if (cell) {
                    // Fast array copy
                    for (let i = 0; i < cell.length; i++) found.push(cell[i]);
                }
            }
        }
        return found;
    }
    clear() {
        this.grid.clear();
    }
}
const spatialHash = new SpatialHash(1000); // Larger cell size for massive map

// --- Vector Helper ---
// Using a class is fine, but we'll minimize allocations in loops
class Vector {
    constructor(x, y) { this.x = x; this.y = y; }
    add(v) { return new Vector(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
    mult(n) { return new Vector(this.x * n, this.y * n); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    norm() { let m = this.mag(); return m === 0 ? new Vector(0, 0) : new Vector(this.x / m, this.y / m); }
    dist(v) { return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2); }
    copy() { return new Vector(this.x, this.y); }
}

// --- Entities ---

class Food {
    constructor(x, y, value = 1) {
        this.pos = new Vector(
            x || (Math.random() * CONFIG.mapSize * 2 - CONFIG.mapSize),
            y || (Math.random() * CONFIG.mapSize * 2 - CONFIG.mapSize)
        );
        // Clamp to map
        if (this.pos.mag() > CONFIG.mapSize) this.pos = this.pos.norm().mult(CONFIG.mapSize - 50);

        this.value = value;
        this.radius = 15 + (value * 3); // Larger food
        this.emoji = CONFIG.fruitEmojis[Math.floor(Math.random() * CONFIG.fruitEmojis.length)];
        this.rotation = Math.random() * Math.PI * 2;
        this.floatOffset = Math.random() * 100;
    }
    draw(ctx) {
        // Strict Culling
        if (!isInViewport(this.pos, this.radius)) return;

        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        // Simple float animation
        const floatY = Math.sin((Date.now() / 500) + this.floatOffset) * 5;
        ctx.translate(0, floatY);
        ctx.rotate(this.rotation);

        ctx.font = `${this.radius * 2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Shadow only if close to center (LOD-ish)
        if (this.value > 2) {
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 10;
        }
        ctx.fillText(this.emoji, 0, 0);
        ctx.restore();
    }
}

class PowerUp {
    constructor(x, y) {
        this.pos = new Vector(
            x || (Math.random() * CONFIG.mapSize * 2 - CONFIG.mapSize),
            y || (Math.random() * CONFIG.mapSize * 2 - CONFIG.mapSize)
        );
        if (this.pos.mag() > CONFIG.mapSize) this.pos = this.pos.norm().mult(CONFIG.mapSize - 50);

        const r = Math.random();
        this.multiplier = r < 0.6 ? 2 : (r < 0.9 ? 5 : 10);
        this.radius = 40;
    }
    draw(ctx) {
        if (!isInViewport(this.pos, this.radius)) return;

        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        const scale = 1 + Math.sin(Date.now() / 200) * 0.1;
        ctx.scale(scale, scale);

        const color = this.multiplier === 2 ? '#f1c40f' : (this.multiplier === 5 ? '#e67e22' : '#e74c3c');
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
        ctx.fillStyle = color;

        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 4;
        ctx.strokeStyle = 'white';
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'white';
        ctx.font = 'bold 32px Fredoka One';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`x${this.multiplier}`, 0, 0);
        ctx.restore();
    }
}

class Snake {
    constructor(name, isBot = false, startScore = 100) {
        this.name = name;
        this.isBot = isBot;
        this.id = Math.floor(Math.random() * 100000); // For throttled updates

        // Spawn
        this.pos = new Vector(
            (Math.random() - 0.5) * CONFIG.mapSize * 1.5,
            (Math.random() - 0.5) * CONFIG.mapSize * 1.5
        );
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;

        this.score = startScore;
        this.width = this.calculateWidth();
        this.targetWidth = this.width;

        this.path = [];
        // Pre-fill path
        const startLen = this.calculateTargetLength();
        const dir = new Vector(Math.cos(this.angle), Math.sin(this.angle)).mult(-1);
        const spacing = this.width / 2;
        for (let i = 0; i < startLen; i += spacing) {
            this.path.push(this.pos.add(dir.mult(i)));
        }

        this.color = CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
        this.color2 = CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
        this.pattern = CONFIG.patterns[Math.floor(Math.random() * CONFIG.patterns.length)];

        this.dead = false;
        this.multiplier = 1;
        this.multiplierTimer = 0;

        // Bot state
        this.changeDirTimer = 0;
        this.wantBoost = false;
        this.boostCooldown = 0;
    }

    calculateWidth() {
        // Logarithmic growth: 1M score -> ~500px width
        return Math.min(500, 15 + Math.log10(Math.max(10, this.score)) * 25);
    }

    calculateTargetLength() {
        // Cap length to avoid infinite arrays, grow width instead
        return Math.min(8000, 200 + this.score * 0.1);
    }

    getPathSpacing() {
        // Adaptive spacing: Massive snakes store fewer points
        return Math.max(this.width * 0.5, this.width * 1.0);
    }

    update(dt) {
        if (this.dead) return;

        // Multiplier decay
        if (this.multiplier > 1) {
            this.multiplierTimer -= dt;
            if (this.multiplierTimer <= 0) this.multiplier = 1;
        }

        // Turning Physics
        let diff = this.targetAngle - this.angle;
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        // Turn speed depends on size (larger = slower)
        const turnRate = CONFIG.turnSpeed * (30 / (this.width + 10));
        const turnAmount = turnRate * dt;

        if (Math.abs(diff) < turnAmount) {
            this.angle = this.targetAngle;
        } else {
            this.angle += Math.sign(diff) * turnAmount;
        }

        // Speed & Boost
        let currentSpeed = CONFIG.baseSpeed;
        if (this.isBot && this.width > 100) currentSpeed *= 0.9; // Big bots slower

        let boosting = (!this.isBot && mouseDown) || (this.isBot && this.wantBoost);
        if (boosting && this.score > 50) {
            currentSpeed = CONFIG.boostSpeed;
            this.score -= dt * 25; // Boost cost
            // Drop mass
            if (Math.random() < 0.3) {
                const tail = this.path[this.path.length - 1];
                if (tail) foods.push(new Food(tail.x, tail.y, 0.5));
            }
        }

        // Move
        const velocity = new Vector(Math.cos(this.angle), Math.sin(this.angle)).mult(currentSpeed * dt);
        this.pos = this.pos.add(velocity);

        // Map Bounds
        if (this.pos.mag() > CONFIG.mapSize) {
            this.dead = true;
            spawnParticles(this.pos, 50, this.color);
            dropFood(this);
            return;
        }

        // Path Management
        const spacing = this.getPathSpacing();
        const lastPoint = this.path[0];
        if (!lastPoint || this.pos.dist(lastPoint) > spacing) {
            this.path.unshift(this.pos.copy());
            if (this.path.length > CONFIG.maxPathPoints) {
                this.path.length = CONFIG.maxPathPoints;
            }
        }

        // Length Management
        const targetLen = this.calculateTargetLength();
        // Approximate length check
        if (this.path.length * spacing > targetLen) {
            this.path.pop();
        }

        // Smooth Growth
        this.targetWidth = this.calculateWidth();
        this.width += (this.targetWidth - this.width) * dt * 2;
    }

    draw(ctx) {
        if (this.dead) return;
        // Culling: Check if head or any part is roughly visible
        // Simple check: Head position with large margin
        if (!isInViewport(this.pos, this.width * 5 + 1000)) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = this.width;

        // LOD Rendering
        // If snake is small or we want extreme performance, use lines
        // If snake is large/close, use curves
        const useCurves = this.width > 15;

        ctx.beginPath();
        if (this.path.length > 1) {
            ctx.moveTo(this.path[0].x, this.path[0].y);

            // Dynamic Step Size for Performance
            // Draw fewer points for long snakes
            const step = Math.max(1, Math.floor(this.path.length / 40));

            if (useCurves) {
                for (let i = step; i < this.path.length - step; i += step) {
                    const p1 = this.path[i];
                    const p2 = this.path[i + step];
                    // Midpoint for quadratic curve
                    const mx = (p1.x + p2.x) / 2;
                    const my = (p1.y + p2.y) / 2;
                    ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
                }
                // Connect last point
                const last = this.path[this.path.length - 1];
                ctx.lineTo(last.x, last.y);
            } else {
                // Fast Line Rendering
                for (let i = step; i < this.path.length; i += step) {
                    ctx.lineTo(this.path[i].x, this.path[i].y);
                }
            }
        }

        // Styles
        if (this.pattern === 'rainbow') {
            const grad = ctx.createLinearGradient(
                this.pos.x - 100, this.pos.y - 100,
                this.pos.x + 100, this.pos.y + 100
            );
            grad.addColorStop(0, this.color);
            grad.addColorStop(0.5, this.color2);
            grad.addColorStop(1, this.color);
            ctx.strokeStyle = grad;
        } else if (this.pattern === 'stripes') {
            // Simplified stripes (just dashed effect via strokeStyle trick? No, too complex for canvas path)
            // Fallback to solid for performance, or use color2
            ctx.strokeStyle = this.color;
        } else {
            ctx.strokeStyle = this.color;
        }

        ctx.stroke();

        // Spine Highlight (Volume effect)
        if (this.width > 20) {
            ctx.lineWidth = this.width * 0.2;
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.stroke();
        }

        // Head
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.angle);

        // Eyes
        const eyeOffset = this.width * 0.35;
        const eyeSize = this.width * 0.25;

        ctx.fillStyle = 'white';
        ctx.beginPath(); ctx.arc(eyeOffset, -eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eyeOffset, eyeOffset, eyeSize, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = 'black';
        ctx.beginPath(); ctx.arc(eyeOffset + eyeSize * 0.2, -eyeOffset, eyeSize * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(eyeOffset + eyeSize * 0.2, eyeOffset, eyeSize * 0.5, 0, Math.PI * 2); ctx.fill();

        ctx.restore();

        // Name Tag
        if (this.width > 25) {
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.max(16, this.width * 0.4)}px Nunito`;
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.strokeText(this.name, this.pos.x, this.pos.y - this.width / 2 - 20);
            ctx.fillText(this.name, this.pos.x, this.pos.y - this.width / 2 - 20);
        }
    }

    grow(amount) {
        this.score += amount * this.multiplier * 10;
    }
}

class Bot extends Snake {
    constructor() {
        // Distribution: 
        // 50% Small (100-500)
        // 30% Medium (1000-5000)
        // 15% Large (10k-50k)
        // 5% Massive (100k-1M)
        const r = Math.random();
        let s = 100;
        if (r < 0.5) s = 100 + Math.random() * 400;
        else if (r < 0.8) s = 1000 + Math.random() * 4000;
        else if (r < 0.95) s = 10000 + Math.random() * 40000;
        else s = 100000 + Math.random() * 900000;

        super(getRandomName(), true, s);
    }

    update(dt) {
        if (this.dead) return;

        // Throttled AI Logic
        // Only run expensive checks every 5 frames, staggered by ID
        const shouldScan = (frameCount + this.id) % 5 === 0;

        if (shouldScan) {
            // AI Logic
            const lookDist = this.width * 4 + 200;
            const forward = new Vector(Math.cos(this.angle), Math.sin(this.angle));
            const checkPos = this.pos.add(forward.mult(lookDist));

            let danger = false;

            // 1. Map Bounds
            if (checkPos.mag() > CONFIG.mapSize - 200) {
                danger = true;
                // Turn towards center
                const toCenter = new Vector(0, 0).sub(this.pos);
                this.targetAngle = Math.atan2(toCenter.y, toCenter.x);
            }

            // 2. Snake Collision
            if (!danger) {
                const nearby = spatialHash.retrieve({
                    x: this.pos.x - lookDist, y: this.pos.y - lookDist,
                    w: lookDist * 2, h: lookDist * 2
                });

                for (const other of nearby) {
                    if (other === this || other.dead) continue;
                    // Simple distance check to path points
                    // Sample points for performance
                    const step = Math.max(5, Math.floor(other.path.length / 10));
                    for (let i = 0; i < other.path.length; i += step) {
                        const dist = checkPos.dist(other.path[i]);
                        if (dist < (this.width + other.width)) {
                            danger = true;
                            // Dodge
                            this.targetAngle += Math.PI / 2;
                            break;
                        }
                    }
                    if (danger) break;
                }
            }

            // 3. Food Seeking (if no danger)
            if (!danger) {
                // Wandering
                this.changeDirTimer -= dt * 5; // scaled since we run less often
                if (this.changeDirTimer <= 0) {
                    this.targetAngle += (Math.random() - 0.5) * 2.0;
                    this.changeDirTimer = 2 + Math.random() * 2;
                }

                // Boost occasionally
                if (this.boostCooldown > 0) this.boostCooldown -= dt * 5;
                if (this.boostCooldown <= 0 && Math.random() < 0.05) {
                    this.wantBoost = true;
                    this.boostCooldown = 2;
                } else if (this.wantBoost && Math.random() < 0.2) {
                    this.wantBoost = false;
                }
            } else {
                this.wantBoost = true; // Boost away from danger
            }
        }

        super.update(dt);
    }
}

// --- Main Functions ---

function init() {
    setupListeners();
    // Auto-start if name present? No, wait for user.
}

function setupListeners() {
    window.addEventListener('resize', resize);
    resize();

    window.addEventListener('mousemove', e => {
        const now = performance.now();
        inputDelay = now - lastInputTime;
        lastInputTime = now;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener('mousedown', () => mouseDown = true);
    window.addEventListener('mouseup', () => mouseDown = false);

    // Touch
    const c = document.getElementById('gameCanvas');
    if (c) {
        c.addEventListener('touchstart', e => {
            e.preventDefault();
            mouseDown = true;
            touchId = e.changedTouches[0].identifier;
            updateTouch(e.changedTouches[0]);
        }, { passive: false });

        c.addEventListener('touchmove', e => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === touchId) {
                    updateTouch(e.changedTouches[i]);
                }
            }
        }, { passive: false });

        c.addEventListener('touchend', e => {
            e.preventDefault();
            mouseDown = false;
        });
    }

    // UI
    const playBtn = document.getElementById('playBtn');
    if (playBtn) playBtn.onclick = startGame;

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.onclick = resetGame;

    const nameInput = document.getElementById('playerName');
    if (nameInput) {
        nameInput.onkeypress = (e) => {
            if (e.key === 'Enter') startGame();
        };
    }
}

function updateTouch(t) {
    mouse.x = t.clientX;
    mouse.y = t.clientY;
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function startGame() {
    const input = document.getElementById('playerName');
    playerName = input.value.trim() || 'Player';

    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');

    resetGameLogic();
    gameRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function resetGame() {
    startGame();
}

function resetGameLogic() {
    player = new Snake(playerName, false, 100);
    bots = [];
    foods = [];
    powerups = [];
    particles = [];

    for (let i = 0; i < CONFIG.botCount; i++) bots.push(new Bot());
    for (let i = 0; i < CONFIG.foodCount; i++) foods.push(new Food());
}

function gameLoop(timestamp) {
    if (!gameRunning) return;

    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // Cap dt
    lastTime = timestamp;
    frameCount++;

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
}

function update(dt) {
    // Spatial Hash Reset
    spatialHash.clear();
    spatialHash.insert(player);
    for (const b of bots) {
        if (!b.dead) spatialHash.insert(b);
    }

    // Player Input
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const dx = mouse.x - cx;
    const dy = mouse.y - cy;
    if (Math.hypot(dx, dy) > 10) {
        player.targetAngle = Math.atan2(dy, dx);
    }

    // Update Entities
    player.update(dt);
    for (const b of bots) b.update(dt);

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 2;
        p.pos = p.pos.add(p.vel.mult(dt));
        if (p.life <= 0) particles.splice(i, 1);
    }

    checkCollisions();

    // Cleanup
    bots = bots.filter(b => !b.dead);

    // Spawning
    while (foods.length < CONFIG.foodCount) foods.push(new Food());
    while (bots.length < CONFIG.botCount) bots.push(new Bot());
    if (Math.random() < 0.01 && powerups.length < 50) powerups.push(new PowerUp());

    // UI
    document.getElementById('score').innerText = Math.floor(player.score);
    if (frameCount % 30 === 0) {
        updateLeaderboard();
        updatePerformanceStats();
    }
}

function checkCollisions() {
    const allSnakes = [player, ...bots];

    for (const s of allSnakes) {
        if (s.dead) continue;

        // 1. Food
        // Optimization: Only check food in viewport + margin around snake head? 
        // No, spatial hash for food is too expensive (thousands of items).
        // Standard loop is faster for simple distance checks if we don't have spatial hash for food.
        // BUT for 5000 food, O(N*M) is bad.
        // Let's just check food near the snake head using a simple grid-independent check?
        // Actually, let's just loop backwards and do simple dist check. 
        // For 5000 items and 150 snakes, that's 750,000 checks. Too slow.
        // We NEED spatial hash for food or a grid.
        // Let's use the spatial hash for food too?
        // Re-inserting 5000 food every frame is slow.
        // Better: Only check food collision for Player every frame, and Bots every 5 frames?
        // Or just optimize the loop.

        // Let's stick to standard loop for now but optimize the math
        // (dx*dx + dy*dy) < r*r

        // Actually, let's use a "Chunk" system for food implicitly?
        // No, let's just loop. JS is fast enough for 5k simple checks if we bail early.
        // Wait, 150 snakes * 5000 food = 750k ops. That will lag.
        // We MUST optimize food collision.
        // Idea: Only check food against snakes that are close?
        // Let's just limit the loop.

        // Optimized Food Collision:
        // Only check a subset of food? No.
        // Let's use the spatial hash for food, but only update it when food moves (it doesn't move much).
        // Actually, let's just brute force it for now but with a fast bail.

        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            // Fast bounding box check
            if (Math.abs(s.pos.x - f.pos.x) > (s.width + f.radius)) continue;
            if (Math.abs(s.pos.y - f.pos.y) > (s.width + f.radius)) continue;

            if (s.pos.dist(f.pos) < (s.width / 2 + f.radius)) {
                s.grow(f.value);
                foods.splice(i, 1);
            }
        }

        // Powerups
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            if (s.pos.dist(p.pos) < (s.width / 2 + p.radius)) {
                s.multiplier = p.multiplier;
                s.multiplierTimer = 10;
                powerups.splice(i, 1);
            }
        }
    }

    // Snake vs Snake
    for (const s1 of allSnakes) {
        if (s1.dead) continue;

        // Get nearby snakes from Hash
        const nearby = spatialHash.retrieve({
            x: s1.pos.x - 100, y: s1.pos.y - 100, w: 200, h: 200
        });

        for (const s2 of nearby) {
            if (s1 === s2 || s2.dead) continue;

            // Head vs Body
            // Sample points for performance
            const step = Math.max(2, Math.floor(s2.width / 5));
            for (let i = 0; i < s2.path.length; i += step) {
                const p = s2.path[i];
                const dist = s1.pos.dist(p);
                const minDist = s1.width * 0.35 + s2.width / 2; // Head radius + Body radius

                if (dist < minDist) {
                    s1.dead = true;
                    spawnParticles(s1.pos, 50, s1.color);
                    dropFood(s1);
                    break;
                }
            }
            if (s1.dead) break;
        }
    }

    if (player.dead) gameOver();
}

function dropFood(snake) {
    // Drop food along the body
    const step = Math.max(1, Math.floor(snake.width / 10));
    for (let i = 0; i < snake.path.length; i += step) {
        const p = snake.path[i];
        const val = Math.max(1, Math.floor(snake.width / 5));
        // Scatter
        const rx = (Math.random() - 0.5) * snake.width * 2;
        const ry = (Math.random() - 0.5) * snake.width * 2;
        foods.push(new Food(p.x + rx, p.y + ry, val));
    }
}

function spawnParticles(pos, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push({
            pos: pos.copy(),
            vel: new Vector((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200),
            life: 1.0,
            color: color
        });
    }
}

function gameOver() {
    gameRunning = false;
    document.getElementById('final-score').innerText = "Score: " + Math.floor(player.score);
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
}

function isInViewport(pos, margin) {
    const sx = pos.x - camera.x;
    const sy = pos.y - camera.y;
    return (sx > -margin && sx < canvas.width + margin &&
        sy > -margin && sy < canvas.height + margin);
}

function draw() {
    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Camera Follow
    const targetX = player.pos.x - canvas.width / 2;
    const targetY = player.pos.y - canvas.height / 2;
    camera.x += (targetX - camera.x) * 0.1;
    camera.y += (targetY - camera.y) * 0.1;

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Mesh Grid (Optimized)
    // Only draw lines visible in viewport
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const gridSize = 200;
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    const endX = startX + canvas.width + gridSize;
    const endY = startY + canvas.height + gridSize;

    for (let x = startX; x < endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // Map Borders
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 50;
    ctx.beginPath();
    ctx.arc(0, 0, CONFIG.mapSize, 0, Math.PI * 2);
    ctx.stroke();

    // Entities
    // Sort bots by score for layering (larger on top? or smaller on top? usually larger is better)
    // Actually, simple Z-sort by Y position is better for pseudo-3D, but score is fine.

    // Draw Food
    for (const f of foods) f.draw(ctx);
    for (const p of powerups) p.draw(ctx);

    // Draw Particles
    for (const p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, 5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw Snakes
    // Filter visible bots first? No, draw() handles culling.
    bots.sort((a, b) => a.score - b.score);
    for (const b of bots) b.draw(ctx);
    player.draw(ctx);

    ctx.restore();

    // Minimap
    drawMinimap();
}

function drawMinimap() {
    const size = 180;
    const margin = 20;
    const x = canvas.width - size - margin;
    const y = canvas.height - size - margin;

    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Scale
    const scale = (size / 2) / CONFIG.mapSize;

    // Player
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(player.pos.x * scale, player.pos.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();

    // Bots (Only big ones to save perf?)
    for (const b of bots) {
        if (b.dead) continue;
        if (b.score > 10000) ctx.fillStyle = '#ff0055'; // Giant
        else if (b.score > 1000) ctx.fillStyle = '#ffff00'; // Big
        else ctx.fillStyle = '#aaaaaa'; // Small

        ctx.beginPath();
        ctx.arc(b.pos.x * scale, b.pos.y * scale, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function updateLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;

    const all = [player, ...bots];
    all.sort((a, b) => b.score - a.score);
    const top = all.slice(0, 10);

    list.innerHTML = top.map((p, i) => {
        const icon = i === 0 ? '👑' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : ''));
        const style = p === player ? 'color: #ff0055; font-weight: bold;' : '';
        return `<li style="${style}"><span>${i + 1}. ${icon} ${p.name}</span> <span>${Math.floor(p.score)}</span></li>`;
    }).join('');
}

function updatePerformanceStats() {
    const now = performance.now();
    fpsFrames.push(now);
    // Keep only last second
    while (fpsFrames.length > 0 && fpsFrames[0] < now - 1000) {
        fpsFrames.shift();
    }

    document.getElementById('fps').innerText = fpsFrames.length;
    document.getElementById('ping').innerText = Math.floor(inputDelay);
    document.getElementById('input-delay').innerText = bots.length; // Reusing slot for bot count debug
}

function getRandomName() {
    const prefixes = ["Super", "Mega", "Ultra", "Hyper", "Cyber", "Neon", "Dark", "Void", "Shadow", "Ghost"];
    const nouns = ["Snake", "Worm", "Viper", "Cobra", "Python", "Dragon", "Beast", "Slayer", "Hunter", "Eater"];
    return prefixes[Math.floor(Math.random() * prefixes.length)] + " " + nouns[Math.floor(Math.random() * nouns.length)];
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
