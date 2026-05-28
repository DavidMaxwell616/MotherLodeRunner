export const TS = 32;

// Tile indices in tiles.png (8 tiles in a row)
export const TILE = {
    EMPTY: 0,
    BRICK: 1,
    SOLID: 2,
    LADDER: 3,
    ROPE: 4,
    GOLD: 5,
    HOLE: 6,
    EXIT: 7
};

export const THEMES = [
    "APPLE2",
    "C64",
    "MAX",
    "PC"
]

export const LEVEL_TYPES = [
    'classic_levels',
    'championship_levels',
    'fanBookMod_levels',
    'professional_levels',
    'revenge_levels'
]

export const DIG_COOLDOWN_MS = 350;
export const DIG_ANIM_MS = 260;
export const HOLE_LIFETIME_MS = 4200;

export const GUARD_TRAP_MS = 900;
export const GUARD_RESPAWN_MS = 700;
export const GUARD_PANIC_ANIM_RATE = 14;