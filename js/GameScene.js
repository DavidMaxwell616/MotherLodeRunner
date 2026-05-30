import {
    TS, TILE, DIG_COOLDOWN_MS, DIG_ANIM_MS, HOLE_LIFETIME_MS,
    GUARD_TRAP_MS, GUARD_RESPAWN_MS, GUARD_PANIC_ANIM_RATE,
    THEMES
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
    let runnerSpawn = { x: 1, y: 1 };
    const guards = [];
    let goldCount = 0;

    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const ch = levelLines[y][x];
            let t = TILE.EMPTY;

            if (ch === '#' || ch === 'X') t = TILE.BRICK;
            else if (ch === '@') t = TILE.SOLID;
            else if (ch === 'H') t = TILE.LADDER;
            else if (ch === '-') t = TILE.ROPE;
            else if (ch === '$') { t = TILE.GOLD; goldCount++; }
            else if (ch === 'S') t = TILE.EXIT;
            else if (ch === '&') { t = TILE.EMPTY; runnerSpawn = { x, y }; }
            else if (ch === '0') { t = TILE.EMPTY; guards.push({ x, y }); }

            row.push(t);
        }
        data.push(row);
    }

    return { data, w, h, runnerSpawn, guards, goldCount };
}

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.lives = 3;
        this.levelIndex = 0;
        this.level = null;
        this.map = null;
        this.layer = null;
        this.runner = null;
        this.guards = null;
        this.goldLeft = 0;
        this.exitUnlocked = false;

        this.holes = new Map(); // "x,y" -> {x,y,restoreAt}
        this.ui = {};
    }

    preload() {
        this.theme = this.registry?.get("theme");
        this.levelType = this.registry?.get("levelType");

        const theme = this.registry.get("theme");

        this.load.path = `assets/images/Theme/${theme}/`;
        this.load.spritesheet('runner', 'runner.png', { frameWidth: 32, frameHeight: 32 });
        this.load.spritesheet('guard', 'guard.png', { frameWidth: 32, frameHeight: 32 });
        this.load.spritesheet('tiles', 'tiles.png', { frameWidth: 32, frameHeight: 32 });
        this.load.spritesheet('dig', 'hole.png', { frameWidth: 32, frameHeight: 64 });
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


        if (this.theme === THEMES.MAX) {
            // runner frames: 0 stand, 1 run, 2 climb, 3 fall, 4 digL, 7 digR
            mk('r-stand', 'runner', [30], 1);
            mk('r-run', 'runner', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
            mk('r-climb', 'runner', [11, 12, 13, 14, 15, 16, 17, 18], 10);
            mk('r-fall', 'runner', [22, 23, 24, 25, 26, 27, 28, 29, 30], 10);
            mk('r-rope', 'runner', [33, 34, 35, 36, 37, 38], 10);
            mk('dig-hole', 'dig', [0, 1, 2, 3, 4, 5], 14, 0);

            // Guard frames: 0 stand, 1 run1, 2 run2, 3 climb1, 4 climb2, 5 fall
            mk('g-stand', 'guard', [0], 1);
            mk('g-run', 'guard', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
            mk('g-climb', 'guard', [11, 12, 13, 14, 15, 16, 17, 18], 10);
            mk('g-fall', 'guard', [22, 23, 24, 25], 10);
            mk('g-rope', 'guard', [33, 34, 35, 36, 37, 38, 39, 40, 41], 10);

            // Panic: reuse frames quickly
            mk('g-panic', 'guard', [0, 1], GUARD_PANIC_ANIM_RATE);

        }
        else {


            // runner frames: 0 stand, 1 run, 2 climb, 3 fall, 4 digL, 7 digR
            mk('r-stand', 'runner', [0], 1);
            mk('r-run', 'runner', [0, 1, 2], 10);
            mk('r-climb', 'runner', [3, 4], 10);
            mk('r-fall', 'runner', [5], 10);
            mk('r-rope', 'runner', [6, 7, 8], 10);
            mk('dig-hole', 'dig', [0, 1, 2, 3, 4, 5], 14, 0);

            // Guard frames: 0 stand, 1 run1, 2 run2, 3 climb1, 4 climb2, 5 fall
            mk('g-stand', 'guard', [0], 1);
            mk('g-run', 'guard', [0, 1, 2], 10);
            mk('g-climb', 'guard', [3, 4], 10);
            mk('g-fall', 'guard', [5], 10);
            mk('g-rope', 'guard', [6, 7, 8], 10);

            // Panic: reuse frames quickly
            mk('g-panic', 'guard', [0, 1], GUARD_PANIC_ANIM_RATE);
        }
    }

    // ---------------- Level lifecycle ----------------

    startLevel(idx) {
        if (this.layer) this.layer.destroy();
        if (this.map) this.map.destroy();
        if (this.runner) this.runner.destroy();
        if (this.guards) this.guards.clear(true, true);
        if (this.digSprites) this.digSprites.clear(true, true);
        this.holes.clear();

        const data = this.cache.json.get(this.levelType);

        this.currentLevelData =
            data[`${this.levelType}`] ||
            data.levels ||
            [];

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

        // runner
        const p = cellToWorld(this.level.runnerSpawn.x, this.level.runnerSpawn.y);
        this.runner = this.physics.add.sprite(p.x, p.y, 'runner', 0);
        this.runner.speed = 180;
        this.runner.climbSpeed = 160;
        this.runner.vy = 0;
        this.runner.facing = 1;
        this.runner.state = 'stand';
        this.runner.digLockUntil = 0;
        this.runner.digAnimUntil = 0;
        this.runner.digDir = 1;
        this.digSprites = this.add.group();
        // Guards
        this.guards = this.add.group();
        this.guardIndex = 0;
        for (const g of this.level.guards) {
            const w = cellToWorld(g.x, g.y);
            const s = this.physics.add.sprite(w.x, w.y, 'guard', 0);
            // Different guard speeds, all slower than runner speed 180
            const guardSpeeds = [120, 130, 140, 150, 160];
            const speed = guardSpeeds[this.guards.getLength() % guardSpeeds.length];

            s.speed = speed;
            s.climbSpeed = Math.max(105, speed - 15);
            s.vy = 0;
            s.facing = -1;
            s.state = 'stand';
            s.stunUntil = 0;
            s.panicPhase = 0;
            s.ladderCommit = null;
            s.id = this.guardIndex;
            this.guardIndex++;
            this.guards.add(s);
        }
        this.physics.add.collider(this.runner, this.layer);
        this.physics.add.collider(this.guards, this.layer);

        // this.physics.add.overlap(this.runner, this.guards, () => {
        //     this.flash('CAUGHT!',100);
        // lives--;
        // if (lives === 0) { gameOver(); }
        // this.startLevel(this.levelIndex);
        // });

        this.refreshHUD();
        this.flash(`LEVEL ${this.levelIndex + 1}`, this.game.config.height / 2);
    }
    findNearestUsableLadder(cx, cy, targetCy) {
        if (targetCy === undefined || targetCy === null) return null;

        const goingUp = targetCy < cy;
        const goingDown = targetCy > cy;

        let best = null;
        let bestScore = Infinity;

        for (let x = 0; x < this.level.w; x++) {

            if (!this.canOccupy(x, cy)) continue;

            const ladderUp =
                goingUp &&
                (
                    this.isLadder(x, cy) ||
                    this.isLadder(x, cy - 1)
                );

            const ladderDown =
                goingDown &&
                (
                    this.isLadder(x, cy) ||
                    this.isLadder(x, cy + 1)
                );

            // empty floor opening that can lead somewhere
            const emptyFloor =
                goingDown &&
                !this.isSolid(x, cy) &&
                !this.isSolid(x, cy + 1);

            // rope drop
            const ropeDrop =
                goingDown &&
                this.isRope(x, cy) &&
                !this.isSolid(x, cy + 1);

            // walkable edge/drop
            const edgeDrop =
                goingDown &&
                this.hasSupportAt(x, cy) &&
                !this.hasSupportAt(x, cy + 1);

            const useful =
                ladderUp ||
                ladderDown ||
                emptyFloor ||
                ropeDrop ||
                edgeDrop;

            if (!useful) continue;

            let score = Math.abs(x - cx);

            // prioritize real ladders
            if (ladderUp || ladderDown) score -= 3;

            // prefer nearby drop openings
            if (edgeDrop) score -= 1;

            if (score < bestScore) {
                bestScore = score;
                best = {
                    cx: x,
                    cy,
                    type:
                        ladderUp ? "ladderUp" :
                            ladderDown ? "ladderDown" :
                                ropeDrop ? "ropeDrop" :
                                    edgeDrop ? "edgeDrop" :
                                        "emptyFloor"
                };
            }
        }

        return best;
    }
    refreshHUD() {
        this.ui.hud.setText(
            `LEVEL:${this.levelIndex + 1}/${this.currentLevelData.length}   GOLD:${this.goldLeft}  LIVES:${this.lives} ${this.exitUnlocked ? 'EXIT!' : ''}`
        );
    }

    flash(text, y) {
        const t = this.add.text(this.game.config.width / 2, y, text, {
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

                this.flash('EXIT UNLOCKED!', this.game.config.height / 2);
            }
            this.refreshHUD();
        }
    }

    tryExit() {
        if (!this.exitUnlocked) return;
        if (this.levelChanging) return;

        const { cx, cy } = worldToCell(this.runner.x, this.runner.y);

        const onExitTile = this.tileAt(cx, cy) === TILE.EXIT;
        const exitAbove = this.tileAt(cx, cy - 1) === TILE.EXIT;
        const runnerCentered = Math.abs(this.runner.x - cellToWorld(cx, cy).x) < 6;

        // Only clear at TOP of exit ladder
        if (onExitTile && !exitAbove && runnerCentered) {
            this.levelChanging = true;

            this.flash('LEVEL CLEAR!', this.game.config.height / 2);
            this.time.delayedCall(450, () => {
                this.startLevel(this.levelIndex + 1);
            });
        }
    }

    // ---------------- Digging / holes ----------------

    tryDig(dir) {
        const now = this.time.now;
        if (now < this.runner.digLockUntil) return;

        const { cx, cy } = worldToCell(this.runner.x, this.runner.y);
        const tx = cx + dir;
        const ty = cy + 1;

        if (this.tileAt(tx, ty) !== TILE.BRICK) return;
        if (!this.isWalkable(tx, ty - 1)) return;

        const pos = cellToWorld(tx, ty);

        // Put dig sprite over target ground tile
        const digSprite = this.add.sprite(pos.x, pos.y - TS / 2, 'dig', 0)
            .setOrigin(0.5, 0.5)
            .setDepth(5);

        this.digSprites.add(digSprite);

        digSprite.play('dig-hole');

        digSprite.once('animationcomplete', () => {
            digSprite.destroy();

            // Make hole after dig animation finishes
            this.setTile(tx, ty, TILE.HOLE);

            const key = `${tx},${ty}`;
            this.holes.set(key, {
                x: tx,
                y: ty,
                restoreAt: this.time.now + HOLE_LIFETIME_MS
            });
        });

        this.runner.digLockUntil = now + DIG_COOLDOWN_MS;
        this.runner.digAnimUntil = now + DIG_ANIM_MS;
        this.runner.digDir = dir;
        this.runner.state = dir < 0 ? 'digL' : 'digR';
        this.runner.setFrame(dir < 0 ? 6 : 7);
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
                }
            });
            const r = worldToCell(this.runner.x, this.runner.y);
            if (r.cx === h.x && r.cy === h.y) {
                this.flash('TRAPPED!', 100);
                lives--;
                if (lives === 0) { gameOver(); }
                this.startLevel(this.levelIndex);
            }

            this.setTile(h.x, h.y, TILE.BRICK);
            this.holes.delete(key);
        }
    }
    gameOver() {

        this.physics.pause();

        // prevent multiple calls
        if (this.isGameOver) return;
        this.isGameOver = true;

        const w = this.game.config.width;
        const h = this.game.config.height;

        // dark overlay
        const overlay = this.add.rectangle(
            w / 2,
            h / 2,
            w,
            h,
            0x000000,
            0.75
        ).setDepth(500);

        // GAME OVER title
        const title = this.add.text(
            w / 2,
            h * 0.35,
            'GAME OVER',
            {
                fontFamily: 'monospace',
                fontSize: 64,
                color: '#ff4444',
                stroke: '#000000',
                strokeThickness: 10
            }
        )
            .setOrigin(0.5)
            .setDepth(501);

        // score text
        const scoreText = this.add.text(
            w / 2,
            h * 0.50,
            `SCORE: ${this.score || 0}`,
            {
                fontFamily: 'monospace',
                fontSize: 36,
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 8
            }
        )
            .setOrigin(0.5)
            .setDepth(501);

        // flashing effect
        this.tweens.add({
            targets: title,
            alpha: 0.2,
            duration: 350,
            yoyo: true,
            repeat: -1
        });

        // button background
        const buttonBg = this.add.rectangle(
            w / 2,
            h * 0.68,
            260,
            70,
            0x222222
        )
            .setStrokeStyle(4, 0xffffff)
            .setInteractive({ useHandCursor: true })
            .setDepth(501);

        // button text
        const buttonText = this.add.text(
            w / 2,
            h * 0.68,
            'RETURN TO MENU',
            {
                fontFamily: 'monospace',
                fontSize: 28,
                color: '#ffffff'
            }
        )
            .setOrigin(0.5)
            .setDepth(502);

        // hover effects
        buttonBg.on('pointerover', () => {
            buttonBg.setFillStyle(0x444444);
        });

        buttonBg.on('pointerout', () => {
            buttonBg.setFillStyle(0x222222);
        });

        // click
        buttonBg.on('pointerdown', () => {

            this.scene.start('SplashScene');
        });
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
        const supported =
            this.hasSupportAt(cx, cy) ||
            (this.isLadder(cx, cy) && this.isSolid(cx, cy + 1));
        const onRope = this.isRope(cx, cy);

        // Keep runner/guard centered vertically while on rope
        if (onRope && wantY === 0) {
            const center = cellToWorld(cx, cy);
            sprite.y = center.y;
        }

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

                        // Force guard/runner to leave ladder movement cleanly
                        return;
                    }
                }

                // climb fully onto bottom tile
                // climb off bottom of ladder.
                // If there is no real ground under the ladder bottom, start falling.
                // climb off bottom of ladder
                if (climbingDown && ladderHere && !ladderBelow) {
                    const bottomCenter = cellToWorld(cx, cy);
                    const groundBelow =
                        this.isSolid(cx, cy + 1) ||
                        this.tileAt(cx, cy + 1) === TILE.BRICK ||
                        this.tileAt(cx, cy + 1) === TILE.SOLID;

                    if (sprite.y >= bottomCenter.y) {
                        sprite.x = bottomCenter.x;

                        if (groundBelow) {
                            // STOP exactly on bottom ladder tile
                            sprite.y = bottomCenter.y;
                            sprite.vy = 0;
                            sprite.state = 'stand';
                        } else {
                            // only fall if there is no floor under ladder
                            sprite.y = bottomCenter.y;
                            sprite.vy = 120;
                            sprite.state = 'fall';
                        }

                        return;
                    }
                }
            }
        }

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

                // Fix stepping off middle of ladder into brick height
                this.popUpIfInsideBrick(sprite);
            }
        }
        // Apply falling
        if (sprite.vy !== 0) {

            sprite.y += sprite.vy * dt;

            const fallCell = worldToCell(sprite.x, sprite.y);
            const fallCenter = cellToWorld(fallCell.cx, fallCell.cy);

            // Keep centered in falling column
            sprite.x = fallCenter.x;

            // Snap immediately when reaching supported ground
            const supportedNow =
                this.hasSupportAt(fallCell.cx, fallCell.cy);

            if (supportedNow) {

                sprite.x = fallCenter.x;
                sprite.y = fallCenter.y;

                sprite.vy = 0;
                sprite.state = 'stand';
            }
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

    canOccupy(cx, cy) {
        return this.isWalkable(cx, cy) && !this.isSolid(cx, cy);
    }

    // ---------------- Guard update ----------------


    moveGuard(g) {
        const now = this.time.now;
        if (g.stunUntil && now < g.stunUntil) return;

        const gc = worldToCell(g.x, g.y);
        const rc = worldToCell(this.runner.x, this.runner.y);

        let wx = 0;
        let wy = 0;

        const onLadder = this.isLadder(gc.cx, gc.cy);
        const onRope = this.isRope(gc.cx, gc.cy);
        const ladderAbove = this.isLadder(gc.cx, gc.cy - 1);
        const ladderBelow = this.isLadder(gc.cx, gc.cy + 1);

        const runnerAbove = rc.cy < gc.cy;
        const runnerBelow = rc.cy > gc.cy;

        // -------------------------------------------------
        // FINISH LADDER COMMIT
        // -------------------------------------------------

        if (onLadder && gc.cy === rc.cy) {
            g.ladderCommit = null;
            wx = rc.cx < gc.cx ? -1 : 1;
            wy = 0;
        }
        else {
            if (g.ladderCommit === "up") {

                if (onLadder) {
                    this.applyMovement(g, 0, -1);
                    g.play("g-climb", true);
                    return;
                }

                g.ladderCommit = null;
            }

            if (g.ladderCommit === "down") {

                if (onLadder && ladderBelow) {
                    this.applyMovement(g, 0, 1);
                    g.play("g-climb", true);
                    return;
                }

                g.ladderCommit = null;
            }
        }
        // -------------------------------------------------
        // DROP FROM ROPE
        // -------------------------------------------------

        if (
            onRope &&
            runnerBelow &&
            !this.isSolid(gc.cx, gc.cy + 1)
        ) {
            this.applyMovement(g, 0, 1);
            g.play("g-fall", true);
            return;
        }

        // -------------------------------------------------
        // RUNNER ABOVE
        // -------------------------------------------------

        if (runnerAbove) {

            // already on ladder
            if (onLadder && ladderAbove) {

                g.ladderCommit = "up";
                wx = 0;
                wy = -1;
            }

            // move toward nearest usable upward path
            else {

                const target =
                    this.findNearestUsableLadder(
                        gc.cx,
                        gc.cy,
                        rc.cy
                    );

                if (target) {

                    const targetX =
                        cellToWorld(target.cx, target.cy).x;

                    // move toward target column
                    if (Math.abs(g.x - targetX) > 4) {

                        wx = targetX > g.x ? 1 : -1;
                        wy = 0;
                    }
                    else {

                        // snap into target column
                        g.x = targetX;

                        if (
                            target.type === "ladderUp" ||
                            target.type === "ladderDown"
                        ) {
                            g.ladderCommit = "up";
                            wx = 0;
                            wy = -1;
                        }
                        else {
                            wx = rc.cx < gc.cx ? -1 : 1;
                            wy = 0;
                        }
                    }
                }
                else {

                    // fallback horizontal chase
                    wx = rc.cx < gc.cx ? -1 : 1;
                    wy = 0;
                }
            }
        }

        // -------------------------------------------------
        // RUNNER BELOW
        // -------------------------------------------------

        else if (runnerBelow) {

            // If already on ladder and ladder continues down, descend
            if (ladderBelow) {
                g.x = cellToWorld(gc.cx, gc.cy).x;
                g.ladderCommit = "down";
                wx = 0;
                wy = 1;
            }

            // If on rope and can drop, drop
            else if (onRope && !this.isSolid(gc.cx, gc.cy + 1)) {
                wx = 0;
                wy = 1;
            }

            // Otherwise run toward nearest ladder down or dropoff
            else {
                const target = this.findNearestDownPath(gc.cx, gc.cy);

                if (target) {
                    const targetX = cellToWorld(target.cx, target.cy).x;

                    if (Math.abs(g.x - targetX) > 4) {
                        wx = targetX > g.x ? 1 : -1;
                        wy = 0;
                    } else {
                        g.x = targetX;

                        if (target.type === "ladderDown") {
                            g.ladderCommit = "down";
                            wx = 0;
                            wy = 1;
                        } else {
                            // dropoff
                            wx = 0;
                            wy = 1;
                        }
                    }
                } else {
                    wx = rc.cx < gc.cx ? -1 : 1;
                    wy = 0;
                }
            }
        }

        // -------------------------------------------------
        // SAME LEVEL
        // -------------------------------------------------

        else {

            wx = rc.cx < gc.cx ? -1 : 1;
            wy = 0;
        }

        // -------------------------------------------------
        // WALL AVOIDANCE / RETARGET
        // -------------------------------------------------

        if (wx !== 0) {
            const nextCx = gc.cx + wx;

            const blocked =
                this.isSolid(nextCx, gc.cy) ||
                !this.isWalkable(nextCx, gc.cy);

            if (blocked) {
                // If runner is below and guard is blocked,
                // seek a down ladder/dropoff in the other direction.
                if (runnerBelow) {
                    const oppositeTarget =
                        this.findNearestDownPathInDirection(
                            gc.cx,
                            gc.cy,
                            -wx
                        );

                    if (oppositeTarget) {
                        const targetX =
                            cellToWorld(oppositeTarget.cx, oppositeTarget.cy).x;

                        wx = targetX > g.x ? 1 : -1;
                        wy = 0;
                    } else {
                        wx = 0;
                    }
                } else {
                    wx = 0;
                }
            }
        }

        // -------------------------------------------------
        // APPLY
        // -------------------------------------------------

        this.applyMovement(g, wx, wy);

        // -------------------------------------------------
        // ANIMATION
        // -------------------------------------------------

        if (g.state === "fall") {
            g.play("g-fall", true);
        }
        else if (g.state === "climb") {
            g.play("g-climb", true);
        }
        else if (g.state === "rope") {
            g.play("g-rope", true);
        }
        else if (g.state === "run") {
            g.play("g-run", true);
        }
        else {
            g.play("g-stand", true);
        }
    }

    cellCenterX(cx) {
        return cx * TS + TS / 2;
    }

    cellCenterY(cy) {
        return cy * TS + TS / 2;
    }

    findNearestDownPath(cx, cy) {
        let best = null;
        let bestScore = Infinity;

        for (let x = 0; x < this.level.w; x++) {
            if (!this.canOccupy(x, cy)) continue;

            const ladderDown = this.isLadder(x, cy + 1);

            const dropoff =
                !this.isLadder(x, cy) &&
                this.hasSupportAt(x, cy) &&
                this.canOccupy(x, cy + 1) &&
                !this.isSolid(x, cy + 1);

            const ropeDrop =
                this.isRope(x, cy) &&
                this.canOccupy(x, cy + 1);

            if (!ladderDown && !dropoff && !ropeDrop) continue;

            const score = Math.abs(x - cx);

            if (score < bestScore) {
                bestScore = score;
                best = {
                    cx: x,
                    cy,
                    type: ladderDown ? "ladderDown" : "dropoff"
                };
            }
        }

        return best;
    }

    findNearestDownPathInDirection(cx, cy, dir) {
        let best = null;
        let bestScore = Infinity;

        for (let x = 0; x < this.level.w; x++) {
            if (dir < 0 && x >= cx) continue;
            if (dir > 0 && x <= cx) continue;

            if (!this.canOccupy(x, cy)) continue;

            const ladderDown = this.isLadder(x, cy + 1);

            const dropoff =
                !this.isLadder(x, cy) &&
                this.hasSupportAt(x, cy) &&
                this.canOccupy(x, cy + 1) &&
                !this.isSolid(x, cy + 1);

            const ropeDrop =
                this.isRope(x, cy) &&
                this.canOccupy(x, cy + 1);

            if (!ladderDown && !dropoff && !ropeDrop) continue;

            const score = Math.abs(x - cx);

            if (score < bestScore) {
                bestScore = score;
                best = {
                    cx: x,
                    cy,
                    type: ladderDown ? "ladderDown" : "dropoff"
                };
            }
        }

        return best;
    }

    findOpenSideAtLadderBase(cx, cy) {
        // Only applies if guard is on the bottom tile of a ladder
        if (!this.isLadder(cx, cy)) return 0;
        if (this.isLadder(cx, cy + 1)) return 0;

        const leftOpen =
            this.canOccupy(cx - 1, cy + 1) &&
            !this.isSolid(cx - 1, cy + 1);

        const rightOpen =
            this.canOccupy(cx + 1, cy + 1) &&
            !this.isSolid(cx + 1, cy + 1);

        if (leftOpen && !rightOpen) return -1;
        if (rightOpen && !leftOpen) return 1;

        if (leftOpen && rightOpen) {
            const rc = worldToCell(this.runner.x, this.runner.y);
            return rc.cx < cx ? -1 : 1;
        }

        return 0;
    }
    popUpIfInsideBrick(sprite) {

        const footY = sprite.y + TS * 0.45;

        const left = worldToCell(sprite.x - TS * 0.25, footY);
        const right = worldToCell(sprite.x + TS * 0.25, footY);

        const leftSolid = this.isSolid(left.cx, left.cy);
        const rightSolid = this.isSolid(right.cx, right.cy);

        // -----------------------------------------
        // FEET INSIDE BRICK -> POP UP
        // -----------------------------------------

        if (leftSolid || rightSolid) {

            const targetCy = Math.min(left.cy, right.cy) - 1;
            const target = cellToWorld(left.cx, targetCy);

            sprite.y = target.y;
            sprite.vy = 0;

            return true;
        }

        // -----------------------------------------
        // FEET SLIGHTLY ABOVE GROUND -> SNAP DOWN
        // -----------------------------------------

        const belowLeft = this.isSolid(left.cx, left.cy + 1);
        const belowRight = this.isSolid(right.cx, right.cy + 1);

        if (belowLeft || belowRight) {

            const currentCell = worldToCell(sprite.x, sprite.y);
            const center = cellToWorld(currentCell.cx, currentCell.cy);

            const groundTopY = (currentCell.cy + 1) * TS;

            // feet are hovering slightly above surface
            if (footY < groundTopY - 2) {

                sprite.y = center.y;
                sprite.vy = 0;

                return true;
            }
        }

        return false;
    }

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
        if (now < this.runner.digAnimUntil) {
            const c = worldToCell(this.runner.x, this.runner.y);
            const ctr = cellToWorld(c.cx, c.cy);
            this.runner.x = ctr.x;
            this.runner.y = ctr.y;
            this.runner.setFrame(this.runner.digDir < 0 ? 6 : 7);
        } else {
            // Normal movement
            this.applyMovement(this.runner, wx, wy);
            // runner animation by state
            const pc = worldToCell(this.runner.x, this.runner.y);
            const runnerOnRope = this.isRope(pc.cx, pc.cy);

            if (this.runner.state === 'fall') this.runner.play('r-fall', true);
            else if (this.runner.state === 'climb') this.runner.play('r-climb', true);
            else if (this.runner.state === 'run') this.runner.play('r-run', true);
            else if (this.runner.state === 'rope') this.runner.play('r-rope', true);
            else if (runnerOnRope) this.runner.setFrame(6);
            else this.runner.play('r-stand', true);
        }

        // Interactions
        this.collectGoldIfAny(this.runner);
        this.tryExit();

        // Guards
        this.guards.getChildren().forEach(g => this.moveGuard(g));
    }
}
