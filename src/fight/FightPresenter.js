import { Color3, Vector3 } from '@babylonjs/core';
import { PHASE } from './FightSession.js';

const ROUND_WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Per-punch "weight": hitstop, camera shake, spark size.
const FEEL = {
    jab: { stop: 0.045, shake: 0.14, spark: 0.45, sfx: 'jab', size: 40 },
    straight: { stop: 0.07, shake: 0.28, spark: 0.65, sfx: 'punch', size: 54 },
    hook: { stop: 0.09, shake: 0.4, spark: 0.8, sfx: 'punch', size: 62 },
    uppercut: { stop: 0.11, shake: 0.55, spark: 0.95, sfx: 'heavy', size: 72 },
    body: { stop: 0.085, shake: 0.35, spark: 0.7, sfx: 'body', size: 58 },
};

/**
 * Game feel: turns session events into hitstop, camera work, FX, sound, crowd reactions and HUD popups.
 */
export class FightPresenter {
    constructor({ session, scene, camera, effects, audio, hud, arena, mode }) {
        this.session = session;
        this.scene = scene;
        this.camera = camera;
        this.fx = effects;
        this.audio = audio;
        this.hud = hud;
        this.arena = arena;
        this.mode = mode;
        this.excitement = 0.25;
        this.unsubs = [];
        const on = (type, fn) => this.unsubs.push(session.events.on(type, fn));
        on('phase', (e) => this.onPhase(e));
        on('punch', (e) => this.audio.play('whiff', { intensity: 0.3 + e.move.damage / 30, pan: this.pan(e.fighter.position), rate: 0.9 + Math.random() * 0.3 }));
        on('hit', (e) => this.onHit(e));
        on('block', (e) => this.onBlock(e));
        on('evade', (e) => this.onEvade(e));
        on('jolt', (e) => this.onJolt(e));
        on('special', (e) => this.onSpecial(e));
        on('guardBreak', (e) => this.onGuardBreak(e));
        on('knockdown', (e) => this.onKnockdown(e));
        on('count', (e) => this.onCount(e));
        on('rise', (e) => this.onRise(e));
        on('box', () => this.onBox());
        on('bell', () => this.audio.play('bell', { intensity: 0.8 }));
        on('clock', (e) => this.onClock(e));
        on('ko', (e) => this.onKO(e));
        on('decision', (e) => this.onDecision(e));
        on('dodge', (e) => this.audio.play('whiff', { intensity: 0.2, rate: 0.7, pan: this.pan(e.fighter.position) }));
        this.audio.startCrowd();
    }

    pan(pos) {
        // Rough stereo placement relative to the camera's right vector.
        const cam = this.scene.activeCamera;
        const right = cam.getDirection(Vector3.Right());
        const rel = pos.subtract(cam.position);
        return Math.max(-0.8, Math.min(0.8, Vector3.Dot(rel, right) / 3));
    }

    side(fighter) {
        return fighter.index === 0 ? 'left' : 'right';
    }

    bump(x) {
        this.excitement = Math.min(1, this.excitement + x);
    }

    onPhase({ phase, round }) {
        const s = this.session;
        if (phase === PHASE.INTRO) {
            this.camera.playShot({ type: 'intro', duration: 3.2, snap: 3 });
            const [a, b] = s.fighters;
            this.hud.banner(`${a.data.short} <span style="color:var(--gold)">VS</span> ${b.data.short}`, { sub: `${a.data.jp} ／ ${b.data.jp}`, duration: 2.8 });
            this.audio.announce(`${a.data.name}, versus, ${b.data.name}!`, { rate: 1.0 });
            this.bump(0.4);
        } else if (phase === PHASE.ROUND_INTRO) {
            this.camera.clearShot();
            const final = round === s.rounds && s.rounds > 1;
            this.hud.banner(final ? 'FINAL ROUND' : `ROUND ${round}`, { sub: `第${round}ラウンド`, duration: 1.5 });
            this.audio.announce(final ? 'Final round!' : `Round ${ROUND_WORDS[round - 1] ?? round}`);
            this.hud.hideCount();
            if (round > 1) this.hud.fadeHints();
        } else if (phase === PHASE.FIGHT && s.phaseTime === 0 && this.lastPhase === PHASE.ROUND_INTRO) {
            this.onBox();
        } else if (phase === PHASE.ROUND_END) {
            this.hud.banner('END OF ROUND', { sub: 'ラウンド終了', duration: 2 });
            this.audio.play('cheer', { intensity: 0.5 });
        } else if (phase === PHASE.BREAK) {
            const [a, b] = s.fighters;
            const card = s.scorecards[0][round - 1];
            this.hud.banner(`ROUND ${round} — ${card[0]} : ${card[1]}`, { sub: `${a.data.short} ／ ${b.data.short}`, style: 'gold', duration: 3 });
        }
        this.lastPhase = phase;
    }

