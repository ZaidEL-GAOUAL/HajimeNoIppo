// Procedural audio for the game: one-shot SFX, looping crowd, referee count and announcer.
// Graph: one-shots -> sfx / crowd / voice buses -> master -> compressor -> speakers,
// with a subtle convolution-reverb send (arena) fed per sound and by the crowd bus.
import { SOUNDS, countTick, createCrowd, makeImpulse, prepare, clamp } from './sounds.js';

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));

const DEFAULT_VOLUMES = { master: 0.8, sfx: 0.9, crowd: 0.6, voice: 0.9 };
const CROWD_REACTIONS = new Set(['cheer', 'ooh', 'gasp']);
const COUNT_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const PAUSE_DUCK = 0.08;
const MAX_VOICES = 48;
const num = (v, d) => (Number.isFinite(v) ? v : d);

// Constructing is cheap and never creates an AudioContext (browsers block it before a gesture);
// every method is a silent no-op until unlock() has been called from a user gesture.
export class AudioEngine {
    #ctx = null;
    #bus = null;
    #vol = { ...DEFAULT_VOLUMES };
    #excitement = 0;
    #crowd = null;
    #crowdWanted = false;
    #paused = false;
    #disposed = false;
    #warned = new Set();
    #active = [];
    #utterance = null;
    #speechPrimed = false;

    get ready() {
        return !!this.#ctx && this.#ctx.state === 'running';
    }

