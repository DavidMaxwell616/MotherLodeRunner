const TS = 32;

// tiles.png frames
const TILE = {
    EMPTY: 0,
    BRICK: 1,
    SOLID: 2,
    LADDER: 3,
    ROPE: 4,
    GOLD: 5,
    HOLE: 6,
    EXIT: 7
};
const DIG_COOLDOWN = 350;
const HOLE_LIFE = 4200;
const GUARD_TRAP = 900;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const worldToCell = (x, y) => ({ cx: Math.floor(x / TS), cy: Math.floor(y / TS) });
const cellToWorld = (cx, cy) => ({ x: cx * TS + TS / 2, y: cy * TS + TS / 2 });

function parseLevel(lines) {
    const data = [];
    let playerSpawn = { x: 1, y: 1 };
    const guards = [];
    let gold = 0;

    lines.forEach((row, y) => {
        data[y] = [];
        [...row].forEach((c, x) => {
            let t = TILE.EMPTY;
            if (c === '#') t = TILE.BRICK;
            else if (c === 'X') t = TILE.SOLID;
            else if (c === 'H') t = TILE.LADDER;
            else if (c === '-') t = TILE.ROPE;
            else if (c === '$') { t = TILE.GOLD; gold++; }
            else if (c === 'E') t = TILE.EXIT;
            else if (c === '&') playerSpawn = { x, y };
            else if (c === '0') guards.push({ x, y });
            data[y][x] = t;
        });
    });

    return { data, playerSpawn, guards, gold };
}

