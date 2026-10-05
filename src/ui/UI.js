import { FIGHTERS, getFighter } from '../data/fighters.js';
import { OPTIONS } from '../core/Settings.js';
import { DIFFICULTY } from '../fight/controllers.js';
import { BINDINGS, PAD } from '../core/Input.js';

const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
};

const PAD_NAMES = ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'Back', 'Start', 'L3', 'R3'];
const ACTION_LABELS = {
    jab: 'Body Jab', straight: 'Straight', hook: 'Hook', uppercut: 'Uppercut', body: 'Body Blow',
    guard: 'Guard (hold)', dodge: 'Duck / Slip', special: 'Special',
};
const OPTION_LABELS = {
    rounds: ['Rounds', 'ラウンド'],
    roundTime: ['Round length', 'ラウンド時間'],
    difficulty: ['CPU level', 'CPUレベル'],
    camera: ['Camera', 'カメラ'],
    quality: ['Graphics', 'グラフィック'],
    master: ['Master volume', 'マスター'],
    sfx: ['Effects volume', '効果音'],
    crowd: ['Crowd volume', '観客'],
    hints: ['Control hints', 'ヒント'],
};

function formatOption(key, value) {
    if (key === 'roundTime') return value >= 60 ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` : `${value}s`;
    if (key === 'difficulty') return DIFFICULTY[value].label;
    if (key === 'camera') return value === 'broadcast' ? 'TV' : 'Behind';
    if (key === 'quality') return value === 'high' ? 'High' : 'Low';
    if (['master', 'sfx', 'crowd'].includes(key)) return `${Math.round(value * 100)}%`;
    if (key === 'hints') return value ? 'On' : 'Off';
    return String(value);
}

/**
 * DOM screens and menu navigation (keyboard, gamepad and mouse).
 * `game` provides the callbacks: startSelect(mode), previewFighters(p1, p2), startFight(cfg),
 * resume(), restart(), quitToMenu(), rematch(), applySettings(key).
 */
export class UI {
    constructor(root, { input, settings, audio, game }) {
        this.root = root;
        this.input = input;
        this.settings = settings;
        this.audio = audio;
        this.game = game;
        this.screens = {};
        this.current = null;
        this.nav = null;
        this.stack = [];
        this.build();
    }

    build() {
        const add = (id, el) => {
            el.id = id;
            el.classList.add('screen');
            this.root.appendChild(el);
            this.screens[id] = el;
            return el;
        };
        add('loading', h(`<div><div class="box"><div class="logo-jp">はじめの一歩</div><div class="bar"><div class="fill"></div></div><div class="label">Loading…</div></div></div>`));
        add('title', h(`<div>
            <div class="title-block">
                <div class="logo-jp">はじめの一歩</div>
                <div class="logo-en">HAJIME NO IPPO</div>
                <div class="logo-sub">THE FIRST STEP</div>
            </div>
            <div class="press-start">PRESS ANY KEY</div>
            <div class="version">v0.3</div>
        </div>`));
        add('menu', h(`<div class="menu-screen">
            <div class="menu-header stroke">MAIN MENU<span class="jp">メインメニュー</span></div>
            <div class="menu-list">
                <div class="btn" data-id="cpu"><span>VS CPU</span><span class="hint-jp">一人で</span></div>
                <div class="btn" data-id="versus"><span>VS PLAYER</span><span class="hint-jp">二人で</span></div>
                <div class="btn" data-id="controls"><span>CONTROLS</span><span class="hint-jp">操作方法</span></div>
                <div class="btn" data-id="options"><span>OPTIONS</span><span class="hint-jp">設定</span></div>
            </div>
            <div class="footer-hint"></div>
        </div>`));
        add('options', h(`<div class="menu-screen">
            <div class="menu-header stroke">OPTIONS<span class="jp">設定</span></div>
            <div class="menu-list" style="top:22%; width:min(560px, 88vw)"></div>
            <div class="footer-hint"></div>
        </div>`));
        add('controls', h(`<div><div class="controls-wrap"></div></div>`));
        add('select', h(`<div>
            <div class="select-title stroke">CHOOSE YOUR BOXER</div>
            <div class="select-step"></div>
            <div class="card p1"></div>
            <div class="vs-badge">VS</div>
            <div class="card p2"></div>
            <div class="difficulty-row"></div>
        </div>`));
        add('hud', h(`<div class="passthrough"></div>`));
        add('pause', h(`<div class="menu-screen">
            <div class="menu-header stroke">PAUSE<span class="jp">一時停止</span></div>
            <div class="menu-list">
                <div class="btn" data-id="resume"><span>RESUME</span></div>
                <div class="btn" data-id="controls"><span>CONTROLS</span></div>
                <div class="btn" data-id="restart"><span>RESTART FIGHT</span></div>
                <div class="btn" data-id="quit"><span>QUIT TO MENU</span></div>
            </div>
        </div>`));
        add('results', h(`<div><div class="results-wrap"></div></div>`));
        this.toastEl = h('<div class="toast"></div>');
        this.root.appendChild(this.toastEl);
    }

    // ---- Screen switching -------------------------------------------------------------------------

    show(id, data) {
        for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('active', key === id || (key === 'hud' && id === 'pause'));
        this.current = id;
        this.nav = null;
        const enter = this[`enter_${id}`];
        if (enter) enter.call(this, data);
    }

    /** Overlay a screen and come back to the current one with `back`. */
    push(id, data) {
        this.stack.push({ id: this.current, nav: this.nav });
        this.show(id, data);
    }

    pop() {
        const prev = this.stack.pop();
        if (!prev) return;
        this.show(prev.id);
        if (prev.nav && this.nav) this.nav.focus(prev.nav.index);
    }

    setLoading(progress, label) {
        const el = this.screens.loading;
        el.querySelector('.fill').style.width = `${Math.round(progress * 100)}%`;
        if (label) el.querySelector('.label').textContent = label;
    }

    toast(text, ms = 1600) {
        this.toastEl.textContent = text;
        this.toastEl.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
    }

    /** Route menu input for the active screen. Call once per frame. */
    update() {
        const actions = this.input.drainMenu();
        if (this.current === 'title') {
            if (this.input.anyPressed) {
                this.input.anyPressed = false;
                this.audio.play('menuSelect');
                this.show('menu');
            }
            return;
        }
        for (const action of actions) this.handle(action);
    }

    handle(action) {
        const handler = this[`input_${this.current}`];
        if (handler && handler.call(this, action)) return;
        const nav = this.nav;
        if (!nav) return;
        if (action === 'up' || action === 'down') {
            nav.move(action === 'up' ? -1 : 1);
            this.audio.play('menuMove');
        } else if (action === 'left' || action === 'right') {
            const item = nav.items[nav.index];
            const fn = action === 'left' ? item?.onLeft : item?.onRight;
            if (fn) {
                fn();
                this.audio.play('menuMove');
            }
        } else if (action === 'confirm') {
            nav.activate();
        } else if (action === 'back' || action === 'pause') {
            if (nav.onBack) {
                this.audio.play('menuBack');
                nav.onBack();
            }
        }
    }

    makeNav(items, { onBack, start = 0 } = {}) {
        const audio = this.audio;
        const nav = {
            items,
            index: start,
            onBack,
            focus(i) {
                this.index = (i + items.length) % items.length;
                items.forEach((it, k) => it.el.classList.toggle('focus', k === this.index));
            },
            move(d) {
                this.focus(this.index + d);
            },
            activate() {
                const it = items[this.index];
                if (it?.onConfirm) {
                    audio.play('menuSelect');
                    it.onConfirm();
                } else if (it?.onRight) {
                    it.onRight();
                    audio.play('menuMove');
                }
            },
        };
        items.forEach((it, k) => {
            it.el.onmouseenter = () => nav.focus(k);
            it.el.onclick = (e) => {
                nav.focus(k);
                const rect = it.el.getBoundingClientRect();
                if (it.onLeft && e.clientX < rect.left + rect.width * 0.55 && !it.onConfirm) {
                    it.onLeft();
                    audio.play('menuMove');
                } else nav.activate();
            };
        });
        nav.focus(start);
        this.nav = nav;
        return nav;
    }

    // ---- Screens ----------------------------------------------------------------------------------

    enter_title() {
        this.input.anyPressed = false;
    }

    enter_menu() {
        const el = this.screens.menu;
        const get = (id) => el.querySelector(`[data-id="${id}"]`);
        el.querySelector('.footer-hint').innerHTML = `${this.keyHint('confirm')} Select &nbsp; ${this.keyHint('back')} Back`;
        this.makeNav([
            { el: get('cpu'), onConfirm: () => this.game.startSelect('cpu') },
            { el: get('versus'), onConfirm: () => this.game.startSelect('versus') },
            { el: get('controls'), onConfirm: () => this.push('controls') },
            { el: get('options'), onConfirm: () => this.push('options') },
        ], { onBack: () => this.show('title'), start: this.menuIndex ?? 0 });
        const nav = this.nav;
        const focus = nav.focus.bind(nav);
        nav.focus = (i) => {
            focus(i);
            this.menuIndex = nav.index;
        };
    }

    enter_options() {
        const list = this.screens.options.querySelector('.menu-list');
        list.innerHTML = '';
        const items = [];
        for (const key of Object.keys(OPTIONS)) {
            const [label, jp] = OPTION_LABELS[key];
            const row = h(`<div class="btn"><span>${label} <span class="hint-jp">${jp}</span></span><span class="option-value"></span></div>`);
            const value = row.querySelector('.option-value');
            const refresh = () => { value.textContent = formatOption(key, this.settings.get(key)); };
            refresh();
            const change = (dir) => {
                this.settings.cycle(key, dir);
                refresh();
                this.game.applySettings(key);
            };
            list.appendChild(row);
            items.push({ el: row, onLeft: () => change(-1), onRight: () => change(1) });
        }
        const back = h('<div class="btn"><span>BACK</span><span class="hint-jp">戻る</span></div>');
        list.appendChild(back);
        items.push({ el: back, onConfirm: () => this.pop() });
        this.screens.options.querySelector('.footer-hint').innerHTML = `◀ ▶ Change &nbsp; ${this.keyHint('back')} Back`;
        this.makeNav(items, { onBack: () => this.pop() });
    }

    enter_controls() {
        const wrap = this.screens.controls.querySelector('.controls-wrap');
        const keys = (codes) => codes.map((c) => `<kbd>${this.input.keyLabel(c)}</kbd>`).join('');
        const card = (title, map) => {
            const move = map.move;
            let rows = `<div class="ctrl-row"><span>Move</span><span>${keys([move.up[0], move.left[0], move.down[0], move.right[0]])}</span></div>`;
            for (const action of Object.keys(ACTION_LABELS)) {
                rows += `<div class="ctrl-row"><span>${ACTION_LABELS[action]}</span><span>${keys(map[action])}</span></div>`;
            }
            return `<div class="ctrl-card"><h3>${title}</h3>${rows}</div>`;
        };
        let pad = '<div class="ctrl-row"><span>Move</span><span><kbd>L-Stick</kbd><kbd>D-Pad</kbd></span></div>';
        for (const action of Object.keys(ACTION_LABELS)) {
            pad += `<div class="ctrl-row"><span>${ACTION_LABELS[action]}</span><span>${PAD[action].map((b) => `<kbd>${PAD_NAMES[b]}</kbd>`).join('')}</span></div>`;
        }
        pad += '<div class="ctrl-row"><span>Pause / Camera</span><span><kbd>Start</kbd><kbd>Back</kbd></span></div>';
        wrap.innerHTML = `
            <div class="menu-header stroke" style="position:static">CONTROLS<span class="jp">操作方法</span></div>
            <div class="controls-grid">
                ${card('VS CPU — keyboard', BINDINGS.solo[0])}
                ${card('2P — Player 1 (left)', BINDINGS.versus[0])}
                ${card('2P — Player 2 (right)', BINDINGS.versus[1])}
                <div class="ctrl-card"><h3>Gamepad</h3>${pad}</div>
            </div>
            <p>Movement is relative to your opponent: forward always steps in, left/right circles around them.
            Keys follow your keyboard layout (ZQSD on AZERTY). <b>Esc</b> pauses, <b>Tab</b> switches camera in VS CPU.
            Land a punch while the opponent is winding up for a COUNTER. Ducking a head punch opens a counter window.
            Body blows drain stamina and chew through the guard. Fill the spirit bar to unleash your special.
            When you're knocked down, mash punch buttons to beat the count!</p>
            <p>In 2P with one gamepad, the gamepad controls Player 2. With two gamepads, each player gets one.</p>
            <div class="menu-list" style="position:static; margin-top:18px"><div class="btn"><span>BACK</span></div></div>`;
        const back = wrap.querySelector('.btn');
        this.makeNav([{ el: back, onConfirm: () => this.pop() }], { onBack: () => this.pop() });
    }

    // ---- Fighter select ---------------------------------------------------------------------------

    enter_select({ mode }) {
        this.select = {
            mode,
            step: 0,
            picks: [this.settings.get('p1'), this.settings.get('p2')],
        };
        if (this.select.picks[0] === this.select.picks[1] && mode === 'cpu') {
            this.select.picks[1] = FIGHTERS.find((f) => f.id !== this.select.picks[0]).id;
        }
        const el = this.screens.select;
        el.querySelectorAll('.card').forEach((card, i) => {
            card.onclick = (e) => {
                if (e.target.dataset.dir) this.cyclePick(i, +e.target.dataset.dir);
            };
        });
        el.querySelector('.difficulty-row').onclick = () => this.input_select('right');
        this.renderSelect();
        this.game.previewFighters(this.select.picks[0], this.select.picks[1]);
    }

    cyclePick(player, dir) {
        const s = this.select;
        if (player !== s.step) return;
        const i = FIGHTERS.findIndex((f) => f.id === s.picks[player]);
        s.picks[player] = FIGHTERS[(i + dir + FIGHTERS.length) % FIGHTERS.length].id;
        this.audio.play('menuMove');
        this.renderSelect();
        this.game.previewFighters(s.picks[0], s.picks[1]);
    }

    input_select(action) {
        const s = this.select;
        const last = s.mode === 'cpu' ? 2 : 1;
        if (action === 'left' || action === 'right') {
            const dir = action === 'left' ? -1 : 1;
            if (s.step < 2) this.cyclePick(s.step, dir);
            else {
                this.settings.cycle('difficulty', dir);
                this.audio.play('menuMove');
                this.renderSelect();
            }
            return true;
        }
        if (action === 'confirm') {
            this.audio.play('menuSelect');
            if (s.step < last) {
                s.step++;
                this.renderSelect();
            } else {
                this.settings.set('p1', s.picks[0]);
                this.settings.set('p2', s.picks[1]);
                this.game.startFight({ mode: s.mode, p1: s.picks[0], p2: s.picks[1] });
            }
            return true;
        }
        if (action === 'back' || action === 'pause') {
            this.audio.play('menuBack');
            if (s.step > 0) {
                s.step--;
                this.renderSelect();
            } else {
                this.game.quitToMenu();
            }
            return true;
        }
        return true;
    }

    renderSelect() {
        const s = this.select;
        const el = this.screens.select;
        const cpu = s.mode === 'cpu';
        const stepText = [
            'PLAYER 1 — ◀ ▶ to choose, confirm to lock',
            cpu ? 'CHOOSE YOUR OPPONENT' : 'PLAYER 2 — ◀ ▶ to choose, confirm to lock',
            'CPU LEVEL — ◀ ▶ to change, confirm to FIGHT!',
        ];
        el.querySelector('.select-step').textContent = stepText[s.step];
        el.querySelectorAll('.card').forEach((card, i) => {
            const f = getFighter(s.picks[i]);
            const who = i === 0 ? 'PLAYER 1' : cpu ? 'CPU' : 'PLAYER 2';
            const stat = (label, v) => `<div class="stat"><span>${label}</span><div class="track"><div class="val" style="width:${Math.min(100, (v / 1.35) * 100)}%"></div></div></div>`;
            card.innerHTML = `
                <div class="who"><span>${who}</span><span>${i === 0 ? 'RED CORNER' : 'BLUE CORNER'}</span></div>
                <div class="name-jp jp">${f.jp}</div>
                <div class="name">${f.name.toUpperCase()}</div>
                <div class="meta">${f.title} · ${f.style}</div>
                ${stat('POWER', f.stats.power)}${stat('SPEED', f.stats.speed)}${stat('STAMINA', f.stats.stamina)}${stat('CHIN', f.stats.chin)}${stat('DEFENSE', f.stats.defense)}
                <div class="special">SPECIAL: ${f.special.name} <span class="jp">${f.special.jp}</span></div>
                <div class="arrows"><span data-dir="-1">◀</span><span>${s.step > i ? 'READY!' : s.step === i ? '' : ''}</span><span data-dir="1">▶</span></div>`;
            card.classList.toggle('active', s.step === i);
            card.classList.toggle('locked', s.step > i);
        });
        const diff = el.querySelector('.difficulty-row');
        diff.style.display = cpu ? 'block' : 'none';
        diff.innerHTML = `CPU LEVEL: <span style="color:var(--gold)">◀ ${DIFFICULTY[this.settings.get('difficulty')].label} ▶</span>${s.step === 2 ? ' &nbsp;— confirm to FIGHT!' : ''}`;
    }

    // ---- Pause & results --------------------------------------------------------------------------

    enter_pause() {
        const el = this.screens.pause;
        const get = (id) => el.querySelector(`[data-id="${id}"]`);
        this.makeNav([
            { el: get('resume'), onConfirm: () => this.game.resume() },
            { el: get('controls'), onConfirm: () => this.push('controls') },
            { el: get('restart'), onConfirm: () => this.game.restart() },
            { el: get('quit'), onConfirm: () => this.game.quitToMenu() },
        ], { onBack: () => this.game.resume() });
    }

    enter_results(data) {
        if (!data) {
            // Coming back from an overlay: keep the existing content.
            this.bindResultsNav();
            return;
        }
        this.lastResults = data;
        const { result, fighters, scorecards, mode } = data;
        const wrap = this.screens.results.querySelector('.results-wrap');
        const winner = result.winner;
        const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        const methodText = result.method === 'Draw' ? 'DRAW' : result.method.includes('Decision')
            ? `${result.method.toUpperCase()}`
            : `${result.method} — ROUND ${result.round}, ${fmtTime(result.time)}`;
        const [a, b] = fighters;
        const acc = (f) => (f.stats.thrown ? Math.round((f.stats.landed / f.stats.thrown) * 100) : 0);
        const row = (label, x, y) => `<tr><td>${label}</td><td>${x}</td><td>${y}</td></tr>`;
        let cards = '';
        if (result.totals) {
            cards = `<div class="method" style="font-size:22px">JUDGES: ${result.totals.map(([x, y]) => `${x}–${y}`).join(' &nbsp; ')}</div>`;
        }
        const whoWon = winner ? (mode === 'cpu' ? (winner.index === 0 ? 'YOU WIN!' : 'YOU LOSE…') : `PLAYER ${winner.index + 1} WINS!`) : 'DRAW';
        wrap.innerHTML = `
            <div class="winner-jp jp">${winner ? winner.data.jp : '引き分け'}</div>
            <div class="winner">${whoWon}</div>
            <div class="method">${winner ? winner.data.name.toUpperCase() + ' · ' : ''}${methodText}</div>
            ${cards}
            <table class="stats-table">
                <tr><th></th><th>${a.data.short}</th><th>${b.data.short}</th></tr>
                ${row('Punches thrown', a.stats.thrown, b.stats.thrown)}
                ${row('Punches landed', a.stats.landed, b.stats.landed)}
                ${row('Accuracy', acc(a) + '%', acc(b) + '%')}
                ${row('Blocked by opponent', a.stats.blocked, b.stats.blocked)}
                ${row('Counters', a.stats.counters, b.stats.counters)}
                ${row('Knockdowns scored', a.stats.knockdowns, b.stats.knockdowns)}
                ${row('Best combo', a.stats.maxCombo, b.stats.maxCombo)}
                ${row('Damage dealt', Math.round(a.stats.damage), Math.round(b.stats.damage))}
            </table>
            <div class="menu-list">
                <div class="btn" data-id="rematch"><span>REMATCH</span><span class="hint-jp">再戦</span></div>
                <div class="btn" data-id="select"><span>CHANGE BOXERS</span><span class="hint-jp">選手変更</span></div>
                <div class="btn" data-id="menu"><span>MAIN MENU</span><span class="hint-jp">メニュー</span></div>
            </div>`;
        this.bindResultsNav();
        void scorecards;
    }

    bindResultsNav() {
        const wrap = this.screens.results.querySelector('.results-wrap');
        const get = (id) => wrap.querySelector(`[data-id="${id}"]`);
        if (!get('rematch')) return;
        this.makeNav([
            { el: get('rematch'), onConfirm: () => this.game.rematch() },
            { el: get('select'), onConfirm: () => this.game.startSelect(this.lastResults.mode) },
            { el: get('menu'), onConfirm: () => this.game.quitToMenu() },
        ], { onBack: () => this.game.quitToMenu() });
    }

    keyHint(kind) {
        return kind === 'confirm' ? '<kbd>Enter</kbd>/<kbd>A</kbd>' : '<kbd>Esc</kbd>/<kbd>B</kbd>';
    }
}
