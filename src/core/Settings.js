const KEY = 'hajime-no-ippo:settings';

const DEFAULTS = {
    rounds: 3,
    roundTime: 90,
    difficulty: 'normal',
    camera: 'broadcast',
    quality: 'high',
    master: 0.8,
    sfx: 0.9,
    crowd: 0.6,
    hints: true,
    p1: 'ippo',
    p2: 'miyata',
};

export const OPTIONS = {
    rounds: [1, 3, 5],
    roundTime: [60, 90, 120, 180],
    difficulty: ['easy', 'normal', 'hard'],
    camera: ['broadcast', 'behind'],
    quality: ['high', 'low'],
    master: [0, 0.2, 0.4, 0.6, 0.8, 1],
    sfx: [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1],
    crowd: [0, 0.2, 0.4, 0.6, 0.8, 1],
    hints: [true, false],
};

/** Persisted per-browser preferences. Storage can be unavailable (private mode); defaults still work. */
export class Settings {
    constructor() {
        this.values = { ...DEFAULTS };
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) Object.assign(this.values, JSON.parse(raw));
        } catch {
            // ignore
        }
    }

    get(key) {
        return this.values[key];
    }

    set(key, value) {
        this.values[key] = value;
        try {
            localStorage.setItem(KEY, JSON.stringify(this.values));
        } catch {
            // ignore
        }
    }

    /** Step an option through its allowed values. */
    cycle(key, dir) {
        const list = OPTIONS[key];
        const i = list.indexOf(this.values[key]);
        const next = list[(Math.max(0, i) + dir + list.length) % list.length];
        this.set(key, next);
        return next;
    }
}
