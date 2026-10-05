import { Vector3, Matrix } from '@babylonjs/core';
import { BINDINGS } from '../core/Input.js';

const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
};

/** Fight HUD: bars, clock, banners, the 10-count, onomatopoeia popups and callouts. */
export class Hud {
    constructor(container, { input, settings }) {
        this.container = container;
        this.input = input;
        this.settings = settings;
        this.el = h(`<div>
            <div class="hud-top">
                ${this.fighterBlock('left')}
                <div class="center-hud"><div class="clock">3:00</div><div class="round-label">ROUND 1</div></div>
                ${this.fighterBlock('right')}
            </div>
            <div class="popups"></div>
            <div class="combo left"></div>
            <div class="combo right"></div>
            <div class="count" style="display:none"></div>
            <div class="rise" style="display:none"><span class="mash">MASH PUNCH TO GET UP!</span><div class="bar"><div class="fill"></div></div></div>
            <div class="banner"></div>
            <div class="hints"></div>
        </div>`);
        container.innerHTML = '';
        container.appendChild(this.el);
        this.sides = ['left', 'right'].map((side) => {
            const root = this.el.querySelector(`.fighter-hud.${side}`);
            return {
                root,
                name: root.querySelector('.name'),
                jp: root.querySelector('.jp'),
                kd: root.querySelector('.knockdowns'),
                hp: root.querySelector('.hp'),
                hpFill: root.querySelector('.hp .fill'),
                hpRec: root.querySelector('.hp .rec'),
                hpLost: root.querySelector('.hp .lost'),
                st: root.querySelector('.st .fill'),
                spirit: root.querySelector('.spirit'),
                spiritFill: root.querySelector('.spirit .fill'),
                ready: root.querySelector('.special-ready'),
            };
        });
        this.clockEl = this.el.querySelector('.clock');
        this.roundEl = this.el.querySelector('.round-label');
        this.bannerEl = this.el.querySelector('.banner');
        this.countEl = this.el.querySelector('.count');
        this.riseEl = this.el.querySelector('.rise');
        this.riseFill = this.riseEl.querySelector('.fill');
        this.popups = this.el.querySelector('.popups');
        this.comboEls = [this.el.querySelector('.combo.left'), this.el.querySelector('.combo.right')];
        this.hintsEl = this.el.querySelector('.hints');
        this.comboTimers = [0, 0];
        this.cache = {};
    }

    fighterBlock(side) {
        return `<div class="fighter-hud ${side}">
            <div class="label"><span class="name">BOXER</span><span class="jp"></span><span class="knockdowns"></span></div>
            <div class="bar hp"><div class="lost"></div><div class="rec"></div><div class="fill"></div></div>
            <div class="bar thin st"><div class="fill"></div></div>
            <div class="bar spirit"><div class="fill"></div></div>
            <div class="special-ready"></div>
        </div>`;
    }

    /** @param {import('../fight/FightSession.js').FightSession} session */
    bind(session, mode) {
        this.session = session;
        this.mode = mode;
        session.fighters.forEach((f, i) => {
            const s = this.sides[i];
            s.name.textContent = f.data.short;
            s.jp.textContent = f.data.jp;
        });
        this.showHints(mode);
        this.hideCount();
        this.bannerEl.className = 'banner';
    }

