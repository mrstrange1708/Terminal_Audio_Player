const fs = require('fs');
const path = require('path');

const songDir = path.join(__dirname, 'songs');
const songs = fs.readdirSync(songDir).filter((name) => name.toLowerCase().endsWith('.mp3'));

let cursor = 0;

function render() {
    // console.log only ever appends, so every keypress printed a whole new list.
    // \x1b[H puts the cursor back at the top left and \x1b[J clears what is below,
    // so the next frame lands on top of the old one instead of under it.
    let out = '\x1b[H\x1b[JTerminal Audio Player\n\n';

    if (songs.length === 0) {
        out += 'No songs found. Drop some .mp3 files into the songs/ folder.\n';
    } else {
        songs.forEach((songName, index) => {
            const marker = index === cursor ? '>' : ' ';
            out += `${marker} ${index + 1}. ${songName}\n`;
        });
    }

    out += '\nup/down move, ctrl+c quits\n';
    process.stdout.write(out);
}

// Raw mode hands us every keystroke as it happens, instead of waiting for enter.
process.stdin.setRawMode(true);
process.stdin.resume();
render();

process.stdin.on('data', (data) => {
    // Raw mode also means ctrl+c no longer becomes SIGINT, it arrives as byte 0x03.
    if (data[0] === 0x03) process.exit(0);

    // Arrow keys are not one byte, they are an escape sequence: 0x1b 0x5b then 0x41/0x42.
    if (data[0] === 0x1b && data[1] === 0x5b) {
        // Adding songs.length before the modulo keeps going up from the first song positive.
        if (data[2] === 0x41) cursor = (cursor - 1 + songs.length) % songs.length;
        else if (data[2] === 0x42) cursor = (cursor + 1) % songs.length;
        else return;
        render();
    }
});
