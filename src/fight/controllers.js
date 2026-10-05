import { STATE } from './Fighter.js';
import { MOVES } from './moves.js';

const PUNCHES = new Set(['jab', 'straight', 'hook', 'uppercut', 'body']);

/** Reads a player's keyboard/gamepad into the fighter's intent. */
export class HumanController {
    /** @param {import('../core/Input.js').Input} input  @param {number} player */
    constructor(input, player) {
        this.input = input;
        this.player = player;
        this.isHuman = true;
    }

    update(dt, fighter) {
        const move = this.input.getMove(this.player);
        fighter.intent.moveX = move.x;
        fighter.intent.moveY = move.y;
        fighter.intent.guard = this.input.isHeld(this.player, 'guard');
        for (const action of this.input.drain(this.player)) {
            if (PUNCHES.has(action)) fighter.pressPunch(action);
            else if (action === 'dodge') fighter.pressDodge();
            else if (action === 'special') fighter.pressSpecial();
        }
    }
}

export const DIFFICULTY = {
    easy: { label: 'Rookie', reaction: 0.42, block: 0.22, dodge: 0.08, aggression: 0.55, combo: 0.35, counter: 0.15, mash: 5.5, think: 0.32 },
    normal: { label: 'Pro', reaction: 0.27, block: 0.48, dodge: 0.22, aggression: 0.8, combo: 0.6, counter: 0.4, mash: 6.5, think: 0.2 },
    hard: { label: 'Champion', reaction: 0.16, block: 0.7, dodge: 0.42, aggression: 1.0, combo: 0.85, counter: 0.7, mash: 8.5, think: 0.12 },
};

/** CPU boxer. Uses the roster entry's `ai` profile plus a difficulty level. */
export class AIController {
    constructor(difficulty = 'normal') {
        this.d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
        this.isHuman = false;
        this.think = 0;
        this.attackCooldown = 1.2;
        this.combo = null;
        this.reactTimer = -1;
        this.reaction = null;
        this.guardHold = 0;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeTimer = 1;
        this.lastOpponentState = null;
        this.lastOwnState = null;
        this.mashTimer = 0;
    }

