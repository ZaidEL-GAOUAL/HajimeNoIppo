import { Engine, Scene, LoadAssetContainerAsync, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { UI } from '../ui/UI.js';
import { Hud } from '../ui/Hud.js';
import { Arena } from '../world/Arena.js';
import { FightCamera } from '../fight/FightCamera.js';
import { FighterModel } from '../fight/FighterModel.js';
import { FightSession, PHASE } from '../fight/FightSession.js';
import { FightPresenter } from '../fight/FightPresenter.js';
import { HumanController, AIController } from '../fight/controllers.js';
import { Effects } from '../fx/Effects.js';
import { getFighter } from '../data/fighters.js';
import { FONT_JP, FONT_LATIN } from '../render/ProceduralTextures.js';

const GUARD_CLIP = 'warmup';
const GUARD_FRAME = 142;

/** Owns the engine, the render loop and the flow between screens and fights. */
export class Game {
    constructor(canvas, uiRoot) {
        this.canvas = canvas;
        this.uiRoot = uiRoot;
        this.params = new URLSearchParams(location.search);
        this.state = 'loading';
        this.models = [null, null];
        this.session = null;
        this.presenter = null;
        this.showcaseTime = 0;
    }

    async init() {
        MeshoptCompression.Configuration = { decoder: { url: new URL('vendor/meshopt_decoder.js', document.baseURI).href } };
        this.settings = new Settings();
        this.input = new Input();
        this.audio = new AudioEngine();
        this.applyVolumes();
        this.input.onFirstGesture = () => this.audio.unlock();
        this.ui = new UI(this.uiRoot, { input: this.input, settings: this.settings, audio: this.audio, game: this });
        this.hud = new Hud(this.ui.screens.hud, { input: this.input, settings: this.settings });
        this.ui.show('loading');

        this.engine = new Engine(this.canvas, true, { stencil: true, antialias: true, powerPreference: 'high-performance' }, false);
        this.applyResolution();
        window.addEventListener('resize', () => this.engine.resize());
        const scene = new Scene(this.engine);
        this.scene = scene;
        scene.skipPointerMovePicking = true;
        scene.autoClear = true;

        this.ui.setLoading(0.05, 'Warming up…');
        await Promise.race([
            Promise.all([document.fonts.load(`900 64px ${FONT_JP}`, 'はじめの一歩幕之内'), document.fonts.load(`64px ${FONT_LATIN}`, 'HAJIME')]),
            new Promise((r) => setTimeout(r, 4000)),
        ]);
        this.camera = new FightCamera(scene);
        this.ui.setLoading(0.15, 'Building the arena…');
        this.arena = new Arena(scene);
        await this.arena.load();
        this.ui.setLoading(0.6, 'Lacing up the gloves…');
        this.boxer = await LoadAssetContainerAsync('assets/models/boxer.glb', scene);
        this.ui.setLoading(0.85, 'Entering the ring…');
        this.shared = { guardPose: null };
        this.ensureModels(this.settings.get('p1'), this.settings.get('p2'));
        this.effects = new Effects(scene, this.camera.camera, this.settings.get('quality'));
        await scene.whenReadyAsync();
        this.ui.setLoading(1, 'Ready!');

        if (this.params.has('debug')) {
            await import('@babylonjs/inspector');
            scene.debugLayer.show({ embedMode: true });
        }
        window.__game = this;
        this.engine.runRenderLoop(() => this.frame());

        if (this.params.has('demo')) {
            this.startFight({ mode: 'demo', p1: this.params.get('p1') ?? 'ippo', p2: this.params.get('p2') ?? 'miyata' });
        } else {
            this.state = 'menu';
            this.ui.show('title');
        }
    }

    // ---- Settings ---------------------------------------------------------------------------------

    applyVolumes() {
        const s = this.settings;
        this.audio.setVolumes({ master: s.get('master'), sfx: s.get('sfx'), crowd: s.get('crowd') });
    }

    applyResolution() {
        const low = this.settings.get('quality') === 'low';
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.engine.setHardwareScalingLevel(low ? 1.4 : 1 / dpr);
    }

    applySettings(key) {
        if (['master', 'sfx', 'crowd'].includes(key)) this.applyVolumes();
        if (key === 'quality') {
            this.applyResolution();
            this.effects.dispose();
            this.effects = new Effects(this.scene, this.camera.camera, this.settings.get('quality'));
            if (this.presenter) this.presenter.fx = this.effects;
        }
        if (key === 'camera' && this.session && this.mode === 'cpu') this.camera.setMode(this.settings.get('camera'));
    }

    // ---- Fighters ---------------------------------------------------------------------------------

    /** Make sure the two models in the ring match the chosen fighters. */
    ensureModels(p1, p2, fresh = false) {
        [p1, p2].forEach((id, i) => {
            const current = this.models[i];
            const alt = i === 1 && p1 === p2;
            if (current && current.data.id === id && current.alt === alt && !fresh) return;
            current?.dispose();
            const model = new FighterModel(this.scene, this.boxer, getFighter(id), i, this.shared, { alt });
            if (!this.shared.guardPose) {
                this.shared.guardPose = FighterModel.captureGuardPose(model, GUARD_CLIP, GUARD_FRAME);
                model.guardPose = this.shared.guardPose;
            }
            this.models[i] = model;
            this.placeShowcase(model, i);
        });
    }

    placeShowcase(model, i) {
        model.root.position.set(i === 0 ? -1.15 : 1.15, 0, 0);
        model.root.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2;
        model.play(i === 0 ? 'warmup' : 'stance2', { fade: 0 });
    }

    previewFighters(p1, p2) {
        this.ensureModels(p1, p2);
    }

    // ---- Flow -------------------------------------------------------------------------------------

    startSelect(mode) {
        this.endFight();
        this.state = 'menu';
        this.ui.show('select', { mode });
    }

    startFight(cfg) {
        this.endFight();
        this.lastFight = cfg;
        this.mode = cfg.mode;
        const demo = cfg.mode === 'demo';
        this.input.setMode(cfg.mode === 'versus' ? 'versus' : 'solo');
        this.input.clearQueues();
        this.ensureModels(cfg.p1, cfg.p2, true);
        const difficulty = this.settings.get('difficulty');
        const controllers = demo
            ? [new AIController(this.params.get('level') ?? 'hard'), new AIController(this.params.get('level') ?? 'hard')]
            : [new HumanController(this.input, 0), cfg.mode === 'cpu' ? new AIController(difficulty) : new HumanController(this.input, 1)];
        this.session = new FightSession({
            models: this.models,
            data: [getFighter(cfg.p1), getFighter(cfg.p2)],
            controllers,
            rounds: demo ? +(this.params.get('rounds') ?? 3) : this.settings.get('rounds'),
            roundTime: demo ? +(this.params.get('time') ?? 60) : this.settings.get('roundTime'),
            skipIntro: this.params.has('skipintro'),
        });
        this.camera.setMode(cfg.mode === 'cpu' ? this.settings.get('camera') : 'broadcast');
        this.hud.bind(this.session, cfg.mode === 'demo' ? 'cpu' : cfg.mode);
        this.presenter = new FightPresenter({
            session: this.session, scene: this.scene, camera: this.camera, effects: this.effects,
            audio: this.audio, hud: this.hud, arena: this.arena, mode: cfg.mode,
        });
        this.session.events.on('matchEnd', () => this.onMatchEnd());
        // The session constructor already entered its first phase; replay it for the presenter.
        this.presenter.onPhase({ phase: this.session.phase, round: this.session.round });
        this.state = 'fight';
        this.ui.show('hud');
    }

    onMatchEnd() {
        this.state = 'results';
        const s = this.session;
        this.ui.show('results', { result: s.result, fighters: s.fighters, scorecards: s.scorecards, mode: this.mode === 'demo' ? 'versus' : this.mode });
    }

    endFight() {
        this.presenter?.dispose();
        this.session?.dispose();
        this.presenter = null;
        this.session = null;
        this.hud.clear();
        this.camera.clearShot();
        this.audio.setPaused(false);
        if (this.effects) {
            this.effects.setDanger(0);
            this.effects.lines = 0;
        }
        this.scene.animationTimeScale = 1;
    }

    pause() {
        if (!this.session || this.session.paused || this.state !== 'fight') return;
        this.session.paused = true;
        this.audio.setPaused(true);
        this.ui.show('pause');
    }

    resume() {
        if (!this.session) return;
        this.session.paused = false;
        this.audio.setPaused(false);
        this.input.clearQueues();
        this.ui.show('hud');
    }

    restart() {
        this.startFight(this.lastFight);
    }

    rematch() {
        this.startFight(this.lastFight);
    }

    quitToMenu() {
        this.endFight();
        this.ensureModels(this.models[0].data.id, this.models[1].data.id, true);
        this.state = 'menu';
        this.ui.show('menu');
    }

    // ---- Loop -------------------------------------------------------------------------------------

    frame() {
        const realDt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
        this.input.poll(realDt);
        for (const action of this.input.drainGlobal()) {
            if (this.state !== 'fight') continue;
            if (action === 'pause') {
                // The same key press is also a menu "back"; drop it so the pause menu doesn't close itself.
                this.input.drainMenu();
                if (this.session?.paused) this.resume();
                else this.pause();
            }
            if (action === 'camera' && this.mode === 'cpu' && !this.session?.paused) {
                const mode = this.camera.toggleMode();
                this.settings.set('camera', mode);
                this.ui.toast(mode === 'broadcast' ? 'TV CAMERA' : 'BEHIND CAMERA');
            }
        }

        let scaledDt = realDt;
        if (this.session && (this.state === 'fight' || this.state === 'results')) {
            const scale = this.session.update(realDt);
            scaledDt = realDt * scale;
            this.scene.animationTimeScale = scale;
            const [a, b] = this.session.fighters;
            this.camera.follow(scaledDt, a, b, realDt * (this.session.paused ? 0 : 1));
            this.presenter?.update(realDt, scaledDt);
            this.hud.update(realDt);
        } else {
            this.scene.animationTimeScale = 1;
            this.updateShowcase(realDt);
        }
        for (const m of this.models) m?.update(scaledDt);
        this.effects.update(realDt);
        this.arena.update(realDt);
        this.ui.update();
        this.scene.render();
    }

    updateShowcase(dt) {
        this.showcaseTime += dt;
        const screen = this.ui.current;
        if (screen === 'select') {
            const t = this.showcaseTime * 0.15;
            this.camera.orbit(dt, new Vector3(0, 1.15, 0), 4.2, 1.7, 0.1);
            void t;
        } else {
            this.camera.orbit(dt, new Vector3(0, 1.0, 0), 6.2, 2.3, 0.08);
        }
        this.arena.setExcitement(0.25 + 0.1 * Math.sin(this.showcaseTime * 0.3));
    }
}
