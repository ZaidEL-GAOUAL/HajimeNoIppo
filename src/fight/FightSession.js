import { Emitter } from '../core/Emitter.js';
import { FIXED_DT } from '../core/constants.js';
import { Fighter, STATE } from './Fighter.js';
import { Combat } from './Combat.js';

export const PHASE = {
    INTRO: 'intro',
    ROUND_INTRO: 'roundIntro',
    FIGHT: 'fight',
    COUNT: 'count',
    RESUME: 'resume',
    ROUND_END: 'roundEnd',
    BREAK: 'break',
    KO: 'ko',
    DECISION: 'decision',
    OVER: 'over',
};

const START_X = 1.35;
const MIN_SEPARATION = 0.64;

/**
 * One fight: two fighters, their controllers, the combat resolver and the rules
 * (rounds, clock, knockdowns, 10-count, TKO, decision). Pure gameplay; presentation listens to `events`.
 */
export class FightSession {
    /**
     * @param {{ models: import('./FighterModel.js').FighterModel[], data: object[], controllers: any[],
     *   rounds: number, roundTime: number, skipIntro?: boolean }} opts
     */
    constructor(opts) {
        this.events = new Emitter();
        this.rounds = opts.rounds;
        this.roundTime = opts.roundTime;
        this.controllers = opts.controllers;
        this.fighters = opts.models.map((m, i) => new Fighter(m, opts.data[i], i, this.events));
        this.fighters[0].opponent = this.fighters[1];
        this.fighters[1].opponent = this.fighters[0];
        this.combat = new Combat(this.events);
        this.round = 0;
        this.clock = this.roundTime;
        this.phase = null;
        this.phaseTime = 0;
        this.acc = 0;
        this.hitstopTime = 0;
        this.slowmo = { scale: 1, time: 0 };
        this.paused = false;
        this.result = null;
        this.scorecards = [[], [], []]; // judge -> [round] -> [p1, p2]
        this.count = 0;
        this.downed = null;
        this.events.on('hit', (e) => this.onHit(e));
        this.events.on('knockdown', (e) => this.onKnockdown(e.fighter));
        this.setPhase(opts.skipIntro ? PHASE.ROUND_INTRO : PHASE.INTRO);
        if (!opts.skipIntro) this.placeForIntro();
    }

    get timeScale() {
        if (this.paused) return 0;
        if (this.hitstopTime > 0) return 0;
        return this.slowmo.time > 0 ? this.slowmo.scale : 1;
    }

    hitstop(seconds) {
        this.hitstopTime = Math.max(this.hitstopTime, seconds);
    }

    slowMotion(scale, seconds) {
        this.slowmo = { scale, time: seconds };
    }

    setPhase(phase) {
        this.phase = phase;
        this.phaseTime = 0;
        this.combat.live = phase === PHASE.FIGHT;
        if (phase === PHASE.ROUND_INTRO) {
            this.round++;
            this.clock = this.roundTime;
            for (const f of this.fighters) f.stats.roundDamage[this.round - 1] = 0;
            this.placeForRound();
        }
        this.events.emit('phase', { phase, round: this.round, session: this });
    }

    placeForIntro() {
        this.fighters[0].place(-2.2, -0.4, Math.PI / 2);
        this.fighters[1].place(2.2, 0.4, -Math.PI / 2);
        for (const f of this.fighters) f.freeze();
    }

    placeForRound() {
        this.fighters[0].place(-START_X, 0, Math.PI / 2);
        this.fighters[1].place(START_X, 0, -Math.PI / 2);
        for (const f of this.fighters) {
            f.model.fallTarget = 0;
            f.model.fall = 0;
            f.freeze();
        }
    }

