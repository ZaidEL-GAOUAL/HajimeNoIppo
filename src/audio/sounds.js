// Procedural sound recipes for AudioEngine. No audio files: everything is synthesized.
// Every one-shot recipe has the signature (ctx, destination, when, opts) => seconds, so it
// renders identically into a live AudioContext or an OfflineAudioContext.
// opts: { intensity 0..1, pan -1..1, rate (pitch/speed multiplier), send (optional reverb input node) }

const kits = new WeakMap();
// Rough vowel formants (F1, F2) used for crowd babble.
const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720], [520, 1190], [490, 1350]];

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const rand = (a, b) => a + Math.random() * (b - a);
const vary = (amt) => 1 + (Math.random() * 2 - 1) * amt;
const loud = (i, floor = 0.35) => floor + (1 - floor) * i;
const weight = (i) => 0.7 + 0.6 * i; // extra gain for low-end layers at high intensity

// Scale to a target peak, or to a target RMS when `byRms` (steadier loudness for random content).
function normalize(d, target, byRms = false) {
    let m = 0;
    for (let k = 0; k < d.length; k++) m = byRms ? m + d[k] * d[k] : Math.max(m, Math.abs(d[k]));
    if (byRms) m = Math.sqrt(m / d.length);
    if (m > 0) for (let k = 0; k < d.length; k++) d[k] *= target / m;
}

// Mono noise buffer whose ends are crossfaded so it loops without a click.
function noiseBuffer(ctx, seconds, color) {
    const sr = ctx.sampleRate, len = Math.floor(seconds * sr), xf = Math.floor(0.05 * sr);
    const raw = new Float32Array(len + xf);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let k = 0; k < raw.length; k++) {
        const w = Math.random() * 2 - 1;
        if (color === 'white') raw[k] = w;
        else if (color === 'pink') { // Paul Kellet's refined pink filter
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            raw[k] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
        } else {
            last = (last + 0.02 * w) / 1.02; raw[k] = last;
        }
    }
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    d.set(raw.subarray(0, len));
    for (let k = 0; k < xf; k++) {
        const a = k / xf;
        d[k] = raw[k] * Math.sqrt(a) + raw[len + k] * Math.sqrt(1 - a);
    }
    normalize(d, 1);
    return buf;
}

// Crowd "walla": many glottal-pulse voices with random syllables through two formant
// resonators each. Written with wrap-around so the buffer loops seamlessly. Rendered at
// ~22 kHz (the crowd is low-passed anyway) to halve the one-time cost.
function makeBabble(ctx, kit, seconds = 4, voices = 16) {
    const sr = Math.min(ctx.sampleRate, 22050), len = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const nz = kit.white.getChannelData(0), nlen = nz.length;
    const reso = (f, bw) => {
        const r = Math.exp(-Math.PI * bw / sr), w = 2 * Math.PI * f / sr;
        return [2 * r * Math.cos(w), -r * r, (1 - r) * 2 * Math.sin(w)];
    };
    for (let v = 0; v < voices; v++) {
        const female = Math.random() < 0.4;
        const base = female ? rand(185, 240) : rand(100, 140), fs = female ? 1.15 : 1;
        const amp = rand(0.5, 1);
        let n = Math.floor(rand(0, 0.3) * sr), idx = n, phase = Math.random(), ni = Math.floor(Math.random() * nlen);
        let y1 = 0, y2 = 0, z1 = 0, z2 = 0;
        while (n < len) {
            const syl = Math.floor(rand(0.09, 0.3) * sr);
            const [F1, F2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
            const [a1, b1, g1] = reso(F1 * fs, 90), [a2, b2, g2] = reso(F2 * fs, 140);
            const f0a = base * rand(0.9, 1.15), f0b = f0a * rand(0.85, 1.15), breath = rand(0.15, 0.4);
            for (let k = 0; k < syl; k++) {
                const u = k / syl, e = 4 * u * (1 - u);
                phase += (f0a + (f0b - f0a) * u) / sr;
                if (phase >= 1) phase -= 1;
                const x = ((phase * 2 - 1) * (1 - breath) + nz[ni] * breath) * e * e;
                if (++ni === nlen) ni = 0;
                const y = g1 * x + a1 * y1 + b1 * y2; y2 = y1; y1 = y;
                const z = g2 * x + a2 * z1 + b2 * z2; z2 = z1; z1 = z;
                d[idx] += (y + 0.6 * z) * amp;
                if (++idx === len) idx = 0;
            }
            const gap = Math.floor(rand(0, 0.14) * sr);
            n += syl + gap;
            idx = (idx + gap) % len;
        }
    }
    normalize(d, 0.18, true);
    return buf;
}

// Shared per-context buffers (built once; one-shots only reference them).
export function getKit(ctx) {
    let kit = kits.get(ctx);
    if (!kit) {
        kit = { curves: new Map(), babble: null };
        kit.white = noiseBuffer(ctx, 2, 'white');
        kit.pink = noiseBuffer(ctx, 3, 'pink');
        kit.brown = noiseBuffer(ctx, 2, 'brown');
        kits.set(ctx, kit);
    }
    return kit;
}

export function getBabble(ctx) {
    const kit = getKit(ctx);
    return (kit.babble ??= makeBabble(ctx, kit));
}

export function prepare(ctx, { babble = true } = {}) {
    getKit(ctx);
    if (babble) getBabble(ctx);
}

// Stereo arena impulse: a few early reflections, then decaying noise that darkens over time.
export function makeImpulse(ctx, seconds = 1.2) {
    const sr = ctx.sampleRate, len = Math.floor(seconds * sr), pre = Math.floor(0.012 * sr);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let k = pre; k < len; k++) {
            const t = (k - pre) / sr, a = Math.min(0.92, 0.2 + t * 0.8);
            lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
            d[k] = lp * Math.exp(-6.9 * t / (seconds - 0.012)) * (1 + t * 2);
        }
        for (let r = 0; r < 6; r++) d[pre + Math.floor(rand(0.005, 0.08) * sr)] += rand(-0.5, 0.5);
    }
    return buf;
}

