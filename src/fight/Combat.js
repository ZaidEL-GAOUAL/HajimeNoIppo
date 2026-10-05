import { Vector3 } from '@babylonjs/core';
import { STATE } from './Fighter.js';

const FACING_COS = Math.cos((42 * Math.PI) / 180);
const GUARD_COS = Math.cos((80 * Math.PI) / 180);
const DAMAGE_SCALE = 0.8;
// A punch only counts as a counter if the victim was already committed to their own punch.
const COUNTER_COMMIT = 0.06;

/**
 * Resolves a punch at its impact frame: whiff, evade, jolt counter, block or clean hit.
 * Emits 'hit' | 'block' | 'whiff' | 'evade' | 'jolt' on the shared emitter for FX, audio and UI.
 */
export class Combat {
    /** @param {import('../core/Emitter.js').Emitter} events */
    constructor(events) {
        this.events = events;
        /** Punches only land while the referee lets them box. */
        this.live = false;
        events.on('impact', (e) => this.resolve(e.attacker, e.move, e.mods));
    }

    resolve(attacker, move, mods) {
        const defender = attacker.opponent;
        const toDef = defender.position.subtract(attacker.position);
        toDef.y = 0;
        const dist = toDef.length();
        const dir = dist > 1e-4 ? toDef.scale(1 / dist) : attacker.forward;
        const range = (mods?.range ?? move.range) * attacker.reach;
        const aimed = Vector3.Dot(attacker.forward, dir) >= FACING_COS;
        const point = this.impactPoint(attacker, defender, move);

        if (!this.live || dist > range || !aimed || defender.isDown || defender.state === STATE.WIN) {
            this.events.emit('whiff', { attacker, defender, move, point });
            return;
        }
        if (defender.state === STATE.JOLT) {
            this.events.emit('jolt', { attacker, defender, move, point });
            defender.joltCounter();
            return;
        }
        if (defender.isEvading && move.zone === 'head') {
            defender.counterBonus = 0.8;
            defender.spirit = Math.min(100, defender.spirit + 5);
            this.events.emit('evade', { attacker, defender, move, point });
            return;
        }
        const defFacing = Vector3.Dot(defender.forward, dir.scale(-1)) >= GUARD_COS;
        if (defender.isGuarding && defFacing && !mods?.jolt) {
            const bodyShot = move.zone === 'body';
            const power = attacker.data.stats.power;
            const chip = move.damage * power * (bodyShot ? 0.35 : 0.12);
            const drain = move.guardDrain * (mods?.guardDrain ?? 1) * (bodyShot ? 1.3 : 1) / defender.data.stats.defense;
            attacker.connected = true;
            attacker.stats.blocked++;
            defender.receiveBlock({ attacker, move, chip, drain });
            attacker.spirit = Math.min(100, attacker.spirit + 1);
            this.events.emit('block', { attacker, defender, move, point });
            return;
        }

        const committed = defender.isWindingUp && defender.stateTime >= COUNTER_COMMIT;
        const counter = committed || attacker.counterBonus > 0 || !!mods?.jolt;
        const fatigue = 0.7 + 0.3 * attacker.staminaRatio;
        const comboScale = Math.max(0.45, 1 - 0.1 * defender.comboTaken);
        let damage = DAMAGE_SCALE * move.damage * attacker.data.stats.power * fatigue * comboScale * (mods?.damage ?? 1);
        if (counter) damage *= mods?.jolt ? 1 : 1.4;
        damage /= defender.chinFactor;
        // A tired body is easier to hurt.
        if (defender.staminaRatio < 0.25) damage *= 1.15;
        attacker.counterBonus = 0;
        attacker.connected = true;
        attacker.comboDealt++;
        attacker.stats.landed++;
        attacker.stats.damage += damage;
        attacker.stats.maxCombo = Math.max(attacker.stats.maxCombo, attacker.comboDealt);
        if (counter) attacker.stats.counters++;
        attacker.spirit = Math.min(100, attacker.spirit + damage * 0.38);
        defender.receiveHit({ attacker, move, damage, counter });
        if (defender.state === STATE.DOWN) attacker.stats.knockdowns++;
        this.events.emit('hit', {
            attacker, defender, move, point, damage, counter,
            combo: attacker.comboDealt, knockdown: defender.state === STATE.DOWN, special: !!mods?.special,
        });
    }

    /** Where the spark goes: the defender's head or chest, nudged toward the attacking glove. */
    impactPoint(attacker, defender, move) {
        const target = defender.model.getBonePosition(move.zone === 'head' ? 'Head' : 'Spine1').clone();
        if (move.zone === 'head') target.y += 0.06;
        const glove = attacker.model.getGlovePosition(move.hand);
        return Vector3.Lerp(target, glove, 0.35);
    }
}