    onBox() {
        this.hud.banner('BOX!', { sub: 'ファイト！', style: 'gold', duration: 0.9 });
        this.audio.play('bell', { intensity: 0.9 });
        this.audio.play('roundStart', { intensity: 0.7 });
        this.audio.announce('Box!', { rate: 1.1 });
        this.bump(0.25);
    }

    onClock({ clock }) {
        if (Math.ceil(clock) === 10) this.audio.play('menuMove', { intensity: 0.8 });
    }

    onHit(e) {
        const { attacker, defender, move, point, counter, combo, damage } = e;
        const feel = FEEL[attacker.moveId] ?? FEEL.straight;
        const heavy = counter || move.launcher || damage > 13;
        this.session.hitstop(feel.stop + (counter ? 0.06 : 0));
        this.camera.shake(feel.shake * (counter ? 1.6 : 1));
        this.fx.spark(point, { size: feel.spark * (counter ? 1.4 : 1), color: counter ? new Color3(1, 0.85, 0.3) : Color3.White() });
        this.audio.play(feel.sfx, { intensity: Math.min(1, 0.35 + damage / 20 + (counter ? 0.3 : 0)), pan: this.pan(point) });
        if (move.zone === 'head') {
            const dir = defender.position.subtract(attacker.position).normalize();
            this.fx.sweatBurst(point, dir.scale(1.5), heavy ? 45 : 18);
        }
        this.hud.sfxText(pick(move.onomatopoeia), point, this.scene, { size: feel.size * (counter ? 1.35 : 1), kind: counter ? 'counter' : '' });
        if (counter) {
            this.fx.impactFrame(0.06);
            this.fx.aberration(40);
            this.audio.play('counter', { intensity: 0.8 });
            this.hud.callout(this.side(attacker), 'COUNTER!', { jp: 'カウンター', style: attacker.index === 0 ? 'red' : 'blue' });
            this.session.slowMotion(0.45, 0.25);
            this.camera.kickFov(0.06);
        } else if (heavy) {
            this.fx.aberration(20);
            this.camera.kickFov(0.03);
        }
        this.hud.combo(attacker.index, combo);
        this.bump(0.04 + damage / 120 + (counter ? 0.15 : 0));
        if (heavy) this.audio.play(pick(['ooh', 'cheer']), { intensity: 0.45 + (counter ? 0.3 : 0) });
    }

    onBlock(e) {
        this.session.hitstop(0.03);
        this.camera.shake(0.08);
        this.fx.spark(e.point, { size: 0.32, color: new Color3(0.7, 0.85, 1) });
        this.audio.play('block', { intensity: 0.4 + e.move.damage / 30, pan: this.pan(e.point) });
        this.hud.sfxText(pick(['ガッ', 'ガシッ']), e.point, this.scene, { size: 34, kind: 'block' });
    }

    onEvade(e) {
        this.session.slowMotion(0.35, 0.3);
        this.hud.callout(this.side(e.defender), 'SLIP!', { jp: 'かわした', style: '' });
        this.hud.sfxText('ヒュッ', e.point, this.scene, { size: 36 });
        this.audio.play('gasp', { intensity: 0.4 });
        this.bump(0.06);
    }

    onJolt(e) {
        this.fx.impactFrame(0.1);
        this.fx.speedLines(1, 0.8);
        this.fx.setFocus(e.defender.position.add(new Vector3(0, 1.4, 0)));
        this.session.slowMotion(0.25, 0.6);
        this.hud.callout(this.side(e.defender), e.defender.data.special.name.toUpperCase() + '!', { jp: e.defender.data.special.jp, style: 'red' });
        this.audio.play('counter', { intensity: 1 });
        this.camera.playShot({ type: 'closeup', subject: e.defender, duration: 0.7, snap: 8 });
    }

    onSpecial(e) {
        const { fighter, special } = e;
        this.fx.speedLines(0.9, 1.1, fighter.position.add(new Vector3(0, 1.3, 0)));
        this.fx.whiteFlash(0.35);
        this.audio.play('spirit', { intensity: 0.9 });
        this.hud.callout(this.side(fighter), special.name.toUpperCase(), { jp: special.jp, style: fighter.index === 0 ? 'red' : 'blue' });
        this.camera.playShot({ type: 'closeup', subject: fighter, duration: 0.55, snap: 9 });
        this.bump(0.3);
        this.audio.play('cheer', { intensity: 0.7 });
    }

