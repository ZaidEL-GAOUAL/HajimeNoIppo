// Keyboard + gamepad input. Keys are matched by physical position (event.code), so the same
// bindings work on AZERTY (ZQSD) and QWERTY (WASD) keyboards.

export const ACTIONS = ['jab', 'straight', 'hook', 'uppercut', 'body', 'guard', 'dodge', 'special'];

const MOVE_KEYS = {
    wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
    arrows: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
    both: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] },
};

export const BINDINGS = {
    solo: [{
        move: MOVE_KEYS.both,
        jab: ['KeyJ'], straight: ['KeyK'], hook: ['KeyU'], uppercut: ['KeyI'], body: ['KeyL'],
        guard: ['Space'], dodge: ['ShiftLeft', 'KeyO'], special: ['KeyE', 'KeyP'],
    }],
    versus: [
        {
            move: MOVE_KEYS.wasd,
            jab: ['KeyF'], straight: ['KeyG'], hook: ['KeyR'], uppercut: ['KeyT'], body: ['KeyH'],
            guard: ['Space'], dodge: ['ShiftLeft'], special: ['KeyE', 'KeyY'],
        },
        {
            move: MOVE_KEYS.arrows,
            jab: ['Numpad4', 'KeyJ'], straight: ['Numpad5', 'KeyK'], hook: ['Numpad7', 'KeyU'], uppercut: ['Numpad8', 'KeyI'],
            body: ['Numpad6', 'KeyL'], guard: ['Numpad0', 'KeyN'], dodge: ['NumpadDecimal', 'Numpad1', 'KeyO'], special: ['Numpad9', 'KeyP'],
        },
    ],
};

// Standard gamepad mapping.
export const PAD = {
    jab: [2], straight: [3], hook: [1], uppercut: [0], body: [5], guard: [4, 6], dodge: [7], special: [11, 10],
};
const PAD_PAUSE = 9;
const PAD_CAMERA = 8;
const PAD_DPAD = { up: 12, down: 13, left: 14, right: 15 };
const DEADZONE = 0.28;

