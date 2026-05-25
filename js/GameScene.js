import {
    TS, TILE, LEVELS, DIG_COOLDOWN_MS, DIG_ANIM_MS, HOLE_LIFETIME_MS,
    GUARD_TRAP_MS, GUARD_RESPAWN_MS, GUARD_PANIC_ANIM_RATE
} from "./config.js";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function worldToCell(px, py) {
    return { cx: Math.floor(px / TS), cy: Math.floor(py / TS) };
}
function cellToWorld(cx, cy) {
    return { x: cx * TS + TS / 2, y: cy * TS + TS / 2 };
}

function parseLevel(levelLines) {
    const h = levelLines.length;
    const w = levelLines[0].length;

    const data = [];
    let playerSpawn = { x: 1, y: 1 };
    const guards = [];
    let goldCount = 0;

    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const ch = levelLines[y][x];
            let t = TILE.EMPTY;

            if (ch === '#') t = TILE.BRICK;
            else if (ch === 'X') t = TILE.SOLID;
            else if (ch === 'H') t = TILE.LADDER;
            else if (ch === '-') t = TILE.ROPE;
            else if (ch === '$') { t = TILE.GOLD; goldCount++; }
            else if (ch === 'S') t = TILE.EXIT;
            else if (ch === '&') { t = TILE.EMPTY; playerSpawn = { x, y }; }
            else if (ch === '0') { t = TILE.EMPTY; guards.push({ x, y }); }

            row.push(t);
        }
        data.push(row);
    }

    return { data, w, h, playerSpawn, guards, goldCount };
}

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.lives = 3;
        this.levelIndex = 0;
        this.level = null;
        this.map = null;
        this.layer = null;
        this.player = null;
        this.guards = null;

        this.goldLeft = 0;
        this.exitUnlocked = false;

        this.holes = new Map(); // "x,y" -> {x,y,restoreAt}
        this.ui = {};
    }

    preload() {
        this.load.path = "assets/images/Theme/APPLE2/";
        this.load.spritesheet('player', 'runner.png', { frameWidth: 32, frameHeight: 32 });
        this.load.spritesheet('guard', 'guard.png', { frameWidth: 32, frameHeight: 32 });
        this.load.spritesheet('tiles', 'tiles.png', { frameWidth: 32, frameHeight: 32 });
        this.load.path = "assets/levels/json/";
        this.load.json('championship_levels', 'championship_levels.json');
        this.load.json('classic_levels', 'classic_levels.json');
        this.load.json('fanBookMod_levels', 'fanBookMod_levels.json');
        this.load.json('professional_levels', 'professional_levels.json');
        this.load.json('revenge_levels', 'revenge_levels.json');
    }

    create() {
        this.createAnimations();

        this.w = this.game.config.width;
        this.h = this.game.config.height;
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyZ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
        this.keyX = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
        this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.keyN = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.N);
        this.keyB = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
        this.ui.hud = this.add.text(10, this.h - 25, '', {
            fontFamily: 'monospace',
            fontSize: 14,
            color: '#9ff',
            stroke: '#000000', // Outline color
            strokeThickness: 8 // Outline width
        }).setDepth(10);

        this.startLevel(0);
    }

    // ---------------- Animations ----------------

    createAnimations() {
        const mk = (key, sheet, frames, rate = 8, repeat = -1) => {
            if (this.anims.exists(key)) return;
            this.anims.create({
                key,
                frames: frames.map(f => ({ key: sheet, frame: f })),
                frameRate: rate,
                repeat
            });
        };

        // Player frames: 0 stand, 1 run, 2 climb, 3 fall, 4 digL, 7 digR
        mk('p-stand', 'player', [0], 1);
        mk('p-run', 'player', [0, 1, 2], 10);
        mk('p-climb', 'player', [3, 4], 10);
        mk('p-fall', 'player', [5], 10);
        mk('p-rope', 'player', [6, 7, 8], 10);

        // Guard frames: 0 stand, 1 run1, 2 run2, 3 climb1, 4 climb2, 5 fall
        mk('g-stand', 'guard', [0], 1);
        mk('g-run', 'guard', [0, 1, 2], 10);
        mk('g-climb', 'guard', [3, 4], 10);
        mk('g-fall', 'guard', [5], 10);
        mk('g-rope', 'guard', [6, 7, 8], 10);

        // Panic: reuse frames quickly
        mk('g-panic', 'guard', [0, 1], GUARD_PANIC_ANIM_RATE);
    }

    // ---------------- Level lifecycle ----------------

    startLevel(idx) {
        if (this.layer) this.layer.destroy();
        if (this.map) this.map.destroy();
        if (this.player) this.player.destroy();
        if (this.guards) this.guards.clear(true, true);

        this.holes.clear();

        const data = this.cache.json.get('classic_levels');
        this.currentLevelData = data.classicData;
        this.levelIndex = (idx + this.currentLevelData.length) % this.currentLevelData.length;
        this.level = parseLevel(this.currentLevelData[this.levelIndex]);
        // Hide exits until all gold collected
        // Store exits, then hide them from the level data
        this.exitPositions = [];
        for (let y = 0; y < this.level.h; y++) {
            for (let x = 0; x < this.level.w; x++) {
                if (this.level.data[y][x] === TILE.EXIT) {
                    this.exitPositions.push({ x, y });
                    this.level.data[y][x] = TILE.EMPTY;
                }
            }
        }

        this.goldLeft = this.level.goldCount;
        this.exitUnlocked = false;
        this.levelChanging = false;
        this.map = this.make.tilemap({
            data: this.level.data,
            tileWidth: TS,
            tileHeight: TS
        });

        const tileset = this.map.addTilesetImage('tiles');
        this.layer = this.map.createLayer(0, tileset, 0, 0);
        this.layer.setCollision([TILE.SOLID, TILE.BRICK]);

        // Player
        const p = cellToWorld(this.level.playerSpawn.x, this.level.playerSpawn.y);
        this.player = this.physics.add.sprite(p.x, p.y, 'player', 0);
        this.player.speed = 180;
        this.player.climbSpeed = 160;
        this.player.vy = 0;
        this.player.facing = 1;
        this.player.state = 'stand';
        this.player.digLockUntil = 0;
        this.player.digAnimUntil = 0;
        this.player.digDir = 1;

        // Guards
        this.guards = this.add.group();
        for (const g of this.level.guards) {
            const w = cellToWorld(g.x, g.y);
            const s = this.physics.add.sprite(w.x, w.y, 'guard', 0);
            s.speed = 155;
            s.climbSpeed = 140;
            s.vy = 0;
            s.facing = -1;
            s.state = 'stand';
            s.stunUntil = 0;
            s.nextPathAt = 0;
            s.nextStep = null;
            s.panicPhase = 0;
            s.ladderCommit = null;
            s.targetLadder = null;
            this.guards.add(s);
        }
        this.physics.add.collider(this.player, this.layer);
        this.physics.add.collider(this.guards, this.layer);

        // this.physics.add.overlap(this.player, this.guards, () => {
        //     this.flash('CAUGHT!');
        //     this.startLevel(this.levelIndex);
        // });

        this.refreshHUD();
        this.flash(`LEVEL ${this.levelIndex + 1}`);
    }
    findNearestUsableLadder(cx, cy, targetCy) {
        let best = null;
        let bestDist = Infinity;

        for (let x = 0; x < this.level.w; x++) {
            let hasUsefulLadder = false;

            const minY = Math.min(cy, targetCy);
            const maxY = Math.max(cy, targetCy);

            for (let y = minY; y <= maxY; y++) {
                if (this.isLadder(x, y)) {
                    hasUsefulLadder = true;
                    break;
                }
            }

            if (!hasUsefulLadder) continue;
            if (!this.canOccupy(x, cy)) continue;

            const dist = Math.abs(x - cx);

            if (dist < bestDist) {
                bestDist = dist;
                best = { cx: x, cy };
            }
        }

        return best;
    }

    refreshHUD() {
        this.ui.hud.setText(
            `LEVEL:${this.levelIndex + 1}/${this.currentLevelData.length}  GOLD:${this.goldLeft}  LIVES:${this.lives} ${this.exitUnlocked ? 'EXIT!' : ''}`
        );
    }

    flash(text) {
        const t = this.add.text(this.game.config.width / 2, this.game.config.height / 2, text, {
            fontFamily: 'monospace',
            fontSize: 72,
            color: '#fff',
            backgroundColor: '#000'
        }).setDepth(20)
            .setOrigin(.5);

        this.tweens.add({
            targets: t,
            alpha: 0,
            duration: 1650,
            onComplete: () => t.destroy()
        });
    }

    // ---------------- Tile helpers ----------------

    tileAt(cx, cy) {
        if (cx < 0 || cy < 0 || cx >= this.level.w || cy >= this.level.h) return TILE.SOLID;
        return this.level.data[cy][cx];
    }

    setTile(cx, cy, t) {
        if (cx < 0 || cy < 0 || cx >= this.level.w || cy >= this.level.h) return;
        this.level.data[cy][cx] = t;
        this.layer.putTileAt(t, cx, cy);
        this.layer.setCollision([TILE.SOLID, TILE.BRICK]);
    }

    isSolid(cx, cy) {
        const t = this.tileAt(cx, cy);
        return (t === TILE.SOLID || t === TILE.BRICK);
    }

    isWalkable(cx, cy) {
        const t = this.tileAt(cx, cy);
        return (
            t === TILE.EMPTY ||
            t === TILE.LADDER ||
            t === TILE.ROPE ||
            t === TILE.GOLD ||
            t === TILE.EXIT ||
            t === TILE.HOLE
        );
    }

    isLadder(cx, cy) {
        const t = this.tileAt(cx, cy);
        return t === TILE.LADDER || t === TILE.EXIT;
    }
    isRope(cx, cy) { return this.tileAt(cx, cy) === TILE.ROPE; }

    hasSupportAt(cx, cy) {
        const below = this.tileAt(cx, cy + 1);
        return (
            below === TILE.SOLID ||
            below === TILE.BRICK ||
            this.isLadder(cx, cy) ||
            this.isRope(cx, cy)
        );
    }

    // ---------------- Collect / Exit ----------------

    collectGoldIfAny(sprite) {
        const { cx, cy } = worldToCell(sprite.x, sprite.y);
        if (this.tileAt(cx, cy) === TILE.GOLD) {
            this.setTile(cx, cy, TILE.EMPTY);
            this.goldLeft--;
            if (this.goldLeft <= 0) {
                this.exitUnlocked = true;
                for (const e of this.exitPositions) {
                    this.level.data[e.y][e.x] = TILE.EXIT;
                    this.layer.putTileAt(TILE.EXIT, e.x, e.y);
                }

                this.layer.setCollision([TILE.SOLID, TILE.BRICK]);

                this.flash('EXIT UNLOCKED!');
            }
            this.refreshHUD();
        }
    }

    tryExit() {
        if (!this.exitUnlocked) return;
        if (this.levelChanging) return;

        const { cx, cy } = worldToCell(this.player.x, this.player.y);

        const onExitTile = this.tileAt(cx, cy) === TILE.EXIT;
        const exitAbove = this.tileAt(cx, cy - 1) === TILE.EXIT;
        const playerCentered = Math.abs(this.player.x - cellToWorld(cx, cy).x) < 6;

        // Only clear at TOP of exit ladder
        if (onExitTile && !exitAbove && playerCentered) {
            this.levelChanging = true;

            this.flash('LEVEL CLEAR!');
            this.time.delayedCall(450, () => {
                this.startLevel(this.levelIndex + 1);
            });
        }
    }

    // ---------------- Digging / holes ----------------

    tryDig(dir) {
        const now = this.time.now;
        if (now < this.player.digLockUntil) return;

        const { cx, cy } = worldToCell(this.player.x, this.player.y);
        const tx = cx + dir;
        const ty = cy + 1;

        // Dig only brick; space above target must be walkable
        if (this.tileAt(tx, ty) !== TILE.BRICK) return;
        if (!this.isWalkable(tx, ty - 1)) return;

        // Make hole
        this.setTile(tx, ty, TILE.HOLE);
        const key = `${tx},${ty}`;
        this.holes.set(key, { x: tx, y: ty, restoreAt: now + HOLE_LIFETIME_MS });

        // Dig timing + pose hold
        this.player.digLockUntil = now + DIG_COOLDOWN_MS;
        this.player.digAnimUntil = now + DIG_ANIM_MS;
        this.player.digDir = dir;
        this.player.state = dir < 0 ? 'digL' : 'digR';
        this.player.setFrame(dir < 0 ? 6 : 7);
    }

    restoreHoles() {
        const now = this.time.now;
        for (const [key, h] of this.holes) {
            if (now < h.restoreAt) continue;

            // If a guard is inside the hole when it closes, respawn it.
            this.guards.getChildren().forEach(g => {
                const { cx, cy } = worldToCell(g.x, g.y);
                if (cx === h.x && cy === h.y) {
                    const spawn = { x: 2 + Math.floor(Math.random() * 6), y: 1 };
                    const w = cellToWorld(spawn.x, spawn.y);
                    g.setPosition(w.x, w.y);
                    g.vy = 0;
                    g.stunUntil = now + GUARD_RESPAWN_MS;
                    g.clearTint();
                    g.panicPhase = 0;
                    g.state = 'stand';
                    g.nextStep = null;
                }
            });

            this.setTile(h.x, h.y, TILE.BRICK);
            this.holes.delete(key);
        }
    }

    // ---------------- Movement + state ----------------
    hasGroundUnderSprite(x, y) {
        const footY = y + TS / 2 - 2;
        const leftX = x - TS * 0.28;
        const rightX = x + TS * 0.28;

        const left = worldToCell(leftX, footY);
        const right = worldToCell(rightX, footY);

        return (
            this.isSolid(left.cx, left.cy + 1) ||
            this.isSolid(right.cx, right.cy + 1)
        );
    }
    applyMovement(sprite, wantX, wantY) {
        const dt = this.game.loop.delta / 1000;
        const { cx, cy } = worldToCell(sprite.x, sprite.y);

        const onLadder = this.isLadder(cx, cy);
        const ladderBelow = this.isLadder(cx, cy + 1);
        const supported = this.hasSupportAt(cx, cy);
        const onRope = this.isRope(cx, cy);

        // Drop off rope when DOWN is pressed
        if (onRope && wantY > 0) {
            sprite.y += sprite.speed * dt * 0.65;
            sprite.vy = 120;
            sprite.state = 'fall';
            return;
        }
        // Falling
        const wasFalling = sprite.vy > 0 || sprite.state === 'fall';
        if (!supported && !onLadder && !ladderBelow) {
            sprite.vy = clamp(sprite.vy + 1400 * dt, 0, 320);
        } else {
            sprite.vy = 0;
        }

        // Climbing
        // Vertical movement on ladders
        if (wantY !== 0) {
            const climbingUp = wantY < 0;
            const climbingDown = wantY > 0;

            const ladderHere = this.isLadder(cx, cy);
            const ladderAbove = this.isLadder(cx, cy - 1);
            const ladderBelow = this.isLadder(cx, cy + 1);

            if (ladderHere || (climbingUp && ladderAbove) || (climbingDown && ladderBelow)) {
                const center = cellToWorld(cx, cy);

                // keep centered while climbing
                sprite.x += (center.x - sprite.x) * 0.35;

                sprite.y += wantY * ((sprite.climbSpeed ?? sprite.speed) * dt);
                sprite.vy = 0;

                // climb fully off the top of the ladder
                if (climbingUp && ladderHere && !ladderAbove) {
                    const currentCenter = cellToWorld(cx, cy);
                    const aboveCenter = cellToWorld(cx, cy - 1);

                    if (sprite.y < currentCenter.y - TS * 0.35) {
                        sprite.x = aboveCenter.x;
                        sprite.y = aboveCenter.y;
                        sprite.vy = 0;
                        sprite.state = 'stand';

                        // Force guard/player to leave ladder movement cleanly
                        return;
                    }
                }

                // climb fully onto bottom tile
                if (climbingDown && ladderHere && !ladderBelow) {
                    const bottomCenter = cellToWorld(cx, cy);
                    if (sprite.y >= bottomCenter.y) {
                        sprite.y = bottomCenter.y;
                        sprite.state = 'stand';
                    }
                }
            }
        }

        // Horizontal
        // Horizontal
        const airborne =
            sprite.vy > 0 &&
            !this.isLadder(cx, cy) &&
            !this.isRope(cx, cy);

        // No horizontal movement while falling
        if (!airborne && wantX !== 0) {
            const cc = worldToCell(sprite.x, sprite.y);
            const nx = cc.cx + wantX;

            if (!this.isSolid(nx, cc.cy) && this.isWalkable(nx, cc.cy)) {
                sprite.x += wantX * (sprite.speed * dt);
                sprite.facing = wantX;
                sprite.setFlipX(sprite.facing < 0);
            }
        }
        // Apply falling

        if (sprite.vy !== 0) {
            sprite.y += sprite.vy * dt;
        }

        // HARD SNAP after landing
        const cc = worldToCell(sprite.x, sprite.y);
        const center = cellToWorld(cc.cx, cc.cy);

        const landed =
            wasFalling &&
            sprite.vy === 0 &&
            this.hasSupportAt(cc.cx, cc.cy);

        if (landed) {
            sprite.x = center.x;
            sprite.y = center.y;
            sprite.vy = 0;
        }
        // Clamp
        sprite.x = clamp(sprite.x, TS / 2, this.level.w * TS - TS / 2);
        sprite.y = clamp(sprite.y, TS / 2, this.level.h * TS - TS / 2);

        // State
        const c2 = worldToCell(sprite.x, sprite.y);
        const ladder2 = this.isLadder(c2.cx, c2.cy);
        const rope2 = this.isRope(c2.cx, c2.cy);
        const support2 = this.hasSupportAt(c2.cx, c2.cy);

        if (!support2 && !ladder2 && !rope2) {
            sprite.state = 'fall';
        } else if (wantY !== 0 && ladder2) {
            sprite.state = 'climb';
        } else if (rope2 && wantX !== 0) {
            sprite.state = 'rope';
        } else if (wantX !== 0) {
            sprite.state = 'run';
        } else {
            sprite.state = 'stand';
        }
    }

    // ---------------- BFS Pathfinding ----------------

    cellKey(cx, cy) { return `${cx},${cy}`; }

    canOccupy(cx, cy) {
        return this.isWalkable(cx, cy) && !this.isSolid(cx, cy);
    }

    neighborsFor(cx, cy) {
        const out = [];
        if (!this.canOccupy(cx, cy)) return out;

        const onLadder = this.isLadder(cx, cy);
        const onRope = this.isRope(cx, cy);
        const supported = this.hasSupportAt(cx, cy);
        const supportedAndFalling = this.hasGroundUnderSprite(cx, cy);

        // gravity-only step if midair and not on ladder
        if (!supported && !onLadder) {
            const ny = cy + 1;
            if (this.canOccupy(cx, ny)) out.push({ cx, cy: ny });
            return out;
        }

        const allowHoriz = supported || onRope || onLadder;
        if (allowHoriz) {
            if (this.canOccupy(cx - 1, cy)) out.push({ cx: cx - 1, cy });
            if (this.canOccupy(cx + 1, cy)) out.push({ cx: cx + 1, cy });
        }

        // vertical only via ladders
        if (onLadder) {
            // climb up
            if (this.canOccupy(cx, cy - 1) && this.isLadder(cx, cy - 1)) {
                out.push({ cx, cy: cy - 1 });
            }

            // climb down
            if (this.canOccupy(cx, cy + 1) && this.isLadder(cx, cy + 1)) {
                out.push({ cx, cy: cy + 1 });
            }

            // top of ladder: allow running off
            if (!this.isLadder(cx, cy - 1) && this.hasSupportAt(cx, cy)) {
                if (this.canOccupy(cx - 1, cy)) out.push({ cx: cx - 1, cy });
                if (this.canOccupy(cx + 1, cy)) out.push({ cx: cx + 1, cy });
            }

            // bottom of ladder: allow running off
            if (!this.isLadder(cx, cy + 1) && this.hasSupportAt(cx, cy)) {
                if (this.canOccupy(cx - 1, cy)) out.push({ cx: cx - 1, cy });
                if (this.canOccupy(cx + 1, cy)) out.push({ cx: cx + 1, cy });
            }
        }

        return out;
    }

    bfsNextStep(start, goal, maxNodes = 1400) {
        if (start.cx === goal.cx && start.cy === goal.cy) return null;

        const q = [start];
        const cameFrom = new Map();

        const sKey = this.cellKey(start.cx, start.cy);
        const gKey = this.cellKey(goal.cx, goal.cy);

        cameFrom.set(sKey, null);

        let visited = 0;
        while (q.length && visited < maxNodes) {
            visited++;
            const cur = q.shift();
            const curKey = this.cellKey(cur.cx, cur.cy);
            if (curKey === gKey) break;

            for (const nb of this.neighborsFor(cur.cx, cur.cy)) {
                const nbKey = this.cellKey(nb.cx, nb.cy);
                if (cameFrom.has(nbKey)) continue;
                cameFrom.set(nbKey, curKey);
                q.push(nb);
            }
        }

        if (!cameFrom.has(gKey)) return null;

        // reconstruct first step
        let stepKey = gKey;
        let prevKey = cameFrom.get(stepKey);

        while (prevKey && prevKey !== sKey) {
            stepKey = prevKey;
            prevKey = cameFrom.get(stepKey);
        }

        const [nx, ny] = stepKey.split(',').map(Number);
        return { cx: nx, cy: ny };
    }

    getPathTargetCell() {
        const pc = worldToCell(this.player.x, this.player.y);

        const candidates = [
            { cx: pc.cx, cy: pc.cy },
            { cx: pc.cx, cy: pc.cy - 1 },
            { cx: pc.cx, cy: pc.cy + 1 },
            { cx: pc.cx - 1, cy: pc.cy },
            { cx: pc.cx + 1, cy: pc.cy }
        ];

        for (const c of candidates) {
            if (this.canOccupy(c.cx, c.cy)) return c;
        }
        return { cx: pc.cx, cy: pc.cy };
    }

    // ---------------- Guard update ----------------

    updateGuard(g) {
        const now = this.time.now;
        if (now < g.stunUntil) return;

        const gc = worldToCell(g.x, g.y);
        // Continue ladder movement until finished
        if (g.ladderCommit) {
            const c = worldToCell(g.x, g.y);
            const center = cellToWorld(c.cx, c.cy);

            g.x = center.x;

            if (g.ladderCommit === 'up') {
                const onLadder = this.isLadder(c.cx, c.cy);
                const ladderUnderGuard = this.isLadder(c.cx, c.cy + 1);

                // Top reached: guard is standing above the ladder.
                // Stop climbing so pathfinding can choose left/right.
                if (!onLadder && ladderUnderGuard) {
                    g.ladderCommit = null;
                    g.nextStep = null;
                    g.nextPathAt = 0;
                    g.state = 'stand';
                } else {
                    this.applyMovement(g, 0, -1);
                    g.play('g-climb', true);
                    return;
                }
            }

            if (g.ladderCommit === 'down') {
                // Keep descending until ground is UNDER the guard
                if (!this.hasGroundUnderSprite(g.x, g.y)) {
                    this.applyMovement(g, 0, 1);
                    g.play('g-climb', true);
                    return;
                }
            }

            g.ladderCommit = null;
            g.nextStep = null;
            g.nextPathAt = 0;
        }
        // Panic in hole
        if (this.tileAt(gc.cx, gc.cy) === TILE.HOLE) {
            g.stunUntil = now + GUARD_TRAP_MS;

            if (!g.panicPhase) g.panicPhase = Math.random() * 1000;
            g.panicPhase += this.game.loop.delta;

            g.x += Math.sin(g.panicPhase * 0.04) * 1.2;
            g.y += Math.sin(g.panicPhase * 0.02) * 0.6;

            // Optional tint; comment out for pure Apple II look
            g.setTint(0xff7777);

            g.play('g-panic', true);
            g.state = 'panic';
            return;
        } else {
            if (g.tintTopLeft !== 0xffffff) g.clearTint();
        }
        const falling =
            g.state === 'fall' ||
            (!this.hasGroundUnderSprite(g.x, g.y) && !this.isLadder(gc.cx, gc.cy) && !this.isRope(gc.cx, gc.cy));

        if (falling) {
            g.targetLadder = null;
            g.nextStep = null;
            g.nextPathAt = 0;
        }
        // Repath occasionally, but do not change direction while committed to a ladder
        if (now >= (g.nextPathAt || 0)) {
            const playerCell = worldToCell(this.player.x, this.player.y);
            const start = { cx: gc.cx, cy: gc.cy };

            let goal = this.getPathTargetCell();

            if (playerCell.cy !== gc.cy) {
                // Keep current ladder target until reached
                if (g.targetLadder && gc.cx !== g.targetLadder.cx) {
                    goal = { cx: g.targetLadder.cx, cy: gc.cy };
                } else {
                    const ladderGoal = this.findNearestUsableLadder(gc.cx, gc.cy, playerCell.cy);

                    if (ladderGoal) {
                        g.targetLadder = ladderGoal;

                        if (gc.cx !== ladderGoal.cx) {
                            goal = { cx: ladderGoal.cx, cy: gc.cy };
                        } else if (this.isLadder(gc.cx, gc.cy)) {
                            goal = {
                                cx: gc.cx,
                                cy: playerCell.cy < gc.cy ? gc.cy - 1 : gc.cy + 1
                            };
                        }
                    }
                }
            } else {
                g.targetLadder = null;
            }

            g.nextStep = this.bfsNextStep(start, goal);
            g.nextPathAt = now + 180;
        }

        let wx = 0, wy = 0;

        if (g.nextStep) {
            const target = cellToWorld(g.nextStep.cx, g.nextStep.cy);
            const dx = target.x - g.x;
            const dy = target.y - g.y;

            // Keep moving until visually centered in the target cell
            if (Math.abs(dx) > 2) wx = Math.sign(dx);
            if (Math.abs(dy) > 2) wy = Math.sign(dy);

            // Snap when close
            if (Math.abs(dx) <= 2) g.x = target.x;
            if (Math.abs(dy) <= 2) g.y = target.y;

            // Once centered, allow a new path step
            if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
                g.nextStep = null;
                g.nextPathAt = 0;
            }
            if (g.nextStep) {
                const wantsVertical = g.nextStep.cy !== gc.cy;
                const wantsHorizontal = g.nextStep.cx !== gc.cx;

                const onLadder = this.isLadder(gc.cx, gc.cy);
                const ladderAbove = this.isLadder(gc.cx, gc.cy - 1);
                const ladderBelow = this.isLadder(gc.cx, gc.cy + 1);

                const target = cellToWorld(g.nextStep.cx, g.nextStep.cy);
                const closeToTargetY = Math.abs(target.y - g.y) <= 8;
                const atTopOfLadder = onLadder && !ladderAbove && closeToTargetY;
                const atBottomOfLadder = onLadder && !ladderBelow && closeToTargetY;

                if (wantsVertical && (onLadder || ladderAbove || ladderBelow)) {
                    wx = 0;
                    wy = Math.sign(g.nextStep.cy - gc.cy);
                } else if (wantsHorizontal && (atTopOfLadder || atBottomOfLadder)) {
                    wy = 0;
                    wx = Math.sign(g.nextStep.cx - gc.cx);
                } else if (wx !== 0 && wy !== 0) {
                    wy = 0;
                }
            }
        }

        if (wy < 0 && this.isLadder(gc.cx, gc.cy)) {
            g.ladderCommit = 'up';
        } else if (wy > 0 && this.isLadder(gc.cx, gc.cy)) {
            g.ladderCommit = 'down';
        }
        this.applyMovement(g, wx, wy);

        // Animate guard by state
        if (g.state === 'fall') g.play('g-fall', true);
        else if (g.state === 'climb') g.play('g-climb', true);
        else if (g.state === 'run') g.play('g-run', true);
        else if (g.state === 'rope') g.play('g-rope', true);
        else g.play('g-stand', true);
    }

    // ---------------- Main update ----------------

    update() {
        // Hotkeys
        if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
            this.startLevel(this.levelIndex);
            return;
        }
        if (Phaser.Input.Keyboard.JustDown(this.keyN)) {
            this.startLevel(this.levelIndex + 1);
            return;
        }
        if (Phaser.Input.Keyboard.JustDown(this.keyB)) {
            this.startLevel(this.levelIndex - 1);
            return;
        }

        this.restoreHoles();

        // Input
        let wx = 0, wy = 0;
        if (this.cursors.left.isDown) wx = -1;
        else if (this.cursors.right.isDown) wx = 1;

        if (this.cursors.up.isDown) wy = -1;
        else if (this.cursors.down.isDown) wy = 1;

        if (Phaser.Input.Keyboard.JustDown(this.keyZ)) this.tryDig(-1);
        if (Phaser.Input.Keyboard.JustDown(this.keyX)) this.tryDig(1);

        const now = this.time.now;

        // Dig animation timing: freeze movement and hold pose briefly
        if (now < this.player.digAnimUntil) {
            const c = worldToCell(this.player.x, this.player.y);
            const ctr = cellToWorld(c.cx, c.cy);
            this.player.x = ctr.x;
            this.player.y = ctr.y;
            this.player.setFrame(this.player.digDir < 0 ? 6 : 7);
        } else {
            // Normal movement
            this.applyMovement(this.player, wx, wy);
            // Player animation by state
            if (this.player.state === 'fall') this.player.play('p-fall', true);
            else if (this.player.state === 'climb') this.player.play('p-climb', true);
            else if (this.player.state === 'run') this.player.play('p-run', true);
            else if (this.player.state === 'rope') this.player.play('p-rope', true);
            else this.player.play('p-stand', true);
        }

        // Interactions
        this.collectGoldIfAny(this.player);
        this.tryExit();

        // Guards
        this.guards.getChildren().forEach(g => this.updateGuard(g));
    }
}
