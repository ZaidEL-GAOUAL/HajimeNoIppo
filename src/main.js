import '@fontsource/bangers/400.css';
import '@fontsource/noto-sans-jp/900.css';
import './styles/main.css';
import { Game } from './core/Game.js';

const game = new Game(document.getElementById('renderCanvas'), document.getElementById('ui'));
game.init().catch((err) => {
    console.error(err);
    const label = document.querySelector('#loading .label');
    if (label) label.textContent = `Failed to start: ${err.message}`;
});