    /** Advance by real seconds; runs the fixed-step simulation. Returns the time scale used. */
    update(realDt) {
        if (this.paused) return 0;
        if (this.hitstopTime > 0) this.hitstopTime = Math.max(0, this.hitstopTime - realDt);
        if (this.slowmo.time > 0) this.slowmo.time = Math.max(0, this.slowmo.time - realDt);
        const scale = this.timeScale;
        this.acc += realDt * scale;
        let steps = 0;
        while (this.acc >= FIXED_DT && steps < 6) {
            this.step(FIXED_DT);
            this.acc -= FIXED_DT;
            steps++;
        }
        if (steps === 6) this.acc = 0;
        return scale;
    }

    step(dt) {
        this.phaseTime += dt;
        const [a, b] = this.fighters;
        const controlling = this.phase === PHASE.FIGHT || this.phase === PHASE.COUNT || this.phase === PHASE.RESUME;
        this.fighters.forEach((f, i) => {
            if (controlling) this.controllers[i].update(dt, f);
        });
        a.update(dt);
        b.update(dt);
        this.separate(a, b);
        this.updateRules(dt);
    }

    separate(a, b) {
        if (a.isDown || b.isDown) return;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const min = MIN_SEPARATION * (a.data.build.width + b.data.build.width) / 2;
        if (d >= min || d < 1e-5) return;
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
        a.clampToRing();
        b.clampToRing();
        a.syncModel();
        b.syncModel();
    }

    updateRules(dt) {
        const t = this.phaseTime;
        switch (this.phase) {
            case PHASE.INTRO:
                if (t >= 3.2) this.setPhase(PHASE.ROUND_INTRO);
                break;
            case PHASE.ROUND_INTRO:
                if (t >= 2.4) {
                    for (const f of this.fighters) f.toIdle();
                    this.setPhase(PHASE.FIGHT);
                }
                break;
            case PHASE.FIGHT: {
                const before = Math.ceil(this.clock);
                this.clock = Math.max(0, this.clock - dt);
                if (Math.ceil(this.clock) !== before) this.events.emit('clock', { clock: this.clock });
                if (this.clock <= 0) this.endRound();
                break;
            }
            case PHASE.COUNT:
                this.updateCount(dt);
                break;
            case PHASE.RESUME:
                if (t >= 1.3) {
                    for (const f of this.fighters) if (f.state === STATE.FROZEN || f.state === STATE.RISE) f.toIdle();
                    this.setPhase(PHASE.FIGHT);
                    this.events.emit('box', {});
                }
                break;
            case PHASE.ROUND_END:
                if (t >= 2.6) {
                    if (this.round >= this.rounds) this.decide();
                    else this.setPhase(PHASE.BREAK);
                }
                break;
            case PHASE.BREAK:
                if (t >= 3.6) {
                    for (const f of this.fighters) f.recoverBetweenRounds();
                    this.setPhase(PHASE.ROUND_INTRO);
                }
                break;
            case PHASE.KO:
                if (t >= 5) this.finish();
                break;
            case PHASE.DECISION:
                if (t >= 6.5) this.finish();
                break;
            default:
                break;
        }
    }

    onHit(e) {
        e.attacker.stats.roundDamage[this.round - 1] = (e.attacker.stats.roundDamage[this.round - 1] ?? 0) + e.damage;
    }

    onKnockdown(fighter) {
        fighter.knockdownLog.push(this.round - 1);
        if (this.phase !== PHASE.FIGHT && this.phase !== PHASE.RESUME) return;
        this.downed = fighter;
        this.count = 0;
        this.countTimer = 1.6;
        this.riseMeter = 0;
        const other = fighter.opponent;
        if (other.state !== STATE.DOWN) other.freeze();
        // Three knockdowns in one round stop the fight.
        if (fighter.roundKnockdowns >= 3) {
            this.endByKO(other, fighter, 'TKO');
            return;
        }
        this.setPhase(PHASE.COUNT);
        this.cpuRiseAt = this.pickCpuRise(fighter);
    }

    pickCpuRise(fighter) {
        const ctrl = this.controllers[fighter.index];
        if (ctrl.isHuman) return null;
        const will = 1 - 0.28 * (fighter.knockdownsTaken - 1) - (this.round > 1 ? 0.05 : 0);
        if (Math.random() > will) return 11; // stays down
        return Math.min(9, 3 + Math.floor(Math.random() * 5) + fighter.knockdownsTaken);
    }

