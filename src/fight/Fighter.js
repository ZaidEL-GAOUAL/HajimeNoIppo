import { Vector3 } from '@babylonjs/core/pure';
import { MOVES, CLIPS, impactTime, totalTime } from './moves.js';
import { RING } from '../core/constants.js';

export const STATE = {
    IDLE: 'idle',
    ATTACK: 'attack',
    DODGE: 'dodge',
    HIT: 'hit',
    BLOCK: 'block',
    JOLT: 'jolt',
    DOWN: 'down',
    RISE: 'rise',
    KO: 'ko',
    WIN: 'win',
    FROZEN: 'frozen', // round intro / between rounds: idle animation, no control
};

const DODGE_TIME = 0.42;
const DODGE_IFRAMES = [0.05, 0.32];
const JOLT_TIME = 1.8;
const RISE_TIME = 1.1;
const PUNCH_BUFFER = 0.22;
const SPIRIT_MAX = 100;

function angleDiff(target, current) {
    let d = target - current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/**
 * Gameplay side of a boxer: state machine, stamina/health/spirit, movement and attack timing.
 * Updated at a fixed 60 Hz by the FightSession. Controllers (human or CPU) write `intent` and call press*().
 */
export class Fighter {
    /**
     * @param {import('./FighterModel.js').FighterModel} model
     * @param {object} data roster entry
     * @param {number} index 0 = left / red corner, 1 = right / blue corner
     * @param {import('../core/Emitter.js').Emitter} events
     */
    constructor(model, data, index, events) {
        this.model = model;
        this.data = data;
        this.index = index;
        this.events = events;
        this.opponent = null;
        const s = data.stats;
        this.maxHealth = 100;
        this.maxStamina = 100 * (0.85 + 0.15 * s.stamina);
        this.chinFactor = 0.6 + 0.4 * s.chin;
        this.reach = data.build.height;
        this.position = new Vector3();
        this.yaw = 0;
        this.moveVel = new Vector3();
        this.pushVel = new Vector3();
        this.intent = { moveX: 0, moveY: 0, guard: false };
        this.buffer = { punch: null, punchTime: 0, dodge: 0, special: 0 };
        this.mashCount = 0;
        this.resetFight();
    }

    resetFight() {
        this.health = this.maxHealth;
        this.recoverable = 0;
        this.stamina = this.maxStamina;
        this.spirit = 0;
        this.knockdownsTaken = 0;
        this.roundKnockdowns = 0;
        this.knockdownLog = [];
        this.stats = { thrown: 0, landed: 0, blocked: 0, damage: 0, counters: 0, knockdowns: 0, maxCombo: 0, roundDamage: [] };
        this.state = STATE.FROZEN;
        this.stateTime = 0;
        this.sinceHit = 99;
        this.comboTaken = 0;
        this.comboDealt = 0;
        this.counterBonus = 0;
        this.superArmor = false;
        this.specialQueue = null;
    }

    get healthRatio() {
        return this.health / this.maxHealth;
    }

    get staminaRatio() {
        return this.stamina / this.maxStamina;
    }

    get spiritFull() {
        return this.spirit >= SPIRIT_MAX;
    }

    get isDown() {
        return this.state === STATE.DOWN || this.state === STATE.KO || this.state === STATE.RISE;
    }

    get canAct() {
        return this.state === STATE.IDLE;
    }

    get isGuarding() {
        return (this.state === STATE.IDLE && this.intent.guard) || this.state === STATE.BLOCK;
    }

    get isEvading() {
        return this.state === STATE.DODGE && this.stateTime >= DODGE_IFRAMES[0] && this.stateTime <= DODGE_IFRAMES[1];
    }

    /** True while winding up a punch (being hit now is a counter). */
    get isWindingUp() {
        return this.state === STATE.ATTACK && !this.impactDone;
    }

    get forward() {
        return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }

    /** Place at a spot facing a direction (round start). */
    place(x, z, yaw) {
        this.position.set(x, 0, z);
        this.yaw = yaw;
        this.moveVel.setAll(0);
        this.pushVel.setAll(0);
        this.syncModel();
    }

    setState(state) {
        this.state = state;
        this.stateTime = 0;
    }

    // ---- Controller API -------------------------------------------------------------------------

    pressPunch(id) {
        this.buffer.punch = id;
        this.buffer.punchTime = PUNCH_BUFFER;
        if (this.state === STATE.DOWN) this.mashCount++;
    }

    pressDodge() {
        this.buffer.dodge = PUNCH_BUFFER;
        if (this.state === STATE.DOWN) this.mashCount++;
    }

    pressSpecial() {
        this.buffer.special = PUNCH_BUFFER;
    }

    // ---- Fixed-step update ------------------------------------------------------------------------

    update(dt) {
        this.stateTime += dt;
        this.sinceHit += dt;
        this.buffer.punchTime -= dt;
        this.buffer.dodge -= dt;
        this.buffer.special -= dt;
        if (this.buffer.punchTime <= 0) this.buffer.punch = null;
        this.counterBonus = Math.max(0, this.counterBonus - dt);
        this.regenerate(dt);

        let moveScale = 0;
        this.model.guardTarget = 0;
        this.model.leanTarget = 0;
        switch (this.state) {
            case STATE.IDLE:
                moveScale = this.updateIdle(dt);
                break;
            case STATE.ATTACK:
                this.updateAttack(dt);
                break;
            case STATE.DODGE:
                if (this.stateTime >= DODGE_TIME) this.toIdle();
                break;
            case STATE.HIT:
                if (this.stateTime >= this.stunTime) this.toIdle();
                break;
            case STATE.BLOCK:
                this.model.guardTarget = 1;
                if (this.stateTime >= this.stunTime) this.toIdle();
                break;
            case STATE.JOLT:
                this.model.guardTarget = 0.7;
                this.model.leanTarget = Math.sin(this.stateTime * 9) * 0.05;
                if (this.stateTime >= JOLT_TIME) this.toIdle();
                break;
            case STATE.RISE:
                if (this.stateTime >= RISE_TIME) this.toIdle();
                break;
            case STATE.FROZEN:
                if (this.walkTarget) {
                    this.updateWalk(dt);
                    break;
                }
                this.moveVel.scaleInPlace(Math.exp(-dt * 10));
                break;
            case STATE.WIN:
                this.moveVel.scaleInPlace(Math.exp(-dt * 10));
                break;
            default:
                break;
        }
        if (this.holdClip && this.isDown && this.stateTime >= this.holdClip.at) {
            this.model.play(this.holdClip.clip, { frame: this.holdClip.frame, fade: 0 });
            this.holdClip = null;
        }
        this.updateMovement(dt, moveScale);
        if (!this.isDown && this.state !== STATE.WIN && !this.walkTarget) this.faceOpponent(dt);
        const specialActive = this.state === STATE.JOLT || (this.state === STATE.ATTACK && this.moveMods?.special);
        this.model.setAura(this.isDown ? 0 : specialActive ? 2 : this.spiritFull ? 1 : 0);
        this.syncModel();
    }

    regenerate(dt) {
        const s = this.data.stats.stamina;
        let rate = 12 * s;
        if (this.state === STATE.ATTACK) rate = 0;
        else if (this.isGuarding) rate = 5 * s;
        else if (this.moveVel.lengthSquared() > 0.1) rate = 9 * s;
        if (this.isDown) rate = 20;
        this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
        if (this.sinceHit > 2.2 && this.recoverable > 0 && !this.isDown) {
            const r = Math.min(this.recoverable, 3.5 * dt);
            this.recoverable -= r;
            this.health = Math.min(this.maxHealth, this.health + r);
        }
    }

    updateIdle() {
        if (this.buffer.special > 0 && this.spiritFull) {
            this.buffer.special = 0;
            this.startSpecial();
            return 0;
        }
        if (this.buffer.dodge > 0 && this.stamina >= 6) {
            this.buffer.dodge = 0;
            this.startDodge();
            return 0;
        }
        if (this.buffer.punch) {
            const id = this.buffer.punch;
            this.buffer.punch = null;
            this.startAttack(id);
            return 0;
        }
        this.model.guardTarget = this.intent.guard ? 1 : 0;
        return this.intent.guard ? 0.5 : 1;
    }

    updateAttack(dt) {
        const t = this.stateTime;
        const move = this.move;
        // Step into the punch during the windup, but never through the opponent.
        if (!this.impactDone && move.lunge && this.opponent) {
            const gap = Vector3.Distance(this.position, this.opponent.position);
            if (gap > move.range * this.reach * 0.82) {
                const k = Math.min(1, t / this.impactAt);
                const speed = (move.lunge / this.impactAt) * 2 * (1 - k);
                this.position.addInPlace(this.forward.scale(speed * dt));
            }
        }
        if (!this.impactDone && t >= this.impactAt) {
            this.impactDone = true;
            this.events.emit('impact', { attacker: this, move, mods: this.moveMods });
        }
        if (this.specialQueue) this.model.leanTarget = Math.sin(t * 11) * 0.28;
        if (this.impactDone && t >= this.impactAt + (this.specialQueue ? 0.04 : move.cancel)) {
            if (this.specialQueue?.length) {
                this.startAttack(this.specialQueue.shift(), this.moveMods);
                return;
            }
            if (this.connected && !this.specialQueue) {
                if (this.buffer.punch) {
                    const id = this.buffer.punch;
                    this.buffer.punch = null;
                    this.startAttack(id);
                    return;
                }
                if (this.buffer.dodge > 0 && this.stamina >= 6) {
                    this.buffer.dodge = 0;
                    this.startDodge();
                    return;
                }
            }
        }
        if (t >= this.endAt) {
            this.specialQueue = null;
            this.superArmor = false;
            this.toIdle();
        }
    }

    updateMovement(dt, moveScale) {
        const desired = new Vector3();
        if (this.walkTarget && this.walkVel) desired.copyFrom(this.walkVel);
        if (moveScale > 0) {
            const fatigue = 0.75 + 0.25 * this.staminaRatio;
            const speed = this.data.stats.speed * fatigue * moveScale;
            const fwd = this.forward;
            const right = new Vector3(fwd.z, 0, -fwd.x);
            const mx = this.intent.moveX;
            const my = this.intent.moveY;
            desired.addInPlace(fwd.scale(my * (my > 0 ? 1.55 : 1.35) * speed));
            desired.addInPlace(right.scale(mx * 1.3 * speed));
        }
        const accel = 1 - Math.exp(-dt * 14);
        this.moveVel.addInPlace(desired.subtract(this.moveVel).scale(accel));
        this.pushVel.scaleInPlace(Math.exp(-dt * 7));
        this.position.addInPlace(this.moveVel.scale(dt)).addInPlace(this.pushVel.scale(dt));
        this.clampToRing();
        if (this.state === STATE.IDLE) this.updateLocomotionClip();
    }

    clampToRing() {
        const L = RING.playHalf;
        this.position.x = Math.max(-L, Math.min(L, this.position.x));
        this.position.z = Math.max(-L, Math.min(L, this.position.z));
        // Corners are cut off by the posts.
        const cut = L * 1.82;
        const d = Math.abs(this.position.x) + Math.abs(this.position.z);
        if (d > cut) {
            const k = cut / d;
            this.position.x *= k;
            this.position.z *= k;
        }
    }

    updateLocomotionClip() {
        const fwd = this.forward;
        const vf = Vector3.Dot(this.moveVel, fwd);
        const vr = this.moveVel.x * fwd.z - this.moveVel.z * fwd.x;
        const speed = Math.hypot(vf, vr);
        let clip = CLIPS.idle.clip;
        let rate = 1;
        if (speed > 0.18) {
            if (Math.abs(vf) >= Math.abs(vr) * 0.7) {
                clip = vf > 0 ? CLIPS.stepForward.clip : CLIPS.stepBack.clip;
                rate = Math.min(2.4, Math.max(0.9, Math.abs(vf) / 0.55));
            } else {
                // The 2024 pivot clips dip into a crouch; shuffle with the step clip unless real strafes exist.
                const strafe = vr > 0 ? 'strafeRight' : 'strafeLeft';
                clip = this.model.has(strafe) ? strafe : CLIPS.stepForward.clip;
                rate = Math.min(2.2, Math.max(1.0, Math.abs(vr) / 0.6));
            }
            this.model.leanTarget = -vr * 0.06;
        }
        if (this.model.animator.current !== clip) this.model.play(clip, { speed: rate, fade: 0.18 });
        else this.model.animator.setSpeed(rate);
    }

    faceOpponent(dt) {
        if (!this.opponent) return;
        const dx = this.opponent.position.x - this.position.x;
        const dz = this.opponent.position.z - this.position.z;
        if (dx * dx + dz * dz < 1e-4) return;
        const target = Math.atan2(dx, dz);
        let diff = target - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const rate = this.state === STATE.ATTACK ? 4 : 11;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
        this.yaw += step;
    }

    syncModel() {
        const root = this.model.root;
        root.position.copyFrom(this.position);
        root.rotation.y = this.yaw;
    }

    // ---- Actions ----------------------------------------------------------------------------------

    /** @param {string} id move id  @param {{ damage?: number, speed?: number, guardDrain?: number, range?: number, jolt?: boolean }} [mods] */
    startAttack(id, mods = null) {
        const move = MOVES[id];
        if (!move) return;
        const fatigue = this.stamina < move.stamina ? 0.72 : 0.85 + 0.15 * this.staminaRatio;
        const speedMul = this.data.stats.speed * fatigue * (mods?.speed ?? 1);
        this.stamina = Math.max(0, this.stamina - move.stamina);
        this.move = move;
        this.moveId = id;
        this.moveMods = mods;
        this.impactDone = false;
        this.connected = false;
        this.impactAt = impactTime(move, speedMul);
        this.endAt = totalTime(move, speedMul);
        this.setState(STATE.ATTACK);
        this.moveVel.scaleInPlace(0.3);
        this.model.play(move.clip, { from: move.start, to: move.end, speed: move.speed * speedMul, fade: 0.05 });
        this.stats.thrown++;
        this.events.emit('punch', { fighter: this, move });
    }

    startDodge() {
        this.stamina -= 6;
        this.setState(STATE.DODGE);
        const c = CLIPS.duck;
        this.model.play(c.clip, { from: c.start, to: c.end, speed: (c.end - c.start) / 60 / DODGE_TIME, fade: 0.06 });
        this.events.emit('dodge', { fighter: this });
    }

    startSpecial() {
        this.spirit = 0;
        const special = this.data.special;
        this.events.emit('special', { fighter: this, special });
        if (special.id === 'jolt') {
            this.setState(STATE.JOLT);
            this.model.play(CLIPS.idle.clip, { fade: 0.1 });
            return;
        }
        // Rush: chained power punches with super armor.
        this.superArmor = true;
        this.specialQueue = ['body', 'hook', 'body', 'hook', 'uppercut'];
        this.startAttack(this.specialQueue.shift(), { damage: 1.2, speed: 1.3, guardDrain: 2, special: true });
    }

    /** Jolt stance was hit into: slip the punch and fire a devastating counter straight. */
    joltCounter() {
        this.startAttack('straight', { damage: 2.6, speed: 1.7, range: 1.45, jolt: true, special: true });
    }

    toIdle() {
        this.setState(STATE.IDLE);
        this.comboDealt = 0;
        this.comboTaken = 0;
        this.model.play(CLIPS.idle.clip, { fade: 0.2 });
    }

    freeze() {
        this.specialQueue = null;
        this.superArmor = false;
        this.walkTarget = null;
        this.setState(STATE.FROZEN);
        this.model.play(CLIPS.idle.clip, { fade: 0.25 });
    }

    /** Between rounds: walk back to the corner and turn toward the ring. */
    walkToCorner() {
        this.freeze();
        const s = this.index === 0 ? -1 : 1;
        this.walkTarget = new Vector3(s * 2.45, 0, s * 2.45);
        this.model.play(CLIPS.stepForward.clip, { speed: 1.6, fade: 0.25 });
    }

    updateWalk(dt) {
        const to = this.walkTarget.subtract(this.position);
        to.y = 0;
        const dist = to.length();
        if (dist < 0.08) {
            // Arrived: face the center of the ring.
            const face = Math.atan2(-this.position.x, -this.position.z);
            this.yaw += angleDiff(face, this.yaw) * Math.min(1, dt * 6);
            if (this.model.animator.current !== CLIPS.idle.clip) this.model.play(CLIPS.idle.clip, { fade: 0.3 });
            this.walkVel = Vector3.Zero();
            return;
        }
        const dir = to.scale(1 / dist);
        this.walkVel = dir.scale(Math.min(1.1, dist * 3));
        this.yaw += angleDiff(Math.atan2(dir.x, dir.z), this.yaw) * Math.min(1, dt * 8);
    }

    // ---- Being hit --------------------------------------------------------------------------------

    /** @param {{ attacker: Fighter, move: object, damage: number, counter: boolean }} hit */
    receiveHit(hit) {
        const { move, damage, counter, attacker } = hit;
        this.sinceHit = 0;
        this.health = Math.max(0, this.health - damage);
        this.recoverable = Math.min(this.recoverable + damage * 0.4, this.maxHealth - this.health);
        if (move.staminaDamage) this.stamina = Math.max(0, this.stamina - move.staminaDamage);
        this.spirit = Math.min(SPIRIT_MAX, this.spirit + damage * 0.5);
        this.comboTaken++;

        const away = this.position.subtract(attacker.position);
        away.y = 0;
        away.normalize();
        const head = move.zone === 'head';
        this.model.hitFlash(undefined, counter ? 1 : 0.75);
        if (head) this.model.snapHead((counter ? 9 : 5.5) * (0.6 + damage / 20));
        else this.model.bendBody(6 + damage / 3);

        if (this.health <= 0) {
            this.knockdown(away, hit);
            return;
        }
        if (this.superArmor) return;

        this.specialQueue = null;
        this.stunTime = move.hitstun * (counter ? 1.5 : 1) * (this.comboTaken > 3 ? 0.8 : 1);
        this.pushVel.copyFrom(away.scale(move.push * (counter ? 1.5 : 1)));
        this.setState(STATE.HIT);
        const c = head ? CLIPS.hitHead : CLIPS.hitBody;
        const clipLen = (c.end - c.start) / 60;
        this.model.play(c.clip, { from: c.start, to: c.end, speed: clipLen / (this.stunTime + 0.25), fade: 0.04 });
    }

    /** @param {{ attacker: Fighter, move: object, chip: number, drain: number }} hit */
    receiveBlock(hit) {
        const { attacker, move, chip, drain } = hit;
        this.health = Math.max(1, this.health - chip);
        this.stamina -= drain;
        const away = this.position.subtract(attacker.position);
        away.y = 0;
        away.normalize();
        this.pushVel.copyFrom(away.scale(move.push * 0.6));
        this.model.snapHead(2.5);
        this.model.hitFlash(undefined, 0.25);
        if (this.stamina <= 0) {
            this.stamina = 0;
            this.stunTime = 0.85;
            this.setState(STATE.HIT);
            this.model.play(CLIPS.hitBody.clip, { from: CLIPS.hitBody.start, to: CLIPS.hitBody.end, speed: 1.1, fade: 0.05 });
            this.events.emit('guardBreak', { fighter: this });
            return;
        }
        this.stunTime = move.blockstun;
        this.setState(STATE.BLOCK);
    }

    knockdown(away) {
        this.specialQueue = null;
        this.superArmor = false;
        this.health = 0;
        this.recoverable = 0;
        this.knockdownsTaken++;
        this.roundKnockdowns++;
        this.mashCount = 0;
        this.pushVel.copyFrom(away.scale(1.6));
        this.moveVel.setAll(0);
        this.setState(STATE.DOWN);
        this.model.guardTarget = 0;
        if (this.model.has('knockedOut')) {
            // Authored fall: play it once, then hold the last frame.
            const g = this.model.groups.knockedOut;
            this.model.play('knockedOut', { fade: 0.08 });
            this.holdClip = { clip: 'knockedOut', at: (g.to - g.from) / 60, frame: g.to - 1 };
        } else {
            const c = CLIPS.hitHead;
            this.model.play(c.clip, { from: c.start, to: c.end, frame: 16, fade: 0.08 });
            this.model.fallTarget = 1;
        }
        this.events.emit('knockdown', { fighter: this });
    }

    /** Beat the count. */
    rise() {
        const ratio = Math.max(0.22, 0.6 - 0.12 * (this.knockdownsTaken - 1));
        this.health = this.maxHealth * ratio;
        this.stamina = Math.max(this.stamina, this.maxStamina * 0.5);
        this.setState(STATE.RISE);
        this.holdClip = null;
        this.model.fallTarget = 0;
        if (this.model.has('getUp')) {
            const g = this.model.groups.getUp;
            this.model.play('getUp', { speed: (g.to - g.from) / 60 / RISE_TIME, fade: 0.1 });
        } else {
            this.model.play(CLIPS.idle.clip, { fade: 0.5 });
        }
        this.events.emit('rise', { fighter: this });
    }

    stayDown() {
        this.setState(STATE.KO);
    }

    celebrate() {
        this.setState(STATE.WIN);
        this.model.guardTarget = 0;
        this.model.play(this.model.has('victory') ? 'victory' : CLIPS.warmup.clip, { fade: 0.4 });
    }

    /** Between rounds: partial recovery. */
    recoverBetweenRounds() {
        const missing = this.maxHealth - this.health;
        this.health += missing * 0.35 + this.recoverable;
        this.health = Math.min(this.maxHealth, this.health);
        this.recoverable = 0;
        this.stamina = this.maxStamina;
        this.roundKnockdowns = 0;
        this.comboTaken = 0;
    }
}