export default class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
        this.levelIndex = 0;
        this.holes = new Map();
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
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyZ = this.input.keyboard.addKey('Z');
        this.keyX = this.input.keyboard.addKey('X');
        this.keyR = this.input.keyboard.addKey('R');

        this.hud = this.add.text(8, 6, '', {
            fontFamily: 'monospace',
            fontSize: 16,
            color: '#9ff'
        });

        this.startLevel(this.levelIndex);
    }

    startLevel(idx) {
        //this.levelIndex = (idx + LEVELS.length) % LEVELS.length;
        if (this.map) this.map.destroy();
        if (this.player) this.player.destroy();
        if (this.guards) this.guards.clear(true, true);
        this.holes.clear();
        const data = this.cache.json.get('classic_levels');
        this.level = parseLevel(data.classicData[0]);
        this.goldLeft = this.level.gold;
        this.exitUnlocked = false;

        this.map = this.make.tilemap({
            data: this.level.data,
            tileWidth: TS,
            tileHeight: TS
        });

        const tiles = this.map.addTilesetImage('tiles');
        this.layer = this.map.createLayer(0, tiles, 0, 0);
        this.layer.setCollision([TILE.SOLID, TILE.BRICK]);

        const p = cellToWorld(this.level.playerSpawn.x, this.level.playerSpawn.y);
        this.player = this.physics.add.sprite(p.x, p.y, 'player', 0);
        this.player.body.setSize(32, 32).setOffset(2, 1);
        this.player.speed = 92;
        this.player.climb = 84;
        this.player.vy = 0;
        this.player.digLock = 0;

        this.guards = this.add.group();
        this.level.guards.forEach(g => {
            const w = cellToWorld(g.x, g.y);
            const s = this.physics.add.sprite(w.x, w.y, 'guard', 0);
            s.body.setSize(TS, TS).setOffset(2, 1);
            s.speed = 70;
            s.climb = 66;
            s.vy = 0;
            s.stunUntil = 0;
            s.nextPathAt = 0;
            this.guards.add(s);
        });

        this.physics.add.collider(this.player, this.layer);
        this.physics.add.collider(this.guards, this.layer);

        this.physics.add.overlap(this.player, this.guards, () => {
            this.startLevel(this.levelIndex);
        });

        this.updateHUD();
    }

    updateHUD() {
        this.hud.setText(
            `LEVEL ${this.levelIndex + 1}  GOLD ${this.goldLeft} ${this.exitUnlocked ? 'EXIT!' : ''}`
        );
    }

    tileAt(cx, cy) {
        if (cy < 0 || cx < 0 || cy >= this.level.data.length || cx >= this.level.data[0].length)
            return TILE.SOLID;
        return this.level.data[cy][cx];
    }

    setTile(cx, cy, t) {
        this.level.data[cy][cx] = t;
        this.layer.putTileAt(t, cx, cy);
        this.layer.setCollision([TILE.SOLID, TILE.BRICK]);
    }

    isWalkable(cx, cy) {
        const t = this.tileAt(cx, cy);
        return t !== TILE.SOLID && t !== TILE.BRICK;
    }

    isLadder(cx, cy) { return this.tileAt(cx, cy) === TILE.LADDER; }
    isRope(cx, cy) { return this.tileAt(cx, cy) === TILE.ROPE; }

    hasSupport(cx, cy) {
        return (
            this.isLadder(cx, cy) ||
            this.isRope(cx, cy) ||
            this.tileAt(cx, cy + 1) === TILE.SOLID ||
            this.tileAt(cx, cy + 1) === TILE.BRICK
        );
    }

    // ---------- BFS PATHFINDING ----------
    neighbors(cx, cy) {
        const out = [];
        const supported = this.hasSupport(cx, cy);
        const onLadder = this.isLadder(cx, cy);

        if (!supported && !onLadder) {
            if (this.isWalkable(cx, cy + 1)) out.push({ cx, cy: cy + 1 });
            return out;
        }

        if (this.isWalkable(cx - 1, cy)) out.push({ cx: cx - 1, cy });
        if (this.isWalkable(cx + 1, cy)) out.push({ cx: cx + 1, cy });

        if (onLadder && this.isWalkable(cx, cy - 1)) out.push({ cx, cy: cy - 1 });
        if ((onLadder || supported) && this.isWalkable(cx, cy + 1) && this.isLadder(cx, cy + 1))
            out.push({ cx, cy: cy + 1 });

        return out;
    }

    bfs(start, goal) {
        const q = [start];
        const came = new Map();
        const key = (c) => `${c.cx},${c.cy}`;
        came.set(key(start), null);

        while (q.length) {
            const cur = q.shift();
            if (cur.cx === goal.cx && cur.cy === goal.cy) break;
            for (const n of this.neighbors(cur.cx, cur.cy)) {
                const k = key(n);
                if (!came.has(k)) {
                    came.set(k, cur);
                    q.push(n);
                }
            }
        }

        let step = goal;
        while (came.get(key(step)) && came.get(key(step)) !== start) {
            step = came.get(key(step));
        }
        return step;
    }

    updateGuard(g) {
        const now = this.time.now;
        if (now < g.stunUntil) return;

        const gc = worldToCell(g.x, g.y);
        if (this.tileAt(gc.cx, gc.cy) === TILE.HOLE) {
            g.stunUntil = now + GUARD_TRAP;
            return;
        }

        if (now > g.nextPathAt) {
            const pc = worldToCell(this.player.x, this.player.y);
            g.nextStep = this.bfs(gc, pc);
            g.nextPathAt = now + 180;
        }

        let wx = 0, wy = 0;
        if (g.nextStep) {
            wx = Math.sign(g.nextStep.cx - gc.cx);
            wy = Math.sign(g.nextStep.cy - gc.cy);
            if (wx && wy) wy = 0;
        }

        this.applyMovement(g, wx, wy);
    }

    applyMovement(s, wx, wy) {
        const dt = this.game.loop.delta / 1000;
        const c = worldToCell(s.x, s.y);

        if (!this.hasSupport(c.cx, c.cy) && !this.isLadder(c.cx, c.cy)) {
            s.vy = clamp(s.vy + 650 * dt, 0, 165);
        } else {
            s.vy = 0;
        }

        if (wx && this.isWalkable(c.cx + wx, c.cy))
            s.x += wx * s.speed * dt;

        if (wy && this.isLadder(c.cx, c.cy))
            s.y += wy * s.climb * dt;

        if (s.vy) s.y += s.vy * dt;

        const cc = worldToCell(s.x, s.y);
        const ctr = cellToWorld(cc.cx, cc.cy);
        s.x += (ctr.x - s.x) * 0.1;
        s.y += (ctr.y - s.y) * 0.06;
    }

    update() {
        if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
            this.startLevel(this.levelIndex);
            return;
        }

        let wx = 0, wy = 0;
        if (this.cursors.left.isDown) wx = -1;
        else if (this.cursors.right.isDown) wx = 1;
        if (this.cursors.up.isDown) wy = -1;
        else if (this.cursors.down.isDown) wy = 1;

        this.applyMovement(this.player, wx, wy);

        this.guards.getChildren().forEach(g => this.updateGuard(g));
    }
}
