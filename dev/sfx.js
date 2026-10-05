import { AudioEngine, SOUND_NAMES } from '../src/audio/AudioEngine.js';

const audio = new AudioEngine();
window.audio = audio;

const GROUPS = {
    Impacts: ['jab', 'punch', 'heavy', 'body', 'block', 'whiff', 'step', 'fall', 'counter', 'ko'],
    Ring: ['bell', 'bellTriple', 'roundStart', 'spirit'],
    'Crowd reactions': ['cheer', 'ooh', 'gasp'],
    UI: ['menuMove', 'menuSelect', 'menuBack'],
};
const listed = new Set(Object.values(GROUPS).flat());
const extra = SOUND_NAMES.filter((n) => !listed.has(n));
if (extra.length) GROUPS.Other = extra;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, parent) => {
    const e = Object.assign(document.createElement(tag), props);
    parent?.append(e);
    return e;
};
const value = (id) => +$(id).value;
const status = $('status');

function refreshStatus() {
    status.textContent = audio.ready ? 'audio running' : 'locked: click anywhere';
    status.classList.toggle('on', audio.ready);
}
document.addEventListener('pointerdown', () => audio.unlock().then(refreshStatus), { capture: true });
document.addEventListener('keydown', () => audio.unlock().then(refreshStatus), { capture: true });

function flash(btn) {
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 120);
}

const playOpts = () => ({ intensity: value('intensity'), pan: value('pan'), rate: value('rate') });
const groupsEl = $('groups');
const soundButtons = {};
for (const [title, names] of Object.entries(GROUPS)) {
    el('h2', { textContent: title, style: 'margin-top: 8px' }, groupsEl);
    const row = el('div', { className: 'buttons' }, groupsEl);
    for (const name of names) {
        const b = el('button', { textContent: name }, row);
        b.addEventListener('click', () => { audio.play(name, playOpts()); flash(b); });
        soundButtons[name] = b;
    }
}

// Slider readouts.
for (const input of document.querySelectorAll('input[type=range]')) {
    const out = input.parentElement.querySelector('span:last-child');
    const sync = () => { out.textContent = (+input.value).toFixed(2); };
    input.addEventListener('input', sync);
    sync();
}
for (const input of document.querySelectorAll('[data-vol]')) {
    input.addEventListener('input', () => audio.setVolumes({ [input.dataset.vol]: +input.value }));
}
$('excitement').addEventListener('input', () => audio.setCrowdExcitement(value('excitement')));
audio.setCrowdExcitement(value('excitement'));

$('crowdStart').addEventListener('click', () => audio.startCrowd());
$('crowdStop').addEventListener('click', () => audio.stopCrowd(1));
let paused = false;
$('pause').addEventListener('click', (e) => {
    paused = !paused;
    audio.setPaused(paused);
    e.target.textContent = `Pause: ${paused ? 'on' : 'off'}`;
});

for (let n = 1; n <= 10; n++) {
    el('button', { textContent: n, onclick: () => audio.count(n) }, $('counts'));
}
let countTimer = null;
$('countAll').addEventListener('click', () => {
    clearInterval(countTimer);
    let n = 0;
    countTimer = setInterval(() => {
        audio.count(++n);
        if (n >= 10) clearInterval(countTimer);
    }, 1000);
});
$('announce').addEventListener('click', () => audio.announce($('announceText').value));
for (const line of ['Round one', 'Box!', 'Down!', 'Knockout!', 'Winner!']) {
    el('button', { textContent: line, onclick: () => audio.announce(line, { rate: 0.95, pitch: 0.7 }) }, $('lines'));
}

// A short scripted exchange to hear everything together.
$('demo').addEventListener('click', () => {
    const seq = [
        [0, () => audio.play('roundStart')], [0.5, () => audio.play('bell')], [0.9, () => audio.announce('Box!')],
        [1.6, () => audio.play('step', { pan: -0.3 })], [1.8, () => audio.play('step', { pan: 0.2 })],
        [2.0, () => audio.play('whiff', { pan: 0.3, rate: 1.2 })], [2.3, () => audio.play('jab', { pan: -0.2 })],
        [2.45, () => audio.play('jab', { pan: -0.2, intensity: 0.6 })], [2.7, () => audio.play('block', { pan: 0.2 })],
        [3.0, () => audio.play('punch', { pan: -0.1, intensity: 0.7 })], [3.4, () => audio.play('body', { pan: 0.1, intensity: 0.8 })],
        [3.5, () => audio.play('ooh', { intensity: 0.5 })], [4.2, () => audio.play('counter')], [4.32, () => audio.play('heavy', { intensity: 1 })],
        [4.35, () => { audio.play('gasp'); audio.setCrowdExcitement(0.8); }], [5.0, () => audio.play('ko', { intensity: 1 })],
        [5.6, () => audio.play('fall')], [6.2, () => audio.play('cheer', { intensity: 1 })], [6.6, () => audio.play('spirit')],
        [7.4, () => audio.play('bellTriple')], [8.5, () => audio.setCrowdExcitement(value('excitement'))],
    ];
    audio.startCrowd();
    for (const [t, fn] of seq) setTimeout(fn, t * 1000);
});

// Number keys trigger the impact row for quick A/B listening.
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    const idx = '1234567890'.indexOf(e.key);
    const name = GROUPS.Impacts[idx];
    if (idx >= 0 && name) { audio.play(name, playOpts()); flash(soundButtons[name]); }
});

setInterval(refreshStatus, 1000);