// One-shot builder. Times passed to its methods are nominal seconds relative to `when`;
// they are scaled by 1/rate and frequencies by rate, like playing a sample faster.
class Shot {
    constructor(ctx, dest, when, opts = {}, wet = 0, detune = 0.05) {
        this.ctx = ctx;
        this.kit = getKit(ctx);
        this.i = clamp(opts.intensity ?? 0.5, 0, 1);
        this.r = clamp(opts.rate ?? 1, 0.25, 4) * vary(detune);
        this.t0 = when;
        this.end = when;
        this.last = null;
        this.nyq = ctx.sampleRate * 0.45;
        this.out = ctx.createGain();
        const node = ctx.createStereoPanner();
        node.pan.value = clamp(opts.pan ?? 0, -1, 1);
        this.out.connect(node).connect(dest);
        this.tail = [this.out, node];
        if (wet > 0 && opts.send) {
            const s = this.gain(wet);
            node.connect(s).connect(opts.send);
            this.tail.push(s);
        }
    }

    at(t) { return this.t0 + t / this.r; }
    hz(f) { return clamp(f * this.r, 10, this.nyq); }

    #track(src, start, stop, offset = 0) {
        src.start(this.at(start), offset);
        const t = this.at(stop);
        src.stop(t);
        if (t >= this.end) { this.end = t; this.last = src; }
        return src;
    }

    gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

    filter(type, f, q = 1, db = 0) {
        const n = this.ctx.createBiquadFilter();
        n.type = type; n.frequency.value = this.hz(f); n.Q.value = q;
        if (db) n.gain.value = db;
        return n;
    }

    pan(v) { const p = this.ctx.createStereoPanner(); p.pan.value = v; p.connect(this.out); return p; }

    buffer(buf, start, dur, rate = 1) {
        const s = this.ctx.createBufferSource();
        s.buffer = buf; s.loop = true; s.playbackRate.value = rate * this.r;
        return this.#track(s, start, start + dur, Math.random() * buf.duration);
    }

    noise(kind, start, dur, rate = 1) { return this.buffer(this.kit[kind], start, dur, rate); }

    osc(type, f, start, dur) {
        const o = this.ctx.createOscillator();
        o.type = type; o.frequency.value = this.hz(f);
        return this.#track(o, start, start + dur);
    }

    shaper(drive) {
        const key = Math.round(drive * 10) / 10;
        let curve = this.kit.curves.get(key);
        if (!curve) {
            curve = new Float32Array(1025);
            const n = Math.tanh(key);
            for (let k = 0; k < 1025; k++) curve[k] = Math.tanh(key * (k / 512 - 1)) / n;
            this.kit.curves.set(key, curve);
        }
        const ws = this.ctx.createWaveShaper();
        ws.curve = curve;
        return ws;
    }

    glide(param, start, from, to, dur) {
        param.setValueAtTime(this.hz(from), this.at(start));
        param.exponentialRampToValueAtTime(this.hz(to), this.at(start + dur));
    }

    // Linear attack, optional hold, exponential decay to -60 dB (decay = T60).
    env(param, start, peak, attack, decay, hold = 0) {
        const a = Math.max(attack, 0.0005);
        param.setValueAtTime(0, this.at(start));
        param.linearRampToValueAtTime(peak, this.at(start + a));
        if (hold > 0) param.setValueAtTime(peak, this.at(start + a + hold));
        param.exponentialRampToValueAtTime(Math.max(peak * 1e-3, 1e-6), this.at(start + a + hold + decay));
        param.linearRampToValueAtTime(0, this.at(start + a + hold + decay + 0.015)); // no step at the end
    }

    // Breakpoint envelope: [[t, value, 'lin' | 'exp' | 'set'], ...]; the first point is a set.
    shape(param, start, pts) {
        pts.forEach(([dt, v, kind], k) => {
            const t = this.at(start + dt);
            if (k === 0 || kind === 'set') param.setValueAtTime(v, t);
            else if (kind === 'exp') param.exponentialRampToValueAtTime(Math.max(v, 1e-6), t);
            else param.linearRampToValueAtTime(v, t);
        });
    }

    // Oscillator voice; `drive` saturates it (tanh) while loud for a fatter thump.
    tone(type, f, start, { attack = 0.002, hold = 0, decay = 0.1, level = 0.3, to = 0, glide = 0.05, drive = 0, detune = 0, dest = this.out } = {}) {
        const o = this.osc(type, f, start, attack + hold + decay + 0.03);
        if (detune) o.detune.value = detune;
        if (to) this.glide(o.frequency, start, f, to, glide);
        const g = this.gain();
        this.env(g.gain, start, drive ? 1 : level, attack, decay, hold);
        o.connect(g);
        if (drive) g.connect(this.shaper(drive)).connect(this.gain(level)).connect(dest);
        else g.connect(dest);
        return o;
    }

    // Filtered noise burst.
    burst(start, { kind = 'white', type = 'bandpass', f = 1000, to = 0, q = 1, attack = 0.001, hold = 0, decay = 0.05, level = 0.5, rate = 1, dest = this.out } = {}) {
        const len = attack + hold + decay;
        const s = this.noise(kind, start, len + 0.03, rate);
        const fl = this.filter(type, f, q);
        if (to) this.glide(fl.frequency, start, f, to, len);
        const g = this.gain();
        this.env(g.gain, start, level, attack, decay, hold);
        s.connect(fl).connect(g).connect(dest);
        return g;
    }

    // Disconnect the voice from the mix once its last source has stopped.
    finish() {
        if (this.last) this.last.onended = () => this.tail.forEach((n) => n.disconnect());
        return this.end - this.t0;
    }
}

