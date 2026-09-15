const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const songDir = path.join(__dirname, 'songs');
const songs = fs.readdirSync(songDir).filter((name) => name.toLowerCase().endsWith('.mp3'));

if (songs.length === 0) {
    console.log('Terminal Audio Player\n\nNo songs found. Drop some .mp3 files into the songs/ folder.');
    process.exit(0);
}

let cursor = 0;
let playing = null;
let playingIndex = -1;

function render() {
    // console.log only ever appends, so every keypress printed a whole new list.
    // \x1b[H puts the cursor back at the top left and \x1b[J clears what is below,
    // so the next frame lands on top of the old one instead of under it.
    let out = '\x1b[H\x1b[JTerminal Audio Player\n\n';
    songs.forEach((songName, index) => {
        const marker = index === cursor ? '>' : ' ';
        const status = index === playingIndex ? ' (playing)' : '';
        out += `${marker} ${index + 1}. ${songName}${status}\n`;
    });
    out += '\nup/down move, enter plays, ctrl+c quits\n';
    process.stdout.write(out);
}

function play(index) {
    if (playing) playing.kill();   // otherwise the old song keeps going under the new one
    playing = spawn('afplay', [path.join(songDir, songs[index])]);
    playingIndex = index;
    playing.on('exit', () => {
        if (playingIndex === index) {
            playingIndex = -1;
            playing = null;
            render();
        }
    });
    render();
}

function quit() {
    if (playing) playing.kill();
    process.stdout.write('\x1b[?25h\n');
    process.exit(0);
}

// Raw mode hands us every keystroke as it happens, instead of waiting for enter.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b[?25l');   // hide the blinking terminal cursor
render();

process.stdin.on('data', (data) => {
    // Raw mode also means ctrl+c no longer becomes SIGINT, it arrives as byte 0x03.
    if (data[0] === 0x03) return quit();
    if (data[0] === 0x0d) return play(cursor);   // enter

    // Arrow keys are not one byte, they are an escape sequence: 0x1b 0x5b then 0x41/0x42.
    if (data[0] === 0x1b && data[1] === 0x5b) {
        // Adding songs.length before the modulo keeps going up from the first song positive.
        if (data[2] === 0x41) cursor = (cursor - 1 + songs.length) % songs.length;
        else if (data[2] === 0x42) cursor = (cursor + 1) % songs.length;
        else return;
        render();
    }
});