    updateCount(dt) {
        const f = this.downed;
        const ctrl = this.controllers[f.index];
        // Mashing fills the rise meter; it drains over time and each knockdown makes it harder.
        if (ctrl.isHuman) {
            this.riseMeter += f.mashCount;
            f.mashCount = 0;
            this.riseMeter = Math.max(0, this.riseMeter - dt * 2.2);
        }
        this.countTimer -= dt;
        if (this.countTimer > 0) return;
        this.countTimer = 1.05;
        this.count++;
        this.events.emit('count', { n: this.count, fighter: f });
        const needed = 7 + 5 * (f.knockdownsTaken - 1);
        const human = ctrl.isHuman;
        const up = human ? this.riseMeter >= needed && this.count >= 2 : this.count >= (this.cpuRiseAt ?? 11);
        if (this.count >= 10 && !up) {
            this.endByKO(f.opponent, f, 'KO');
            return;
        }
        if (up) {
            f.rise();
            this.setPhase(PHASE.RESUME);
        }
    }

    get riseProgress() {
        if (!this.downed) return 0;
        const needed = 7 + 5 * (this.downed.knockdownsTaken - 1);
        return Math.min(1, this.riseMeter / needed);
    }

    endRound() {
        this.scoreRound();
        for (const f of this.fighters) {
            if (f.isDown) continue;
            if (this.round < this.rounds) f.walkToCorner();
            else f.freeze();
        }
        this.setPhase(PHASE.ROUND_END);
        this.events.emit('bell', { end: true });
    }

    /** 10-point must system, three judges with slightly different eyes. */
    scoreRound() {
        const r = this.round - 1;
        const [a, b] = this.fighters;
        const da = a.stats.roundDamage[r] ?? 0;
        const db = b.stats.roundDamage[r] ?? 0;
        for (const card of this.scorecards) {
            const pa = da * (0.85 + Math.random() * 0.3);
            const pb = db * (0.85 + Math.random() * 0.3);
            let sa = 10;
            let sb = 10;
            if (Math.abs(pa - pb) > 4) {
                if (pa > pb) sb = 9;
                else sa = 9;
            }
            sa -= roundKnockdowns(a, r);
            sb -= roundKnockdowns(b, r);
            card[r] = [Math.max(7, sa), Math.max(7, sb)];
        }
    }

    endByKO(winner, loser, method) {
        loser.stayDown();
        winner.celebrate();
        this.result = { winner, loser, method, round: this.round, time: this.roundTime - this.clock };
        this.slowMotion(0.3, 1.6);
        this.setPhase(PHASE.KO);
        this.events.emit('ko', this.result);
    }

    decide() {
        const totals = this.scorecards.map((card) => card.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]));
        let votesA = 0;
        let votesB = 0;
        for (const [x, y] of totals) {
            if (x > y) votesA++;
            else if (y > x) votesB++;
        }
        const [a, b] = this.fighters;
        let winner = null;
        let method = 'Draw';
        if (votesA > votesB) {
            winner = a;
            method = votesB === 0 && votesA === 3 ? 'Unanimous Decision' : votesB > 0 ? 'Split Decision' : 'Majority Decision';
        } else if (votesB > votesA) {
            winner = b;
            method = votesA === 0 && votesB === 3 ? 'Unanimous Decision' : votesA > 0 ? 'Split Decision' : 'Majority Decision';
        }
        if (winner) winner.celebrate();
        this.result = { winner, loser: winner?.opponent ?? null, method, round: this.round, time: this.roundTime, totals };
        this.setPhase(PHASE.DECISION);
        this.events.emit('decision', this.result);
    }

    finish() {
        this.setPhase(PHASE.OVER);
        this.events.emit('matchEnd', this.result);
    }

    dispose() {
        this.events.clear();
    }
}

function roundKnockdowns(fighter, roundIndex) {
    return fighter.knockdownLog.filter((r) => r === roundIndex).length;
}
