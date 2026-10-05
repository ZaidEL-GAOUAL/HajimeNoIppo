// Punch data. Frames refer to the source clips (60 fps), measured with dev/animprobe.html:
// `start` = gloves leave the guard, `impact` = full extension, `end` = back in guard.
// `speed` is the playback rate, so real startup = (impact - start) / 60 / speed seconds.

export const MOVES = {
    jab: {
        name: 'Body Jab',
        clip: 'jab', start: 10, impact: 30, end: 80, speed: 2.8,
        hand: 'left', zone: 'body',
        damage: 4, stamina: 5, guardDrain: 5, hitstun: 0.26, blockstun: 0.16, push: 0.6,
        range: 1.32, cancel: 0.05, sfx: 'jab', onomatopoeia: ['パン', 'ペチッ'],
    },
    straight: {
        name: 'Straight',
        clip: 'cross', start: 26, impact: 41, end: 76, speed: 1.55,
        hand: 'right', zone: 'head',
        damage: 8, stamina: 8, guardDrain: 9, hitstun: 0.36, blockstun: 0.22, push: 1.0,
        range: 1.12, cancel: 0.07, sfx: 'punch', onomatopoeia: ['バキッ', 'ドッ'],
    },
    hook: {
        name: 'Hook',
        clip: 'hook', start: 16, impact: 35, end: 82, speed: 1.5,
        hand: 'left', zone: 'head',
        damage: 12, stamina: 11, guardDrain: 13, hitstun: 0.48, blockstun: 0.26, push: 1.3,
        range: 1.06, cancel: 0.09, sfx: 'punch', onomatopoeia: ['ドゴッ', 'バキィ'],
    },
    uppercut: {
        name: 'Uppercut',
        clip: 'uppercut', start: 20, impact: 46, end: 92, speed: 1.6,
        hand: 'left', zone: 'head',
        damage: 15, stamina: 14, guardDrain: 16, hitstun: 0.62, blockstun: 0.3, push: 1.6,
        range: 1.06, cancel: 0.12, sfx: 'heavy', onomatopoeia: ['ズドン', 'ガゴッ'],
        launcher: true,
    },
    body: {
        name: 'Body Blow',
        clip: 'body', start: 14, impact: 40, end: 88, speed: 1.75,
        hand: 'right', zone: 'body',
        damage: 10, stamina: 11, guardDrain: 18, hitstun: 0.5, blockstun: 0.28, push: 1.1,
        range: 1.08, cancel: 0.09, sfx: 'body', onomatopoeia: ['ドスッ', 'ズンッ'],
        staminaDamage: 14,
    },
};

export const PUNCH_IDS = Object.keys(MOVES);

/** Seconds from move start to the impact frame at a given speed multiplier. */
export function impactTime(move, speedMul = 1) {
    return (move.impact - move.start) / 60 / (move.speed * speedMul);
}

/** Seconds from move start back to guard at a given speed multiplier. */
export function totalTime(move, speedMul = 1) {
    return (move.end - move.start) / 60 / (move.speed * speedMul);
}

// Reaction / movement clip windows (frames in source clips).
export const CLIPS = {
    idle: { clip: 'stance2', loop: true },
    stepForward: { clip: 'stepForward', loop: true },
    stepBack: { clip: 'stepBack', loop: true },
    pivotLeft: { clip: 'pivotLeft', loop: true },
    pivotRight: { clip: 'pivotRight', loop: true },
    hitHead: { clip: 'hitHead', start: 0, end: 48 },
    hitBody: { clip: 'hitBody', start: 4, end: 64 },
    duck: { clip: 'dodge', start: 2, end: 40 },
    warmup: { clip: 'warmup', loop: true },
};