    onGuardBreak(e) {
        this.hud.callout(this.side(e.fighter), 'GUARD BREAK!', { jp: 'ガードブレイク' });
        this.audio.play('heavy', { intensity: 0.5 });
        this.camera.shake(0.3);
    }

    onKnockdown(e) {
        const f = e.fighter;
        // A third knockdown ends the fight: the KO sequence already took over the camera and banner.
        const final = this.session.phase === PHASE.KO;
        this.session.hitstop(0.16);
        if (!final) this.session.slowMotion(0.25, 1.1);
        this.fx.impactFrame(0.12);
        this.fx.speedLines(1, 1.2, f.model.getBonePosition('Head'));
        this.fx.aberration(60);
        this.camera.shake(0.8);
        if (!final) {
            this.camera.playShot({ type: 'knockdown', subject: f, angle: f.yaw + Math.PI / 2, snap: 3 });
            this.hud.banner('DOWN!', { sub: 'ダウン！', style: 'red', duration: 1.4 });
        }
        this.audio.play('ko', { intensity: 0.7 });
        this.audio.play('gasp', { intensity: 0.8 });
        setTimeout(() => {
            this.audio.play('fall', { intensity: 0.9 });
            this.fx.dustBurst(f.position.add(new Vector3(0, 0.05, 0)), 50);
            this.audio.play('cheer', { intensity: 1 });
        }, 650);
        this.arena.flashBurst(20);
        this.bump(0.6);
    }

    onCount({ n, fighter }) {
        const human = this.session.controllers[fighter.index].isHuman;
        this.hud.showCount(n, human);
        this.audio.count(n);
        this.arena.flashBurst(3);
    }

    onRise(e) {
        this.hud.hideCount();
        this.hud.banner('HE\'S UP!', { sub: '立ち上がった！', style: 'gold', duration: 1.2 });
        this.audio.play('cheer', { intensity: 1 });
        this.camera.clearShot();
        this.bump(0.3);
        void e;
    }

    onKO(result) {
        const { winner, loser, method } = result;
        this.hud.hideCount();
        this.fx.impactFrame(0.15);
        this.fx.speedLines(1, 2.5, loser.model.getBonePosition('Head'));
        this.fx.whiteFlash(0.5);
        this.camera.playShot({ type: 'ko', subject: loser, angle: loser.yaw + Math.PI / 2, snap: 2 });
        this.hud.banner(method === 'TKO' ? 'T.K.O.' : 'K.O.', { sub: 'ノックアウト！', style: 'red', duration: 3.5 });
        this.audio.play('ko', { intensity: 1 });
        this.audio.play('bellTriple', { intensity: 0.9 });
        this.audio.announce(method === 'TKO' ? 'Technical knockout!' : 'Knockout!', { rate: 0.95 });
        this.audio.play('cheer', { intensity: 1 });
        this.arena.flashBurst(40);
        this.excitement = 1;
        setTimeout(() => this.camera.playShot({ type: 'closeup', subject: winner, snap: 2 }), 3200);
    }

    onDecision(result) {
        this.audio.play('bellTriple', { intensity: 0.8 });
        const text = result.winner ? `${result.winner.data.short} WINS` : 'DRAW';
        this.hud.banner(text, { sub: result.method.toUpperCase(), style: 'gold', duration: 5 });
        this.audio.announce(result.winner ? `The winner, by ${result.method}, ${result.winner.data.name}!` : 'It\'s a draw!');
        this.audio.play('cheer', { intensity: 0.9 });
        if (result.winner) this.camera.playShot({ type: 'closeup', subject: result.winner, snap: 2 });
        this.excitement = 0.9;
    }

    /** Per render frame. */
    update(realDt, scaledDt) {
        const s = this.session;
        this.excitement = Math.max(0.15, this.excitement - realDt * 0.06);
        this.arena.setExcitement(this.excitement);
        this.audio.setCrowdExcitement(this.excitement);
        // Red vignette when a human-controlled fighter is in danger.
        let danger = 0;
        s.fighters.forEach((f, i) => {
            if (s.controllers[i].isHuman && !f.isDown) danger = Math.max(danger, f.healthRatio < 0.25 ? (0.25 - f.healthRatio) * 2.4 : 0);
        });
        this.fx.setDanger(danger * (0.75 + 0.25 * Math.sin(performance.now() / 160)));
        void scaledDt;
    }

    dispose() {
        for (const u of this.unsubs) u();
        this.audio.stopCrowd(1.2);
    }
}
