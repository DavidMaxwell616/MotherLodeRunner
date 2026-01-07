const TILE = 32;
const SCALE = 3;

// Apple II-ish palette (lo-fi approximation)
const PAL = {
    bg: 0x000000,
    brick: 0x8b3f2f,
    solid: 0x5a5a5a,
    ladder: 0x00ff66,
    rope: 0xffcc00,
    gold: 0xffff66,
    player: 0x66aaff,
    enemy: 0xff4466,
    exitLocked: 0x3333aa,
    exitOpen: 0x66ffcc,
    ui: 0xffffff
};

// Tile codes
const T = {
    EMPTY: ' ',
    SOLID: '#',     // solid steel
    BRICK: 'B',     // diggable bricks
    LADDER: 'H',
    ROPE: '-',
    GOLD: '$',
    PLAYER: 'P',
    ENEMY: 'E',
    EXIT: 'X'
};

// Timings (tune these to taste)
const DIG_COOLDOWN = 0.20;     // seconds between digs
const HOLE_OPEN_TIME = 3.0;    // seconds until brick regens
const ENEMY_TRAP_TIME = 2.0;   // seconds an enemy is stuck before "climbing out"

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

class LRScene extends Phaser.Scene {
    constructor() {
        super('LR');
        this.mapW = 0;
        this.mapH = 0;
        this.grid = [];
        this.goldLeft = 0;
        this.exitOpen = false;

        // holes map: key "x,y" => {x,y, tLeft}
        this.holes = new Map();
    }

    preload() {
        this.load.json('championship_levels', '../assets/levels/json/championship_levels.json');
        this.load.json('classic_levels', '../assets/levels/json/classic_levels.json');
        this.load.json('fanBookMod_levels', '../assets/levels/json/fanBookMod_levels.json');
        this.load.json('professional_levels', '../assets/levels/json/professional_levels.json');
        this.load.json('revenge_levels', '../assets/levels/json/revenge_levels.json');
    }

    create() {
        this.cameras.main.setBackgroundColor(PAL.bg);
        const data = this.cache.json.get('classic_levels');

        const LEVEL_1 = data.classicData[0];
        this.loadLevel(LEVEL_1);

        // Generate pixel tilesheet dynamically
        this.makeTilesTexture();

        // Render tiles
        this.tileSprites = [];
        this.renderAllTiles();

        // Actors
        this.player = this.createActor(this.spawnPlayer.x, this.spawnPlayer.y, 'player');
        this.player.spawn = { ...this.spawnPlayer };

        this.enemies = this.spawnEnemies.map(p => {
            const e = this.createActor(p.x, p.y, 'enemy');
            e.spawn = { ...p };
            return e;
        });

        // UI
        this.uiText = this.add.text(8, 6, "", {
            fontFamily: 'monospace',
            fontSize: `${12 * SCALE}px`,
            color: '#ffffff'
        }).setScrollFactor(0).setOrigin(0, 0).setScale(1 / SCALE);

        // Input
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyZ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
        this.keyX = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);

        // Player params
        this.player.speed = 90;
        this.player.climbSpeed = 85;
        this.player.gravity = 420;
        this.player.vx = 0;
        this.player.vy = 0;
        this.player.digCooldown = 0;

        // Enemy params
        for (const e of this.enemies) {
            e.speed = 70;
            e.climbSpeed = 70;
            e.gravity = 420;
            e.vx = 0;
            e.vy = 0;
            e.thinkT = 0;
            e.trapped = false;
            e.trapT = 0;
        }

        // Camera sizing: pixel perfect
        const pxW = this.mapW * TILE;
        const pxH = this.mapH * TILE;
        this.scale.resize(pxW * SCALE, pxH * SCALE);
        this.cameras.main.setBounds(0, 0, pxW, pxH);
        this.cameras.main.setZoom(SCALE);

