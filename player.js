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
let isPaused = false;

function status() {
    if (!playing) return 'stopped';
    return isPaused ? `paused: ${songs[playingIndex]}` : `playing: ${songs[playingIndex]}`;
}

function render() {
    // console.log only ever appends, so every keypress printed a whole new list.
    // \x1b[H puts the cursor back at the top left and \x1b[J clears what is below,
    // so the next frame lands on top of the old one instead of under it.
    let out = `\x1b[H\x1b[JTerminal Audio Player  [${status()}]\n\n`;
    songs.forEach((songName, index) => {
        const marker = index === cursor ? '>' : ' ';
        const tag = index === playingIndex ? (isPaused ? ' (paused)' : ' (playing)') : '';
        out += `${marker} ${index + 1}. ${songName}${tag}\n`;
    });
    out += '\nup/down move, enter plays, p pause/resume, s stop, ctrl+c quits\n';
    process.stdout.write(out);
}

function killAudio() {
    if (!playing) return;
    const child = playing;
    playing = null;
    playingIndex = -1;
    isPaused = false;
    child.kill('SIGKILL');   // SIGKILL lands even while the child is SIGSTOPped
}

function play(index) {
    killAudio();   // otherwise the old song keeps going under the new one
    const child = spawn('afplay', [path.join(songDir, songs[index])]);
    playing = child;
    playingIndex = index;
    child.on('exit', () => {
        if (playing === child) {
            playing = null;
            playingIndex = -1;
            isPaused = false;
        }
        render();
    });
    render();
}

function togglePause() {
    // afplay has no pause of its own, so freeze the process itself. SIGSTOP stops it
    // mid buffer and SIGCONT carries on from the exact same sample.
    if (!playing) return;
    playing.kill(isPaused ? 'SIGCONT' : 'SIGSTOP');
    isPaused = !isPaused;
    render();
}

function quit() {
    killAudio();
    process.stdout.write('\x1b[?25h\n');
    process.exit(0);
}

// Killing us does not kill the child, so quitting mid song used to leave afplay
// orphaned and still audible. This catches an unhandled throw as well.
process.on('exit', killAudio);

// Raw mode hands us every keystroke as it happens, instead of waiting for enter.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b[?25l');   // hide the blinking terminal cursor
render();

process.stdin.on('data', (data) => {
    // Raw mode also means ctrl+c no longer becomes SIGINT, it arrives as byte 0x03.
    if (data[0] === 0x03) return quit();
    if (data[0] === 0x0d) return play(cursor);   // enter
    if (data[0] === 0x70) return togglePause();  // p
    if (data[0] === 0x73) { killAudio(); return render(); }   // s, back to the start of the song

    // Arrow keys are not one byte, they are an escape sequence: 0x1b 0x5b then 0x41/0x42.
    if (data[0] === 0x1b && data[1] === 0x5b) {
        // Adding songs.length before the modulo keeps going up from the first song positive.
        if (data[2] === 0x41) cursor = (cursor - 1 + songs.length) % songs.length;
        else if (data[2] === 0x42) cursor = (cursor + 1) % songs.length;
        else return;
        render();
    }
});