    update(dt, me) {
        const op = me.opponent;
        const p = me.data.ai;
        const d = this.d;
        const intent = me.intent;

        if (me.state === STATE.DOWN) {
            this.mashTimer -= dt;
            const rate = d.mash * Math.max(0.35, 1 - 0.22 * (me.knockdownsTaken - 1)) * (0.75 + Math.random() * 0.5);
            if (this.mashTimer <= 0) {
                me.pressPunch('jab');
                this.mashTimer = 1 / rate;
            }
            return;
        }
        if (me.state === STATE.FROZEN || me.state === STATE.WIN || me.state === STATE.KO) {
            intent.moveX = 0;
            intent.moveY = 0;
            intent.guard = false;
            return;
        }

        const dist = Math.hypot(op.position.x - me.position.x, op.position.z - me.position.z);
        const lowHealth = me.healthRatio < 0.35;
        const tired = me.staminaRatio < 0.25;

        // --- Defense: react to the opponent starting a punch.
        const opAttacking = op.state === STATE.ATTACK && !op.impactDone;
        if (opAttacking && this.lastOpponentState !== 'winding') {
            this.lastOpponentState = 'winding';
            const inRange = dist < op.move.range * op.reach + 0.25;
            if (inRange) {
                this.reactTimer = d.reaction * (0.7 + Math.random() * 0.6);
                const roll = Math.random();
                const dodgeChance = op.move.zone === 'head' ? d.dodge * (0.6 + p.dodge) : 0;
                const blockChance = d.block * (0.6 + p.guard) * (lowHealth ? 1.25 : 1);
                this.reaction = roll < dodgeChance ? 'dodge' : roll < dodgeChance + blockChance ? 'guard' : null;
            }
        } else if (!opAttacking) {
            this.lastOpponentState = op.state;
        }
        if (this.reactTimer >= 0) {
            this.reactTimer -= dt;
            if (this.reactTimer < 0 && this.reaction) {
                if (this.reaction === 'dodge' && me.canAct) me.pressDodge();
                else if (this.reaction === 'guard') this.guardHold = 0.45 + Math.random() * 0.3;
                this.reaction = null;
            }
        }
        this.guardHold -= dt;

        // --- Counter after a successful block or evade.
        const evaded = this.lastOwnState === STATE.DODGE && me.state !== STATE.DODGE && me.counterBonus > 0;
        const blocked = this.lastOwnState === STATE.BLOCK && me.state === STATE.IDLE;
        if ((evaded || blocked) && Math.random() < d.counter) {
            me.pressPunch(Math.random() < 0.5 ? 'straight' : 'hook');
            this.guardHold = 0;
        }
        this.lastOwnState = me.state;

        // --- Special.
        if (me.spiritFull && me.canAct && Math.random() < dt * 1.5) {
            const special = me.data.special.id;
            if (special === 'jolt' && dist < 1.5 && op.state === STATE.IDLE) me.pressSpecial();
            if (special !== 'jolt' && dist < 1.1 && !op.isGuarding) me.pressSpecial();
        }

        // --- Offense: combos.
        this.attackCooldown -= dt;
        if (this.combo && me.state === STATE.ATTACK && me.impactDone) {
            if (this.combo.length && (me.connected || Math.random() < 0.3)) me.pressPunch(this.combo.shift());
            else this.combo = null;
        }
        const reach = me.reach;
        const preferred = p.range * reach + (lowHealth ? 0.25 : 0) + (tired ? 0.3 : 0);
        // Throwing into an incoming punch is a deliberate counter attempt, not a habit.
        const trading = opAttacking && Math.random() > d.counter * 0.35;
        if (me.canAct && this.attackCooldown <= 0 && !tired && !trading) {
            const opener = this.pickOpener(dist, reach);
            if (opener) {
                const combos = p.combos.filter((c) => c[0] === opener);
                const useCombo = combos.length && Math.random() < d.combo;
                this.combo = useCombo ? combos[Math.floor(Math.random() * combos.length)].slice(1) : null;
                me.pressPunch(opener);
                const aggression = p.aggression * d.aggression * (lowHealth ? 0.7 : 1);
                this.attackCooldown = (1.7 - aggression * 1.25) * (0.6 + Math.random() * 0.8);
            }
        }

        // --- Footwork.
        this.think -= dt;
        if (this.think <= 0) {
            this.think = d.think * (0.7 + Math.random() * 0.6);
            let y = 0;
            if (dist > preferred + 0.15) y = 1;
            else if (dist < preferred - 0.22) y = -0.8;
            if (tired && dist < 1.4) y = -1;
            this.strafeTimer -= this.think;
            if (this.strafeTimer <= 0) {
                this.strafeDir = Math.random() < 0.5 ? -1 : 1;
                this.strafeTimer = 0.8 + Math.random() * 2;
            }
            const strafe = (1 - p.aggression * 0.5) * (Math.abs(y) < 0.5 ? 0.85 : 0.35);
            this.move = { x: this.strafeDir * strafe, y };
        }
        intent.moveX = this.move?.x ?? 0;
        intent.moveY = this.move?.y ?? 0;
        const idleGuard = dist < 1.6 && (lowHealth || tired) && Math.random() < 0.02;
        if (idleGuard) this.guardHold = Math.max(this.guardHold, 0.6);
        intent.guard = this.guardHold > 0;
    }

    pickOpener(dist, reach) {
        const options = [];
        for (const [id, move] of Object.entries(MOVES)) {
            if (dist <= move.range * reach - 0.02) options.push(id);
        }
        if (!options.length) return null;
        return options[Math.floor(Math.random() * options.length)];
    }
}