    // Call from a user gesture. Creates (once) and resumes the context; safe to call repeatedly.
    unlock() {
        if (this.#disposed) return Promise.resolve(false);
        try {
            if (!this.#ctx && !this.#create()) return Promise.resolve(false);
            this.#primeSpeech();
            if (this.#ctx.state === 'running') return Promise.resolve(true);
            this.#tickle();
            return this.#ctx.resume().then(() => this.ready, () => false);
        } catch (err) {
            console.warn('AudioEngine: unlock failed', err);
            return Promise.resolve(false);
        }
    }

    setVolumes(volumes = {}) {
        for (const key of Object.keys(DEFAULT_VOLUMES)) {
            if (Number.isFinite(volumes?.[key])) this.#vol[key] = clamp(volumes[key], 0, 1);
        }
        if (!this.#bus) return;
        const now = this.#ctx.currentTime, v = this.#vol, b = this.#bus;
        for (const [node, value] of [[b.master, v.master], [b.sfx, v.sfx], [b.sfxSend, v.sfx], [b.crowd, v.crowd], [b.voice, v.voice], [b.voiceSend, v.voice]]) {
            node.gain.setTargetAtTime(value, now, 0.02);
        }
    }

    play(name, opts = {}) {
        const recipe = Object.hasOwn(SOUNDS, name) ? SOUNDS[name] : null;
        if (!recipe) {
            if (!this.#warned.has(name)) {
                this.#warned.add(name);
                console.warn(`AudioEngine: unknown sound "${name}"`);
            }
            return;
        }
        if (!this.ready) return;
        const ctx = this.#ctx, now = ctx.currentTime;
        this.#active = this.#active.filter((t) => t > now);
        if (this.#active.length >= MAX_VOICES) return;
        const crowd = CROWD_REACTIONS.has(name);
        try {
            const dur = recipe(ctx, crowd ? this.#bus.crowdIn : this.#bus.sfx, now + Math.random() * 0.006, {
                intensity: clamp(num(opts?.intensity, 0.5), 0, 1),
                pan: clamp(num(opts?.pan, 0), -1, 1),
                rate: clamp(num(opts?.rate, 1), 0.25, 4),
                send: crowd ? null : this.#bus.sfxSend,
            });
            this.#active.push(now + dur);
        } catch (err) {
            if (!this.#warned.has(`!${name}`)) {
                this.#warned.add(`!${name}`);
                console.warn(`AudioEngine: failed to play "${name}"`, err);
            }
        }
    }

    // Starts the crowd loop; if called before unlock() it starts as soon as audio is unlocked.
    startCrowd() {
        this.#crowdWanted = true;
        if (!this.#ctx || this.#crowd) return;
        try {
            this.#crowd = createCrowd(this.#ctx, this.#bus.crowdIn, null, this.#excitement);
        } catch (err) {
            console.warn('AudioEngine: crowd failed', err);
        }
    }

    stopCrowd(fadeSeconds = 1) {
        this.#crowdWanted = false;
        this.#crowd?.stop(Math.max(0, num(fadeSeconds, 1)));
        this.#crowd = null;
    }

    setCrowdExcitement(x) {
        this.#excitement = clamp(num(x, 0), 0, 1);
        this.#crowd?.setExcitement(this.#excitement);
    }

    count(n) {
        const k = Math.round(num(n, 0));
        if (!this.#ctx || k < 1 || k > 10) return;
        if (this.ready) {
            try {
                countTick(this.#ctx, this.#bus.voice, this.#ctx.currentTime, { intensity: 0.7, send: this.#bus.voiceSend });
            } catch { /* ignore */ }
        }
        this.#speak(COUNT_WORDS[k - 1], 0.9, 0.8);
    }

    announce(text, opts = {}) {
        if (!this.#ctx || !text) return;
        this.#speak(String(text), num(opts?.rate, 1), num(opts?.pitch, 0.9));
    }

    // Pause ducks the crowd (loop and reactions); everything else keeps running.
    setPaused(paused) {
        this.#paused = !!paused;
        if (this.#bus) this.#bus.crowdIn.gain.setTargetAtTime(this.#paused ? PAUSE_DUCK : 1, this.#ctx.currentTime, 0.12);
    }

    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#crowd?.stop(0);
        this.#crowd = null;
        try {
            if (this.#utterance) globalThis.speechSynthesis?.cancel();
        } catch { /* ignore */ }
        this.#utterance = null;
        this.#ctx?.close().catch(() => {});
        this.#ctx = null;
        this.#bus = null;
    }

    #create() {
        const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AC) return false;
        const ctx = new AC({ latencyHint: 'interactive' });
        try {
            this.#bus = this.#buildGraph(ctx);
        } catch (err) {
            ctx.close().catch(() => {});
            throw err;
        }
        this.#ctx = ctx;
        // The crowd babble buffer is the heaviest one: build it right after the gesture handler
        // returns (startCrowd() / crowd reactions build it on demand if they come first).
        setTimeout(() => { if (this.#ctx === ctx) prepare(ctx); }, 0);
        if (this.#crowdWanted) this.startCrowd();
        return true;
    }

    #buildGraph(ctx) {
        prepare(ctx, { babble: false }); // shared noise buffers, built once
        const gain = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.25;
        limiter.connect(ctx.destination);

        const v = this.#vol;
        const master = gain(v.master, limiter);
        const reverb = ctx.createConvolver();
        reverb.buffer = makeImpulse(ctx, 1.2);
        reverb.connect(gain(0.35, master));
        const crowd = gain(v.crowd, master);
        crowd.connect(gain(0.3, reverb));
        return {
            master,
            crowd,
            sfx: gain(v.sfx, master),
            sfxSend: gain(v.sfx, reverb),
            voice: gain(v.voice, master),
            voiceSend: gain(v.voice, reverb),
            crowdIn: gain(this.#paused ? PAUSE_DUCK : 1, crowd),
        };
    }

    // iOS needs a sound started inside the gesture to really unlock output.
    #tickle() {
        const ctx = this.#ctx, src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start();
    }

    #primeSpeech() {
        if (this.#speechPrimed) return;
        this.#speechPrimed = true;
        try {
            const synth = globalThis.speechSynthesis, U = globalThis.SpeechSynthesisUtterance;
            if (!synth || !U) return;
            synth.getVoices(); // kicks off async voice loading in Chrome
            const u = new U(' ');
            u.volume = 0;
            synth.speak(u); // first speak() must happen inside a gesture on iOS
        } catch { /* ignore */ }
    }

    #pickVoice(synth) {
        const voices = synth.getVoices?.() ?? [];
        const en = voices.filter((vo) => /^en[-_]US/i.test(vo.lang));
        return en.find((vo) => /\b(male|david|guy|alex|fred|daniel|mark|aaron|tom)\b/i.test(vo.name)) ?? en[0] ?? null;
    }

    #speak(text, rate, pitch) {
        const synth = globalThis.speechSynthesis, U = globalThis.SpeechSynthesisUtterance;
        const volume = clamp(this.#vol.master * this.#vol.voice * 1.3, 0, 1);
        if (!synth || !U || volume <= 0) return;
        try {
            if (synth.speaking || synth.pending) synth.cancel();
            const u = new U(text);
            u.lang = 'en-US';
            u.rate = clamp(rate, 0.1, 10);
            u.pitch = clamp(pitch, 0, 2);
            u.volume = volume;
            const voice = this.#pickVoice(synth);
            if (voice) u.voice = voice;
            u.onend = u.onerror = () => { if (this.#utterance === u) this.#utterance = null; };
            this.#utterance = u; // keep a reference: Chrome can GC an utterance mid-speech
            synth.speak(u);
        } catch { /* speech is best-effort */ }
    }
}