    showHints(mode) {
        if (!this.settings.get('hints')) {
            this.hintsEl.innerHTML = '';
            return;
        }
        const map = mode === 'cpu' ? BINDINGS.solo[0] : BINDINGS.versus[0];
        const k = (codes) => `<kbd>${this.input.keyLabel(codes[0])}</kbd>`;
        const m = map.move;
        this.hintsEl.innerHTML = [
            `${k(m.up)}${k(m.left)}${k(m.down)}${k(m.right)} Move`,
            `${k(map.jab)} Jab`, `${k(map.straight)} Straight`, `${k(map.hook)} Hook`, `${k(map.uppercut)} Upper`,
            `${k(map.body)} Body`, `${k(map.guard)} Guard`, `${k(map.dodge)} Duck`, `${k(map.special)} Special`,
            mode === 'cpu' ? '<kbd>Tab</kbd> Camera' : '',
        ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
        this.hintsEl.classList.remove('fade');
    }

    fadeHints() {
        this.hintsEl.classList.add('fade');
    }

    update(dt) {
        const session = this.session;
        if (!session) return;
        session.fighters.forEach((f, i) => {
            const s = this.sides[i];
            const hp = (f.health / f.maxHealth) * 100;
            const rec = Math.min(100, ((f.health + f.recoverable) / f.maxHealth) * 100);
            this.setWidth(`hp${i}`, s.hpFill, hp);
            this.setWidth(`rec${i}`, s.hpRec, rec);
            this.setWidth(`lost${i}`, s.hpLost, rec);
            this.setWidth(`st${i}`, s.st, (f.stamina / f.maxStamina) * 100);
            this.setWidth(`sp${i}`, s.spiritFill, f.spirit);
            s.hp.classList.toggle('low', hp < 25);
            s.spirit.classList.toggle('ready', f.spiritFull);
            const readyText = f.spiritFull ? `${f.data.special.name.toUpperCase()} READY!` : '';
            if (s.ready.textContent !== readyText) s.ready.textContent = readyText;
            const kd = '●'.repeat(f.roundKnockdowns);
            if (s.kd.textContent !== kd) s.kd.textContent = kd;
        });
        const clock = Math.ceil(session.clock);
        const clockText = `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`;
        if (this.clockEl.textContent !== clockText) this.clockEl.textContent = clockText;
        this.clockEl.classList.toggle('low', session.clock <= 10 && session.phase === 'fight');
        const roundText = `ROUND ${Math.max(1, session.round)} / ${session.rounds}`;
        if (this.roundEl.textContent !== roundText) this.roundEl.textContent = roundText;
        if (session.phase === 'count' && session.downed && this.riseEl.style.display !== 'none') {
            this.riseFill.style.width = `${session.riseProgress * 100}%`;
        }
        for (let i = 0; i < 2; i++) {
            if (this.comboTimers[i] > 0) {
                this.comboTimers[i] -= dt;
                if (this.comboTimers[i] <= 0) this.comboEls[i].classList.remove('show');
            }
        }
    }

    setWidth(key, el, pct) {
        const v = Math.max(0, Math.min(100, pct)).toFixed(1);
        if (this.cache[key] === v) return;
        this.cache[key] = v;
        el.style.width = `${v}%`;
    }

    banner(text, { sub = '', style = '', duration = 1.4 } = {}) {
        const el = this.bannerEl;
        el.className = `banner ${style}`;
        el.innerHTML = `${text}${sub ? `<span class="sub">${sub}</span>` : ''}`;
        void el.offsetWidth;
        el.classList.add('show');
        clearTimeout(this.bannerTimer);
        if (duration > 0) {
            this.bannerTimer = setTimeout(() => {
                el.classList.remove('show');
                el.classList.add('hide');
            }, duration * 1000);
        }
    }

    hideBanner() {
        clearTimeout(this.bannerTimer);
        this.bannerEl.className = 'banner';
    }

    showCount(n, humanDown) {
        this.countEl.style.display = 'block';
        this.countEl.textContent = n;
        this.countEl.classList.remove('pop');
        void this.countEl.offsetWidth;
        this.countEl.classList.add('pop');
        this.riseEl.style.display = humanDown ? 'block' : 'none';
    }

    hideCount() {
        this.countEl.style.display = 'none';
        this.riseEl.style.display = 'none';
    }

    showRisePrompt(show) {
        this.riseEl.style.display = show ? 'block' : 'none';
        this.riseFill.style.width = '0%';
    }

    /** Manga sound-effect text at a world position. */
    sfxText(text, worldPos, scene, { size = 48, kind = '' } = {}) {
        const engine = scene.getEngine();
        const camera = scene.activeCamera;
        const w = engine.getRenderWidth();
        const hgt = engine.getRenderHeight();
        const p = Vector3.Project(worldPos, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, hgt));
        if (p.z < 0 || p.z > 1) return;
        const rect = this.container.getBoundingClientRect();
        const x = (p.x / w) * rect.width + (Math.random() - 0.5) * 60;
        const y = (p.y / hgt) * rect.height - 40 + (Math.random() - 0.5) * 30;
        const el = document.createElement('div');
        el.className = `sfx-text ${kind}`;
        el.textContent = text;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.fontSize = `${size}px`;
        el.style.setProperty('--rot', `${(Math.random() - 0.5) * 24}deg`);
        this.popups.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    callout(side, text, { jp = '', style = '' } = {}) {
        const el = document.createElement('div');
        el.className = `callout ${side} ${style}`;
        el.innerHTML = `${text}${jp ? `<span class="jp">${jp}</span>` : ''}`;
        this.popups.appendChild(el);
        setTimeout(() => el.remove(), 1250);
    }

    combo(index, hits) {
        if (hits < 2) return;
        const el = this.comboEls[index];
        el.innerHTML = `${hits} HITS<small>COMBO</small>`;
        el.classList.add('show');
        this.comboTimers[index] = 1.2;
    }

    clear() {
        this.popups.innerHTML = '';
        this.hideCount();
        this.hideBanner();
    }
}