function bellStrike(s, start, level, decayScale = 1) {
    const dec = (0.75 + 0.5 * s.i) * decayScale;
    // Inharmonic partials of a struck bell: [ratio, amplitude, T60 seconds].
    for (const [ratio, amp, t60] of [[1, 0.34, 2.5], [1.004, 0.14, 2.3], [2.76, 0.2, 1.6], [5.4, 0.12, 0.9], [8.93, 0.07, 0.5], [0.5, 0.05, 1.2]]) {
        s.tone('sine', 830 * ratio, start, { attack: 0.0015, decay: t60 * dec, level: amp * level });
    }
    s.burst(start, { type: 'highpass', f: 5000, q: 0.7, decay: 0.015, level: 0.18 * level });
    s.tone('triangle', 1900, start, { decay: 0.05, level: 0.06 * level });
}

function punchy(s, start, l, { crack, smack, smackF, smackTo, boomFrom, boomTo, glide, boom, decay, drive }) {
    s.burst(start, { type: 'highpass', f: 2600, q: 0.7, attack: 0.0005, decay: 0.035, level: crack * l });
    s.burst(start, { kind: 'pink', f: smackF, to: smackTo, q: 0.9, decay: 0.1, level: smack * l });
    s.tone('sine', boomFrom, start, { to: boomTo, glide, decay, level: boom * l * weight(s.i), drive });
}