        this.updateUI();
    }

    update(_, dtMs) {
        const dt = dtMs / 1000;

        // holes timers + regen
        this.updateHoles(dt);

        this.updatePlayer(dt);
        for (const e of this.enemies) this.updateEnemy(e, dt);

        // enemy collision with player
        for (const e of this.enemies) {
            if (Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), e.getBounds())) {
                this.scene.restart();
                return;
            }
        }

        this.updateUI();
    }

    // ------------------------
    // Level / Tiles
    // ------------------------
    loadLevel(lines) {
        this.mapH = lines.length;
        this.mapW = lines[0].length;
        this.grid = [];
        this.goldLeft = 0;
        this.exitOpen = false;
        this.holes = new Map();

        this.spawnPlayer = { x: 1, y: 1 };
        this.spawnEnemies = [];
        this.exitPos = { x: -1, y: -1 };

        for (let y = 0; y < this.mapH; y++) {
            const row = [];
            for (let x = 0; x < this.mapW; x++) {
                const ch = lines[y][x] ?? T.EMPTY;

                if (ch === T.PLAYER) this.spawnPlayer = { x, y };
                if (ch === T.ENEMY) this.spawnEnemies.push({ x, y });
                if (ch === T.GOLD) this.goldLeft++;
                if (ch === T.EXIT) this.exitPos = { x, y };

                row.push((ch === T.PLAYER || ch === T.ENEMY) ? T.EMPTY : ch);
            }
            this.grid.push(row);
        }
    }

    makeTilesTexture() {
        const key = 'tiles';
        if (this.textures.exists(key)) return;

        const w = TILE * 8;
        const h = TILE;
        const rt = this.make.renderTexture({ width: w, height: h }, false);
        rt.fill(PAL.bg);

        const drawTile = (i, fn) => {
            const x0 = i * TILE;
            const g = this.add.graphics();
            g.clear();
            fn(g, x0, 0);
            rt.draw(g);
            g.destroy();
        };

        // 0 EMPTY
        drawTile(0, (g, x0, y0) => {
            g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE);
        });

        // 1 SOLID
        drawTile(1, (g, x0, y0) => {
            g.fillStyle(PAL.solid).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(0x2a2a2a).fillRect(x0, y0, TILE, 3);
            g.fillStyle(0x808080).fillRect(x0, y0 + TILE - 3, TILE, 3);
        });

        // 2 BRICK
        drawTile(2, (g, x0, y0) => {
            g.fillStyle(PAL.brick).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(0x5a241b);
            for (let y = 3; y < TILE; y += 6) g.fillRect(x0, y0 + y, TILE, 1);
            for (let x = 4; x < TILE; x += 8) g.fillRect(x0 + x, y0, 1, TILE);
        });

        // 3 LADDER
        drawTile(3, (g, x0, y0) => {
            g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(PAL.ladder);
            g.fillRect(x0 + 4, y0 + 1, 2, TILE - 2);
            g.fillRect(x0 + TILE - 6, y0 + 1, 2, TILE - 2);
            for (let y = 3; y < TILE; y += 4) g.fillRect(x0 + 3, y0 + y, TILE - 6, 1);
        });

        // 4 ROPE
        drawTile(4, (g, x0, y0) => {
            g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(PAL.rope);
            g.fillRect(x0, y0 + 7, TILE, 2);
            g.fillStyle(0xaa8800).fillRect(x0, y0 + 9, TILE, 1);
        });

        // 5 GOLD
        drawTile(5, (g, x0, y0) => {
            g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(PAL.gold);
            g.fillRect(x0 + 5, y0 + 5, 6, 6);
            g.fillStyle(0xcccc44);
            g.fillRect(x0 + 6, y0 + 6, 4, 4);
        });

        // 6 EXIT (tinted locked/open)
        drawTile(6, (g, x0, y0) => {
            g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE);
            g.fillStyle(PAL.exitLocked);
            g.fillRect(x0 + 3, y0 + 2, TILE - 6, TILE - 4);
            g.fillStyle(0x000000);
            g.fillRect(x0 + 6, y0 + 5, 2, 2);
        });

        // 7 reserved
        drawTile(7, (g, x0, y0) => g.fillStyle(PAL.bg).fillRect(x0, y0, TILE, TILE));

        rt.saveTexture(key);
        rt.destroy();
    }

    tileIndexFor(ch) {
        switch (ch) {
            case T.SOLID: return 1;
            case T.BRICK: return 2;
            case T.LADDER: return 3;
            case T.ROPE: return 4;
            case T.GOLD: return 5;
            case T.EXIT: return 6;
            default: return 0;
        }
    }

    renderAllTiles() {
        for (const s of this.tileSprites) s.destroy();
        this.tileSprites = [];

        for (let y = 0; y < this.mapH; y++) {
            for (let x = 0; x < this.mapW; x++) {
                const ch = this.grid[y][x];
                const idx = this.tileIndexFor(ch);
                if (idx === 0) continue;

                const spr = this.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, 'tiles', idx)
                    .setOrigin(0.5, 0.5);

                if (ch === T.EXIT) spr.setTint(this.exitOpen ? PAL.exitOpen : PAL.exitLocked);

                this.tileSprites.push(spr);
            }
        }
    }

    setTile(x, y, ch) {
        if (x < 0 || y < 0 || x >= this.mapW || y >= this.mapH) return;
        this.grid[y][x] = ch;
        this.renderAllTiles();
    }

    getTile(x, y) {
        if (x < 0 || y < 0 || x >= this.mapW || y >= this.mapH) return T.SOLID;
        return this.grid[y][x];
    }

    // ------------------------
    // Actors
    // ------------------------
    createActor(tx, ty, kind) {
        const color = (kind === 'player') ? PAL.player : PAL.enemy;

        const key = `${kind}_tex`;
        if (!this.textures.exists(key)) {
            const g = this.add.graphics();
            g.fillStyle(color);
            g.fillRect(2, 2, TILE - 4, TILE - 4);

            const rt = this.make.renderTexture({ width: TILE, height: TILE }, false);
            rt.draw(g, 0, 0);
            rt.saveTexture(key);
            rt.destroy();
            g.destroy();
        }

        const s = this.add.sprite(tx * TILE + TILE / 2, ty * TILE + TILE / 2, key);
        s.kind = kind;
        s.bodyW = TILE * 0.75;
        s.bodyH = TILE * 0.85;
        return s;
    }

    actorTilePos(a) {
        return { x: Math.floor(a.x / TILE), y: Math.floor(a.y / TILE) };
    }

    // ------------------------
    // Tile Rules
    // ------------------------
    isSolid(ch) { return (ch === T.SOLID); }
    isBrick(ch) { return (ch === T.BRICK); }
    isPlatform(ch) { return (ch === T.BRICK || ch === T.SOLID); } // stops fall
    isClimbable(ch) { return (ch === T.LADDER); }
    isRope(ch) { return (ch === T.ROPE); }
    isGold(ch) { return (ch === T.GOLD); }
    isExit(ch) { return (ch === T.EXIT); }

    hasSupportBelow(a) {
        const bottom = a.y + (a.bodyH / 2);
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(bottom / TILE);

        const below = this.getTile(tx, ty);
        const here = this.getTile(tx, Math.floor(a.y / TILE));
        return this.isPlatform(below) || this.isClimbable(here);
    }

    canClimbAt(a) {
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        return this.isClimbable(this.getTile(tx, ty));
    }

    onRope(a) {
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        return this.isRope(this.getTile(tx, ty));
    }

    // ------------------------
    // Collision (platforms only)
    // ------------------------
    resolveCollisions(a) {
        a.x = clamp(a.x, a.bodyW / 2, this.mapW * TILE - a.bodyW / 2);
        a.y = clamp(a.y, a.bodyH / 2, this.mapH * TILE - a.bodyH / 2);

        const left = a.x - a.bodyW / 2;
        const right = a.x + a.bodyW / 2;
        const top = a.y - a.bodyH / 2;
        const bottom = a.y + a.bodyH / 2;

        let tx0 = Math.floor(left / TILE);
        let tx1 = Math.floor(right / TILE);
        let ty0 = Math.floor(top / TILE);
        let ty1 = Math.floor(bottom / TILE);

        // Y floor
        if (a.vy > 0) {
            const ty = Math.floor(bottom / TILE);
            for (let tx = tx0; tx <= tx1; tx++) {
                const ch = this.getTile(tx, ty);
                if (this.isPlatform(ch)) {
                    const tileTop = ty * TILE;
                    const newY = tileTop - a.bodyH / 2;
                    if (a.y > newY) {
                        a.y = newY;
                        a.vy = 0;
                    }
                }
            }
        }
        // Y ceiling
        if (a.vy < 0) {
            const ty = Math.floor(top / TILE);
            for (let tx = tx0; tx <= tx1; tx++) {
                const ch = this.getTile(tx, ty);
                if (this.isPlatform(ch)) {
                    const tileBottom = (ty + 1) * TILE;
                    const newY = tileBottom + a.bodyH / 2;
                    if (a.y < newY) {
                        a.y = newY;
                        a.vy = 0;
                    }
                }
            }
        }

        // Recompute after Y
        const left2 = a.x - a.bodyW / 2;
        const right2 = a.x + a.bodyW / 2;
        const top2 = a.y - a.bodyH / 2;
        const bottom2 = a.y + a.bodyH / 2;

        tx0 = Math.floor(left2 / TILE);
        tx1 = Math.floor(right2 / TILE);
        ty0 = Math.floor(top2 / TILE);
        ty1 = Math.floor(bottom2 / TILE);

        // X right wall
        if (a.vx > 0) {
            const tx = Math.floor(right2 / TILE);
            for (let ty = ty0; ty <= ty1; ty++) {
                const ch = this.getTile(tx, ty);
                if (this.isPlatform(ch)) {
                    const tileLeft = tx * TILE;
                    const newX = tileLeft - a.bodyW / 2;
                    if (a.x > newX) {
                        a.x = newX;
                        a.vx = 0;
                    }
                }
            }
        }
        // X left wall
        if (a.vx < 0) {
            const tx = Math.floor(left2 / TILE);
            for (let ty = ty0; ty <= ty1; ty++) {
                const ch = this.getTile(tx, ty);
                if (this.isPlatform(ch)) {
                    const tileRight = (tx + 1) * TILE;
                    const newX = tileRight + a.bodyW / 2;
                    if (a.x < newX) {
                        a.x = newX;
                        a.vx = 0;
                    }
                }
            }
        }
    }

    // ------------------------
    // Digging + holes
    // ------------------------
    holeKey(x, y) { return `${x},${y}`; }

    tryDig(dir /* -1 or +1 */) {
        const p = this.player;
        if (p.digCooldown > 0) return;

        // Classic-ish constraint: must be standing on support (not falling)
        if (!this.hasSupportBelow(p)) return;

        const pt = this.actorTilePos(p);

        const targetX = pt.x + dir;
        const targetY = pt.y + 1;

        // The dig target is a brick diagonally below-left/right
        const target = this.getTile(targetX, targetY);
        if (!this.isBrick(target)) return;

        // Can't dig solid, exit, etc — only bricks
        // Also: optional rule: cannot dig if something "blocks" it; we keep simple.

        // Make hole
        this.setTile(targetX, targetY, T.EMPTY);
        this.holes.set(this.holeKey(targetX, targetY), { x: targetX, y: targetY, tLeft: HOLE_OPEN_TIME });

        p.digCooldown = DIG_COOLDOWN;
    }

    updateHoles(dt) {
        // decrement dig cooldown
        this.player.digCooldown = Math.max(0, this.player.digCooldown - dt);

        if (this.holes.size === 0) return;

        let changed = false;

        for (const [key, h] of this.holes.entries()) {
            h.tLeft -= dt;
            if (h.tLeft <= 0) {
                // Regen brick
                // If an enemy is currently occupying this tile, "crush/respawn" them
                for (const e of this.enemies) {
                    const et = this.actorTilePos(e);
                    if (et.x === h.x && et.y === h.y) {
                        this.respawnEnemy(e);
                    }
                }
                // Player standing in regen tile: push up slightly (avoid softlock)
                const pt = this.actorTilePos(this.player);
                if (pt.x === h.x && pt.y === h.y) {
                    this.player.y = (h.y * TILE) - (this.player.bodyH / 2) - 1;
                    this.player.vy = 0;
                }

                this.grid[h.y][h.x] = T.BRICK;
                this.holes.delete(key);
                changed = true;
            }
        }

        if (changed) this.renderAllTiles();
    }

    respawnEnemy(e) {
        e.x = e.spawn.x * TILE + TILE / 2;
        e.y = e.spawn.y * TILE + TILE / 2;
        e.vx = 0;
        e.vy = 0;
        e.trapped = false;
        e.trapT = 0;
        e.thinkT = 0;
    }

    // ------------------------
    // Player update
    // ------------------------
    updatePlayer(dt) {
        const a = this.player;

        // Dig input
        if (Phaser.Input.Keyboard.JustDown(this.keyZ)) this.tryDig(-1);
        if (Phaser.Input.Keyboard.JustDown(this.keyX)) this.tryDig(+1);

        const left = this.cursors.left.isDown;
        const right = this.cursors.right.isDown;
        const up = this.cursors.up.isDown;
        const down = this.cursors.down.isDown;

        const canClimb = this.canClimbAt(a);
        const onRope = this.onRope(a);

        // Horizontal
        a.vx = 0;
        if (left) a.vx = -a.speed;
        if (right) a.vx = a.speed;

        // Vertical
        if (canClimb) {
            if (up) a.vy = -a.climbSpeed;
            else if (down) a.vy = a.climbSpeed;
            else a.vy = 0;
        } else {
            if (onRope && !down) {
                const ty = Math.floor(a.y / TILE);
                const ropeY = ty * TILE + TILE / 2;
                a.y = Phaser.Math.Linear(a.y, ropeY, 0.35);
                a.vy = 0;
            } else {
                if (!this.hasSupportBelow(a)) a.vy += a.gravity * dt;
                else a.vy = Math.min(a.vy, 0);
            }
        }

        // Integrate + collide
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        this.resolveCollisions(a);

        // Gold pickup + exit unlock
        this.tryPickupGold(a);

        // Win condition
        if (this.exitOpen && this.isExitAtActor(a)) {
            this.scene.restart();
            return;
        }
    }

    tryPickupGold(a) {
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        if (this.isGold(this.getTile(tx, ty))) {
            this.setTile(tx, ty, T.EMPTY);
            this.goldLeft = Math.max(0, this.goldLeft - 1);
            if (this.goldLeft === 0) {
                this.exitOpen = true;
                this.renderAllTiles();
            }
        }
    }

    isExitAtActor(a) {
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        return this.isExit(this.getTile(tx, ty));
    }

    // ------------------------
    // Enemy update (AI + trapping)
    // ------------------------
    updateEnemy(e, dt) {
        // If trapped in hole: countdown then "climb out" (simple teleport up one tile if possible)
        if (e.trapped) {
            e.vx = 0;
            e.vy = 0;
            e.trapT -= dt;

            if (e.trapT <= 0) {
                e.trapped = false;
                // attempt to exit: move up one tile (if empty/ladder/rope/gold/exit)
                const et = this.actorTilePos(e);
                const above = this.getTile(et.x, et.y - 1);
                if (!this.isPlatform(above)) {
                    e.y = (et.y - 1) * TILE + TILE / 2;
                } else {
                    // if blocked, just respawn (keeps things moving)
                    this.respawnEnemy(e);
                }
            }
            return;
        }

        // Normal AI think
        e.thinkT -= dt;
        if (e.thinkT <= 0) {
            e.thinkT = 0.15 + Math.random() * 0.1;
            this.enemyThink(e);
        }

        const canClimb = this.canClimbAt(e);
        const onRope = this.onRope(e);

        if (!canClimb) {
            if (onRope && e.wantHang) {
                const ty = Math.floor(e.y / TILE);
                const ropeY = ty * TILE + TILE / 2;
                e.y = Phaser.Math.Linear(e.y, ropeY, 0.25);
                e.vy = 0;
            } else {
                if (!this.hasSupportBelow(e)) e.vy += e.gravity * dt;
                else e.vy = Math.min(e.vy, 0);
            }
        }

        // Integrate + collide
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        this.resolveCollisions(e);

        // Check if enemy fell into a hole tile (tile is empty AND was dug by us)
        this.checkEnemyHoleTrap(e);
    }

    checkEnemyHoleTrap(e) {
        const et = this.actorTilePos(e);
        const key = this.holeKey(et.x, et.y);
        if (this.holes.has(key)) {
            // Snap enemy into hole center and trap
            e.x = et.x * TILE + TILE / 2;
            e.y = et.y * TILE + TILE / 2;
            e.vx = 0;
            e.vy = 0;
            e.trapped = true;
            e.trapT = ENEMY_TRAP_TIME;
        }
    }

    enemyThink(e) {
        const p = this.player;
        const et = this.actorTilePos(e);
        const pt = this.actorTilePos(p);

        const here = this.getTile(et.x, et.y);
        const canClimb = this.isClimbable(here);
        const onRope = this.isRope(here);

        const dx = pt.x - et.x;
        const dy = pt.y - et.y;

        e.vx = 0;
        e.wantHang = false;

        // Prefer climbing if aligned and on ladder
        if (canClimb && Math.abs(dx) <= 1 && dy !== 0) {
            e.vy = (dy < 0) ? -e.climbSpeed : e.climbSpeed;
            e.vx = 0;
            return;
        }

        // Rope: chase horizontally, hang
        if (onRope) {
            e.wantHang = true;
            if (dx < 0) e.vx = -e.speed;
            else if (dx > 0) e.vx = e.speed;
            else e.vx = 0;

            // drop if player below near same column
            if (dy > 0 && Math.abs(dx) <= 1) e.wantHang = false;
            return;
        }

        // Ladder: sometimes climb toward player row
        if (canClimb && dy !== 0 && Math.random() < 0.65) {
            e.vy = (dy < 0) ? -e.climbSpeed : e.climbSpeed;
            e.vx = 0;
            return;
        }

        // Otherwise horizontal chase
        if (dx < 0) e.vx = -e.speed;
        else if (dx > 0) e.vx = e.speed;
        else e.vx = 0;

        // If next tile is platform, bounce
        const step = (e.vx < 0) ? -1 : (e.vx > 0 ? 1 : 0);
        if (step !== 0) {
            const nx = et.x + step;
            const chAhead = this.getTile(nx, et.y);
            if (this.isPlatform(chAhead)) e.vx = -e.vx;
        }
    }

    // ------------------------
    // UI
    // ------------------------
    updateUI() {
        const status = this.exitOpen ? "EXIT OPEN" : "Collect all gold";
        this.uiText.setText(
            `Gold: ${this.goldLeft}   ${status}   (Arrows move, Z/X dig)`
        );
    }
}

const config = {
    type: Phaser.AUTO,
    width: 28 * TILE * SCALE,
    height: 18 * TILE * SCALE,
    backgroundColor: '#000000',
    pixelArt: true,
    scene: [LRScene]
};

new Phaser.Game(config);