const MENU_KEYS = {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyJ', 'KeyF'], back: ['Escape', 'Backspace', 'KeyK', 'KeyG'],
};
const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
    constructor() {
        this.mode = 'solo';
        this.keys = new Set();
        this.queues = [[], []];
        this.menuQueue = [];
        this.globalQueue = [];
        this.padState = new Map();
        this.padRepeat = new Map();
        this.anyPressed = false;
        this.layout = null;
        this.onFirstGesture = null;

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
        window.addEventListener('pointerdown', () => this.gesture());
        navigator.keyboard?.getLayoutMap?.().then((map) => { this.layout = map; }).catch(() => {});
    }

    gesture() {
        this.anyPressed = true;
        this.onFirstGesture?.();
    }

    /** 'solo' (one player, all keys) or 'versus' (split keyboard). */
    setMode(mode) {
        this.mode = mode;
        this.queues = [[], []];
    }

    get bindings() {
        return BINDINGS[this.mode];
    }

    onKeyDown(e) {
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        this.gesture();
        for (const [action, codes] of Object.entries(MENU_KEYS)) {
            if (codes.includes(e.code)) this.menuQueue.push(action);
        }
        if (e.repeat) return;
        this.keys.add(e.code);
        if (e.code === 'Escape') this.globalQueue.push('pause');
        if (e.code === 'Tab' || (e.code === 'KeyC' && this.mode === 'solo')) this.globalQueue.push('camera');
        this.bindings.forEach((map, player) => {
            for (const action of ACTIONS) {
                if (map[action]?.includes(e.code)) this.queues[player].push(action);
            }
        });
    }

    /** Which player a gamepad drives. */
    padPlayer(padIndex, padCount) {
        if (this.mode === 'solo') return 0;
        if (padCount === 1) return 1;
        return padIndex === 0 ? 0 : 1;
    }

    getPads() {
        const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
        return pads;
    }

    /** Call once per rendered frame. */
    poll(dt) {
        const pads = this.getPads();
        pads.forEach((pad, i) => {
            const prev = this.padState.get(pad.index) ?? [];
            const now = pad.buttons.map((b) => b.pressed || b.value > 0.4);
            const pressed = (b) => now[b] && !prev[b];
            const player = this.padPlayer(i, pads.length);
            for (const action of ACTIONS) {
                if (PAD[action].some(pressed)) this.queues[player].push(action);
            }
            if (now.some((v, b) => v && !prev[b])) this.gesture();
            if (pressed(PAD_PAUSE)) this.globalQueue.push('pause');
            if (pressed(PAD_CAMERA)) this.globalQueue.push('camera');
            if (pressed(0)) this.menuQueue.push('confirm');
            if (pressed(1)) this.menuQueue.push('back');
            if (pressed(PAD_PAUSE)) this.menuQueue.push('pause');
            // Menu directions with auto-repeat from dpad or stick.
            const ax = pad.axes[0] ?? 0;
            const ay = pad.axes[1] ?? 0;
            const dirs = {
                up: now[PAD_DPAD.up] || ay < -0.6,
                down: now[PAD_DPAD.down] || ay > 0.6,
                left: now[PAD_DPAD.left] || ax < -0.6,
                right: now[PAD_DPAD.right] || ax > 0.6,
            };
            for (const [dir, held] of Object.entries(dirs)) {
                const key = `${pad.index}:${dir}`;
                if (!held) {
                    this.padRepeat.delete(key);
                    continue;
                }
                const t = this.padRepeat.get(key);
                if (t === undefined) {
                    this.menuQueue.push(dir);
                    this.padRepeat.set(key, 0.38);
                } else if (t - dt <= 0) {
                    this.menuQueue.push(dir);
                    this.padRepeat.set(key, 0.11);
                } else {
                    this.padRepeat.set(key, t - dt);
                }
            }
            this.padState.set(pad.index, now);
        });
    }

    /** Movement for a player as { x: strafe right, y: forward } in [-1, 1]. */
    getMove(player) {
        let x = 0;
        let y = 0;
        const map = this.bindings[player];
        if (map) {
            const held = (codes) => codes.some((c) => this.keys.has(c));
            if (held(map.move.up)) y += 1;
            if (held(map.move.down)) y -= 1;
            if (held(map.move.left)) x -= 1;
            if (held(map.move.right)) x += 1;
        }
        const pads = this.getPads();
        pads.forEach((pad, i) => {
            if (this.padPlayer(i, pads.length) !== player) return;
            const ax = pad.axes[0] ?? 0;
            const ay = pad.axes[1] ?? 0;
            if (Math.hypot(ax, ay) > DEADZONE) {
                x += ax;
                y -= ay;
            }
            if (pad.buttons[PAD_DPAD.up]?.pressed) y += 1;
            if (pad.buttons[PAD_DPAD.down]?.pressed) y -= 1;
            if (pad.buttons[PAD_DPAD.left]?.pressed) x -= 1;
            if (pad.buttons[PAD_DPAD.right]?.pressed) x += 1;
        });
        const len = Math.hypot(x, y);
        if (len > 1) {
            x /= len;
            y /= len;
        }
        return { x, y };
    }

    isHeld(player, action) {
        const map = this.bindings[player];
        if (map?.[action]?.some((c) => this.keys.has(c))) return true;
        const pads = this.getPads();
        return pads.some((pad, i) => this.padPlayer(i, pads.length) === player
            && PAD[action].some((b) => pad.buttons[b]?.pressed || pad.buttons[b]?.value > 0.4));
    }

    drain(player) {
        const q = this.queues[player];
        this.queues[player] = [];
        return q;
    }

    drainMenu() {
        const q = this.menuQueue;
        this.menuQueue = [];
        return q;
    }

    drainGlobal() {
        const q = this.globalQueue;
        this.globalQueue = [];
        return q;
    }

    clearQueues() {
        this.queues = [[], []];
        this.menuQueue = [];
        this.globalQueue = [];
    }

    /** Label printed on the physical key for this layout (e.g. KeyW -> "Z" on AZERTY). */
    keyLabel(code) {
        const named = {
            Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
            ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumpadDecimal: 'Num .',
        };
        if (named[code]) return named[code];
        if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
        const fromLayout = this.layout?.get(code);
        if (fromLayout) return fromLayout.toUpperCase();
        return code.replace(/^Key|^Digit/, '');
    }
}