export const SOUNDS = {
    jab(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.12), i = s.i, l = loud(i);
        s.burst(0, { type: 'highpass', f: 2200, q: 0.7, attack: 0.0005, decay: 0.03, level: 0.22 * l });
        s.burst(0, { kind: 'pink', f: 1000, q: 1.1, decay: 0.07, level: 0.55 * l });
        s.tone('sine', 180, 0, { to: 80 - 20 * i, glide: 0.06, decay: 0.09 + 0.05 * i, level: 0.36 * l * weight(i), drive: 1.6 });
        return s.finish();
    },

    punch(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.18), i = s.i, l = loud(i);
        punchy(s, 0, l, { crack: 0.25, smack: 0.6, smackF: 1100, smackTo: 500, boomFrom: 160, boomTo: 56 - 12 * i, glide: 0.1, boom: 0.48, decay: 0.15 + 0.1 * i, drive: 2 + i });
        s.tone('triangle', 320, 0.003, { to: 140, glide: 0.04, decay: 0.06, level: 0.12 * l });
        return s.finish();
    },

    heavy(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.3), i = s.i, l = loud(i, 0.45);
        punchy(s, 0, l, { crack: 0.32, smack: 0.6, smackF: 800, smackTo: 320, boomFrom: 140, boomTo: 38 - 6 * i, glide: 0.28, boom: 0.48, decay: 0.4 + 0.2 * i, drive: 2.5 + 1.5 * i });
        s.tone('sine', 62, 0, { to: 30, glide: 0.35, decay: 0.4 + 0.25 * i, level: 0.08 + 0.25 * i }); // sub weight
        s.burst(0, { kind: 'pink', type: 'lowpass', f: 220, q: 0.7, attack: 0.004, decay: 0.2, level: 0.35 * l * weight(i) }); // air push
        s.tone('triangle', 260, 0, { to: 110, glide: 0.05, decay: 0.08, level: 0.14 * l }); // knuckle thwack
        s.burst(0.008, { kind: 'brown', type: 'lowpass', f: 380, q: 0.5, attack: 0.01, decay: 0.4 + 0.25 * i, level: 0.3 * l }); // rumble tail
        return s.finish();
    },

    body(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.12), i = s.i, l = loud(i);
        s.burst(0, { kind: 'pink', type: 'lowpass', f: 1300, q: 0.5, decay: 0.05, level: 0.3 * l }); // muffled slap
        s.burst(0, { kind: 'pink', f: 280, to: 180, q: 1.3, attack: 0.003, decay: 0.16 + 0.07 * i, level: 1.3 * l }); // fleshy thud
        s.tone('sine', 110, 0, { to: 60 - 12 * i, glide: 0.12, decay: 0.2 + 0.08 * i, level: 0.42 * l * weight(i), drive: 1.8 });
        s.tone('triangle', 210, 0.003, { to: 150, glide: 0.05, decay: 0.07, level: 0.1 * l });
        return s.finish();
    },

    block(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.1), i = s.i, l = loud(i);
        const slap = (t, k) => {
            s.burst(t, { kind: 'pink', f: 750, q: 1, decay: 0.08, level: 0.8 * k * l });
            s.burst(t, { f: 1700, q: 1.3, decay: 0.07, level: 0.6 * k * l });
            s.burst(t, { f: 3600, q: 2, decay: 0.035, level: 0.3 * k * l });
        };
        slap(0, 1);
        slap(rand(0.01, 0.017), 0.5); // second glove surface: a tiny flam
        s.tone('triangle', 380, 0, { to: 260, glide: 0.04, decay: 0.1, level: 0.14 * l }); // leather pad
        s.tone('sine', 190, 0, { to: 130, glide: 0.04, decay: 0.11, level: 0.06 + 0.12 * i });
        return s.finish();
    },

    whiff(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.05), i = s.i;
        const n = s.noise('white', 0, 0.22);
        const hp = s.filter('highpass', 300, 0.7), bp = s.filter('bandpass', 450, 2.2 + i);
        s.shape(bp.frequency, 0, [[0, s.hz(450)], [0.085, s.hz(1900 + 900 * i), 'exp'], [0.18, s.hz(900), 'exp']]);
        const g = s.gain();
        s.env(g.gain, 0, 0.45 + 0.5 * i, 0.07, 0.11);
        n.connect(hp).connect(bp).connect(g).connect(s.out);
        s.burst(0.02, { kind: 'pink', f: 300, to: 650, q: 1.5, attack: 0.05, decay: 0.1, level: 0.25 * loud(i) }); // body of the swing
        return s.finish();
    },

    step(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0, 0.08), i = s.i, l = loud(i, 0.5);
        s.burst(0, { kind: 'pink', f: 1200, to: 700, q: 0.9, attack: 0.005, decay: 0.07, level: 0.75 * l }); // scuff
        s.burst(0, { type: 'highpass', f: 4000, q: 0.7, decay: 0.02, level: 0.04 * l }); // grit
        if (Math.random() < 0.35) s.tone('sine', rand(2000, 2600), 0.005, { to: rand(2700, 3200), glide: 0.04, attack: 0.008, decay: 0.04, level: 0.035 * l }); // squeak
        return s.finish();
    },

    fall(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.3), i = s.i, l = loud(i, 0.5);
        s.burst(0, { kind: 'pink', type: 'lowpass', f: 900, q: 0.6, attack: 0.002, decay: 0.18, level: 0.55 * l }); // canvas slap
        s.tone('sine', 95, 0, { to: 36, glide: 0.3, decay: 0.6 + 0.15 * i, level: 0.48 * l * weight(i), drive: 2.2 });
        const t2 = rand(0.11, 0.14); // second bounce (hips / legs)
        s.burst(t2, { kind: 'pink', type: 'lowpass', f: 700, q: 0.6, decay: 0.12, level: 0.32 * l });
        s.tone('sine', 80, t2, { to: 40, glide: 0.15, decay: 0.25, level: 0.28 * l, drive: 1.5 });
        // Canvas rattle: band-passed noise chopped by a fast square LFO.
        const rn = s.noise('white', 0.005, 0.65), rbp = s.filter('bandpass', 2400, 2.5), am = s.gain(0.5), rg = s.gain();
        const lfo = s.osc('square', 31, 0.005, 0.65), depth = s.gain(0.5);
        lfo.connect(depth).connect(am.gain);
        s.env(rg.gain, 0.005, 0.15 * l, 0.01, 0.6);
        rn.connect(rbp).connect(am).connect(rg).connect(s.out);
        // Rope creak hint: stick-slip pulses through a resonance.
        const creak = s.osc('sawtooth', 48, 0.2, 0.54), cbp = s.filter('bandpass', 1100, 7), cg = s.gain();
        s.glide(creak.frequency, 0.2, 48, 70, 0.45);
        s.env(cg.gain, 0.2, 0.07, 0.12, 0.3, 0.08);
        creak.connect(cbp).connect(cg).connect(s.out);
        return s.finish();
    },

    bell(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.35, 0.012);
        bellStrike(s, 0, loud(s.i, 0.5));
        return s.finish();
    },

    bellTriple(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.35, 0.012), l = loud(s.i, 0.5) * 0.75;
        bellStrike(s, 0, l, 0.5);
        bellStrike(s, 0.2 + rand(-0.01, 0.01), l, 0.5);
        bellStrike(s, 0.4 + rand(-0.01, 0.01), l, 0.9);
        return s.finish();
    },

    counter(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.3, 0.03), i = s.i, l = loud(i);
        // Rising zing into the hit.
        const z = s.osc('sawtooth', 500, 0, 0.16), zbp = s.filter('bandpass', 900, 3), zg = s.gain();
        s.glide(z.frequency, 0, 500, 3400, 0.13);
        s.glide(zbp.frequency, 0, 900, 5200, 0.13);
        s.shape(zg.gain, 0, [[0, 0], [0.11, 0.3 * l, 'lin'], [0.15, 0, 'lin']]);
        z.connect(zbp).connect(zg).connect(s.out);
        // Metallic "shing" + air.
        for (const [ratio, amp] of [[1, 0.1], [1.47, 0.08], [2.09, 0.06], [2.83, 0.04]]) {
            s.tone('sine', 2300 * ratio, 0.11, { attack: 0.002, decay: 0.3, level: amp * l });
        }
        s.burst(0.11, { type: 'highpass', f: 6000, q: 0.7, attack: 0.004, decay: 0.25, level: 0.16 * l });
        // Impact accent.
        s.burst(0.11, { type: 'highpass', f: 2500, q: 0.7, decay: 0.03, level: 0.25 * l });
        s.tone('sine', 140, 0.11, { to: 45, glide: 0.12, decay: 0.2 + 0.1 * i, level: 0.45 * l, drive: 2.5 });
        return s.finish();
    },

    ko(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.5, 0.03), i = s.i, l = loud(i, 0.5);
        punchy(s, 0, l, { crack: 0.32, smack: 0.5, smackF: 600, smackTo: 250, boomFrom: 105, boomTo: 28 - 4 * i, glide: 0.7, boom: 0.46, decay: 1.2 + 0.3 * i, drive: 3 + 2 * i });
        s.tone('sine', 50, 0, { to: 24, glide: 0.8, decay: 1.1, level: 0.12 + 0.2 * i }); // sub
        s.burst(0.02, { kind: 'brown', type: 'lowpass', f: 300, q: 0.5, attack: 0.02, decay: 0.9, level: 0.35 * l }); // rumble
        // Reverse-swell whoosh that is cut off into the ringing tail.
        const sw = s.noise('white', 0.04, 0.46), bp = s.filter('bandpass', 300, 1.4), g = s.gain();
        s.glide(bp.frequency, 0.04, 300, 3800, 0.42);
        s.shape(g.gain, 0.04, [[0, 1e-4], [0.4, 0.4 * l, 'exp'], [0.43, 0, 'lin']]);
        sw.connect(bp).connect(g).connect(s.out);
        // "Kiiin" ringing tail.
        s.tone('sine', 2650, 0.44, { attack: 0.01, decay: 1.1, level: 0.08 * l });
        s.tone('sine', 3980, 0.44, { attack: 0.01, decay: 0.8, level: 0.035 * l });
        return s.finish();
    },

    cheer(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.45, 0.04), l = loud(s.i, 0.3), babble = getBabble(ctx);
        const env = s.gain(), lp = s.filter('lowpass', 1200, 0.5);
        env.connect(s.out);
        s.shape(env.gain, 0, [[0, 0], [0.08, 0.1 * l, 'lin'], [0.55, 0.65 * l, 'exp'], [0.9, 0.56 * l, 'lin'], [2, 1e-3 * l, 'exp'], [2.015, 0, 'lin']]);
        s.shape(lp.frequency, 0, [[0, s.hz(1200)], [0.6, s.hz(3200), 'exp'], [2, s.hz(1400), 'exp']]);
        // "Yeah!"-ish formants over excited (sped-up) babble plus noise.
        const formants = [[700, 4, 1], [1700, 5, 0.6], [2600, 6, 0.35]].map(([f, q, g]) => {
            const bp = s.filter('bandpass', f, q), bg = s.gain(g);
            bp.connect(bg).connect(env);
            return bp;
        });
        lp.connect(env);
        for (const [rate, p, kind] of [[1.25, -0.6, 'babble'], [1.38, 0.6, 'babble'], [1, 0, 'pink']]) {
            const src = kind === 'babble' ? s.buffer(babble, 0, 2.04, rate) : s.noise('pink', 0, 2.04);
            const pn = s.ctx.createStereoPanner(), pg = s.gain(kind === 'pink' ? 0.5 : 1);
            pn.pan.value = p;
            src.connect(pg).connect(pn);
            pn.connect(lp);
            formants.forEach((bp) => pn.connect(bp));
        }
        return s.finish();
    },

    ooh(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.45, 0.04), l = loud(s.i, 0.3), babble = getBabble(ctx);
        const env = s.gain();
        env.connect(s.out);
        s.shape(env.gain, 0, [[0, 0], [0.05, 0.1 * l, 'lin'], [0.3, l, 'exp'], [0.5, 0.85 * l, 'lin'], [1.2, 1e-3 * l, 'exp'], [1.215, 0, 'lin']]);
        const voices = [s.buffer(babble, 0, 1.24, 0.95), s.buffer(babble, 0, 1.24, 1.05), s.noise('pink', 0, 1.24)];
        voices[0].playbackRate.setValueAtTime(0.95 * s.r, s.at(0));
        voices[0].playbackRate.linearRampToValueAtTime(0.85 * s.r, s.at(1.2)); // falling inflection
        const mix = s.gain(1);
        voices.forEach((v, k) => (k === 2 ? v.connect(s.gain(0.5)).connect(mix) : v.connect(mix)));
        for (const [f, to, q, g] of [[300, 360, 3.5, 1.6], [870, 790, 5, 0.9], [2240, 2240, 7, 0.4]]) {
            const bp = s.filter('bandpass', f, q);
            s.glide(bp.frequency, 0, f, to, 1.2);
            mix.connect(bp).connect(s.gain(g)).connect(env);
        }
        return s.finish();
    },

    gasp(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.35, 0.04), peak = 0.5 * loud(s.i, 0.3);
        // A few staggered inhales so it reads as many people.
        for (const [k, dt, p] of [[1, 0, 0], [0.7, 0.035, -0.5], [0.5, 0.08, 0.5]]) {
            const n = s.noise('white', dt, 0.54), hp = s.filter('highpass', 900, 0.7), bp = s.filter('bandpass', 1500 * vary(0.1), 0.9), g = s.gain();
            s.glide(bp.frequency, dt, 1500, 2600, 0.3);
            s.shape(g.gain, dt, [[0, 1e-4], [0.22, peak * k, 'exp'], [0.3, peak * k * 0.25, 'exp'], [0.5, peak * k * 1e-3, 'exp'], [0.515, 0, 'lin']]);
            n.connect(hp).connect(bp).connect(g).connect(s.pan(p));
        }
        return s.finish();
    },

    menuMove(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0, 0), l = loud(s.i, 0.6);
        const lp = s.filter('lowpass', 6000, 0.7);
        lp.connect(s.out);
        s.tone('triangle', 1320, 0, { decay: 0.04, level: 0.35 * l, dest: lp });
        s.tone('square', 2640, 0, { decay: 0.02, level: 0.05 * l, dest: lp });
        return s.finish();
    },

    menuSelect(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.08, 0), l = loud(s.i, 0.6);
        const lp = s.filter('lowpass', 5000, 0.7);
        lp.connect(s.out);
        for (const [f, t, d] of [[880, 0, 0.07], [1320, 0.06, 0.09]]) {
            s.tone('triangle', f, t, { decay: d, level: 0.32 * l, dest: lp });
            s.tone('square', f, t, { decay: d * 0.6, level: 0.05 * l, dest: lp });
        }
        return s.finish();
    },

    menuBack(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0, 0), l = loud(s.i, 0.6);
        const lp = s.filter('lowpass', 4000, 0.7);
        lp.connect(s.out);
        for (const [f, t, d] of [[784, 0, 0.05], [523, 0.05, 0.07]]) {
            s.tone('triangle', f, t, { decay: d, level: 0.3 * l, dest: lp });
            s.tone('square', f, t, { decay: d * 0.5, level: 0.04 * l, dest: lp });
        }
        return s.finish();
    },

    roundStart(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.3, 0.01), i = s.i, l = loud(i, 0.5);
        // Brass-ish power-chord stab: detuned saws through an enveloped low-pass ("ba-BAM!").
        const stab = (t, hold, decay, k) => {
            const lp = s.filter('lowpass', 400, 2), g = s.gain();
            s.shape(lp.frequency, t, [[0, s.hz(400)], [0.025, s.hz(3600), 'exp'], [hold + decay, s.hz(900), 'exp']]);
            s.env(g.gain, t, k * l, 0.012, decay, hold);
            lp.connect(g).connect(s.out);
            for (const f of [146.83, 220, 293.66, 440]) {
                for (const dt of [-9, 9]) {
                    const o = s.osc('sawtooth', f, t, 0.012 + hold + decay + 0.03);
                    o.detune.value = dt;
                    o.connect(lp);
                }
            }
        };
        stab(0, 0.03, 0.06, 0.06);
        stab(0.11, 0.12, 0.38, 0.08);
        // Low hit + splashy crash under the main stab.
        s.burst(0.11, { type: 'highpass', f: 2500, q: 0.7, decay: 0.03, level: 0.22 * l });
        s.tone('sine', 140, 0.11, { to: 45, glide: 0.12, decay: 0.28, level: 0.45 * l, drive: 2.5 });
        s.burst(0.11, { type: 'highpass', f: 5000, q: 0.5, decay: 0.45, level: 0.1 * l });
        return s.finish();
    },

    spirit(ctx, dest, when, opts) {
        const s = new Shot(ctx, dest, when, opts, 0.4, 0.01), l = loud(s.i, 0.5);
        [1046.5, 1318.5, 1568, 2093, 2637, 3136].forEach((f, k) => {
            const t = k * 0.055;
            s.tone('sine', f, t, { decay: 0.3, level: 0.14 * l });
            s.tone('triangle', f * 2, t, { decay: 0.12, level: 0.03 * l });
        });
        // Rising air + tremolo shimmer + held sparkle chord.
        s.burst(0, { f: 800, to: 6000, q: 1.2, attack: 0.2, decay: 0.2, level: 0.12 * l });
        const sh = s.noise('white', 0.15, 0.7), hp = s.filter('highpass', 6500, 0.7), am = s.gain(0.5), g = s.gain();
        const trem = s.osc('sine', 13, 0.15, 0.7), depth = s.gain(0.5);
        trem.connect(depth).connect(am.gain);
        s.env(g.gain, 0.15, 0.12 * l, 0.2, 0.4, 0.05);
        sh.connect(hp).connect(am).connect(g).connect(s.out);
        for (const [f, dt] of [[2093, -6], [2637, 5], [3136, -4]]) {
            s.tone('sine', f, 0.3, { attack: 0.08, decay: 0.45, level: 0.04 * l, detune: dt });
        }
        return s.finish();
    },
};

