const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const songDir = path.join(__dirname, 'songs');
const BAR_WIDTH = 50;
let songs = [];
try {
    songs = fs.readdirSync(songDir).filter((name) => name.toLowerCase().endsWith('.mp3')).sort();
} catch {
    console.log(`Terminal Audio Player\n\nNo songs folder found. Create ${songDir} and drop some .mp3 files in it.`);
    process.exit(1);
}

if (songs.length === 0) {
    console.log(`Terminal Audio Player\n\nNo songs found. Drop some .mp3 files into ${songDir}`);
    process.exit(0);
}

let cursor = 0;
let playing = null;
let playingIndex = -1;
let isPaused = false;
let duration = 0;   // seconds, 0 until afinfo answers
let elapsed = 0;    // seconds, counted by hand because afplay will not tell us
let ticker = null;
let generation = 0;   // bumped on every stop or start, so a slow afinfo cannot start a stale song

function mmss(seconds) {
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function progressBar() {
    if (playingIndex === -1) return `[${'-'.repeat(BAR_WIDTH)}]   --:-- / --:--`;
    if (!duration) return `[${'-'.repeat(BAR_WIDTH)}]   reading duration...`;
    const fraction = Math.min(elapsed / duration, 1);   // capped, so the bar never passes 100%
    const filled = Math.round(fraction * BAR_WIDTH);
    const bar = '#'.repeat(filled) + '-'.repeat(BAR_WIDTH - filled);
    return `[${bar}] ${String(Math.round(fraction * 100)).padStart(3)}%  ${mmss(elapsed)} / ${mmss(duration)}`;
}

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
    out += `\n${progressBar()}\n`;
    out += '\nup/down move, enter plays, n/b next/back, p pause/resume, s stop, ctrl+c quits\n';
    process.stdout.write(out);
}

function getDuration(file) {
    // afplay cannot tell us how long a song is, but afinfo prints
    // "estimated duration: 3.239184 sec" for any file it can read.
    return new Promise((resolve) => {
        const info = spawn('afinfo', [file]);
        let out = '';
        info.stdout.on('data', (chunk) => { out += chunk; });
        info.on('error', () => resolve(0));
        info.on('close', () => {
            const match = out.match(/estimated duration: ([\d.]+)/);
            resolve(match ? parseFloat(match[1]) : 0);
        });
    });
}

function move(delta) {
    // Adding songs.length before the modulo keeps going up from the first song positive.
    cursor = (cursor + delta + songs.length) % songs.length;
}

function stopTicker() {
    // Without this the old interval stays alive next to the new one and elapsed
    // climbs at double speed, then triple on the song after that.
    if (ticker) clearInterval(ticker);
    ticker = null;
}

function killAudio() {
    generation++;
    stopTicker();
    duration = 0;   // reset now, or the bar shows the last song's numbers while afinfo runs
    elapsed = 0;
    if (!playing) return;
    const child = playing;
    playing = null;
    playingIndex = -1;
    isPaused = false;
    // A kill of ours fires 'exit' too, which looks exactly like a song that ended and
    // made n skip two songs at a time. Dropping the listener first is cleaner than a
    // flag, because there is no flag left to reset afterwards.
    child.removeAllListeners('exit');
    child.kill('SIGKILL');   // SIGKILL lands even while the child is SIGSTOPped
}

async function play(index) {
    killAudio();   // otherwise the old song keeps going under the new one
    const mine = generation;
    playingIndex = index;
    render();      // paint the new song straight away, the bar says "reading duration"
    const seconds = await getDuration(path.join(songDir, songs[index]));
    if (mine !== generation) return;   // superseded while afinfo ran: user hit n, s or ctrl+c
    duration = seconds;
    const child = spawn('afplay', [path.join(songDir, songs[index])]);
    playing = child;
    playingIndex = index;
    child.on('exit', (code) => {   // only reached when the song ended on its own
        stopTicker();
        duration = 0;
        elapsed = 0;
        playing = null;
        playingIndex = -1;
        isPaused = false;
        if (code === 0) {          // nonzero means afplay choked on the file: do not
            move(1);               // race down the whole list spawning failures
            return play(cursor);
        }
        render();
    });
    // Count time ourselves, 0.1s at a time. Paused means simply not counting, so
    // the bar freezes exactly where it was.
    ticker = setInterval(() => {
        if (!playing || isPaused) return;
        elapsed = Math.min(elapsed + 0.1, duration || elapsed + 0.1);
        render();
    }, 100);
    render();
}

function skip(delta) {
    move(delta);
    play(cursor);
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
    if (data[0] === 0x6e) return skip(1);        // n, moves the cursor AND plays
    if (data[0] === 0x62) return skip(-1);       // b
    if (data[0] === 0x70) return togglePause();  // p
    if (data[0] === 0x73) { killAudio(); return render(); }   // s, back to the start of the song

    // Arrow keys are not one byte, they are an escape sequence: 0x1b 0x5b then 0x41/0x42.
    if (data[0] === 0x1b && data[1] === 0x5b) {
        if (data[2] === 0x41) move(-1);        // up: cursor only, never plays
        else if (data[2] === 0x42) move(1);    // down
        else return;
        render();
    }
});