// Referee count "tick": short low thump with a click.
export function countTick(ctx, dest, when, opts = {}) {
    const s = new Shot(ctx, dest, when, opts, 0.2, 0.02), l = loud(s.i, 0.5);
    s.tone('sine', 115, 0, { to: 55, glide: 0.08, decay: 0.13, level: 0.55 * l, drive: 1.5 });
    s.burst(0, { type: 'highpass', f: 3000, q: 0.7, decay: 0.012, level: 0.15 * l });
    return s.finish();
}

// Looping arena crowd: babble murmur + noise wash + a roar layer that comes in with excitement,
// each slowly amplitude-modulated by LFOs at unrelated rates.
export function createCrowd(ctx, destination, send = null, excitement = 0) {
    const kit = getKit(ctx), babble = getBabble(ctx), t0 = ctx.currentTime, sources = [];
    const gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
    const filter = (type, f, q, dest) => {
        const n = ctx.createBiquadFilter();
        n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(dest);
        return n;
    };
    const loop = (buf, rate, pan, dest) => {
        const s = ctx.createBufferSource(), p = ctx.createStereoPanner();
        s.buffer = buf; s.loop = true; s.playbackRate.value = rate; p.pan.value = pan;
        s.connect(p).connect(dest);
        s.start(t0, Math.random() * buf.duration);
        sources.push(s);
        return s;
    };
    const lfo = (f, depth, param) => {
        const o = ctx.createOscillator(), g = gain(depth);
        o.frequency.value = f;
        o.connect(g).connect(param);
        o.start(t0);
        sources.push(o);
        return g;
    };

    const fade = gain(0, destination);
    if (send) fade.connect(gain(0.5, send));
    const level = gain(0.15, filter('highpass', 110, 0.7, fade)); // leave the low end to the punches

    const mG = gain(0.5, level), mLP = filter('lowpass', 900, 0.6, mG), mHP = filter('highpass', 140, 0.7, mLP);
    const murmur = [loop(babble, 1, -0.65, mHP), loop(babble, 0.94, 0.65, mHP)];

    const wG = gain(0.3, level), wLP = filter('lowpass', 1200, 0.5, wG), wBP = filter('bandpass', 500, 0.5, wLP);
    loop(kit.pink, 1, -0.8, wBP);
    loop(kit.pink, 0.97, 0.8, wBP);

    const rG = gain(0, level), rBP = filter('bandpass', 1000, 0.7, rG), rNoise = gain(0.5, rBP);
    loop(babble, 1.27, -0.35, rBP);
    loop(babble, 1.36, 0.35, rBP);
    loop(kit.pink, 1.03, 0, rNoise);

    lfo(0.11, 0.14, mG.gain);
    lfo(0.29, 0.07, mG.gain);
    lfo(0.07, 0.1, wG.gain);
    lfo(0.043, 0.04, level.gain);
    const rDepth = lfo(0.19, 0, rG.gain), rDepth2 = lfo(0.47, 0, rG.gain);

    let current = -1, stopped = false;
    const apply = (x, tc) => {
        if (Math.abs(x - current) < 0.002) return;
        current = x;
        const now = ctx.currentTime;
        const set = (p, v) => (tc > 0 ? p.setTargetAtTime(v, now, tc) : p.setValueAtTime(v, now));
        const roar = 0.85 * x ** 1.4;
        set(level.gain, 0.15 + 0.25 * x);
        set(mG.gain, 0.5 + 0.2 * x);
        set(mLP.frequency, 800 + 2400 * x);
        set(murmur[0].playbackRate, 1 + 0.1 * x);
        set(murmur[1].playbackRate, 0.94 + 0.1 * x);
        set(wG.gain, 0.3 + 0.25 * x);
        set(wLP.frequency, 1100 + 2800 * x);
        set(rG.gain, roar);
        set(rDepth.gain, roar * 0.25);
        set(rDepth2.gain, roar * 0.12);
        set(rBP.frequency, 850 + 900 * x);
    };
    apply(clamp(excitement, 0, 1), 0);
    fade.gain.setTargetAtTime(1, t0, 0.35);

    return {
        setExcitement(x) { if (!stopped) apply(clamp(x, 0, 1), 0.2); },
        stop(seconds = 1) {
            if (stopped) return;
            stopped = true;
            const now = ctx.currentTime, end = now + Math.max(0.02, seconds), g = fade.gain;
            if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
            else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
            g.linearRampToValueAtTime(0, end);
            sources.forEach((s) => s.stop(end + 0.05));
            sources[0].onended = () => fade.disconnect();
        },
    };
}
