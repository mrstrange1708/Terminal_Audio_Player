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
let playing = null;        // child process, or null when stopped
let playingIndex = -1;
let isPaused = false;
let duration = 0;          // seconds, 0 until afinfo answers
let elapsed = 0;           // seconds, ticked by us at 100ms
let ticker = null;
let generation = 0;        // bumped on every stop/start, so a slow afinfo can't start a stale song

function mmss(seconds) {
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function status() {
    if (!playing) return 'stopped';
    return `${isPaused ? 'paused' : 'playing'}: ${songs[playingIndex]}`;
}

function progressBar() {
    if (playingIndex === -1) return `[${'-'.repeat(BAR_WIDTH)}]   --:-- / --:--`;
    if (!duration) return `[${'-'.repeat(BAR_WIDTH)}]   reading duration...`;
    const fraction = Math.min(elapsed / duration, 1);
    const filled = Math.round(fraction * BAR_WIDTH);
    const bar = '#'.repeat(filled) + '-'.repeat(BAR_WIDTH - filled);
    return `[${bar}] ${String(Math.round(fraction * 100)).padStart(3)}%  ${mmss(elapsed)} / ${mmss(duration)}`;
}

function render() {
    // \x1b[H homes the cursor and \x1b[K clears each line as we overwrite it. Clearing the whole
    // screen first (\x1b[2J) would blank and repaint 10x a second, which flickers.
    const lines = ['Terminal Audio Player', '', ...songs.map((songName, index) => {
        const marker = index === cursor ? '>' : ' ';
        const tag = index === playingIndex ? (isPaused ? ' (paused)' : ' (playing)') : '';
        return `${marker} ${index + 1}. ${songName}${tag}`;
    }), '', status(), progressBar(), '',
        'up/down  move cursor      enter  play highlighted',
        'n/b      next/previous    p      pause or resume',
        's        stop             ctrl+c quit'];
    process.stdout.write('\x1b[H' + lines.map((line) => line + '\x1b[K').join('\n') + '\n\x1b[J');
}

function stopTicker() {
    // Every switch clears the old interval. Two live intervals means elapsed climbs at double speed.
    if (ticker) clearInterval(ticker);
    ticker = null;
}

function killAudio() {
    generation++;
    stopTicker();
    duration = 0;          // reset now, so the bar never shows the previous song's numbers
    elapsed = 0;
    if (!playing) return;
    const child = playing;
    playing = null;
    playingIndex = -1;
    isPaused = false;
    child.removeAllListeners('exit');   // a kill of ours must never look like a song that finished
    child.kill('SIGKILL');              // lands even while the child is SIGSTOPped
}

function move(delta) {
    cursor = (cursor + delta + songs.length) % songs.length;
}

function getDuration(file) {
    return new Promise((resolve) => {
        const info = spawn('afinfo', [file]);
        let out = '';
        info.stdout.on('data', (chunk) => { out += chunk; });
        info.on('error', () => resolve(0));                 // afinfo missing: bar just stays unknown
        info.on('close', () => {
            const match = out.match(/estimated duration: ([\d.]+)/);
            resolve(match ? parseFloat(match[1]) : 0);
        });
    });
}

async function play(index) {
    killAudio();
    const mine = generation;
    playingIndex = index;
    render();                                    // paint the new song immediately, bar says "reading duration"
    const seconds = await getDuration(path.join(songDir, songs[index]));
    if (mine !== generation) return;             // superseded while afinfo ran (user hit n, s, or ctrl+c)
    duration = seconds;

    const child = spawn('afplay', [path.join(songDir, songs[index])]);
    playing = child;
    child.on('error', (err) => {
        if (err.code === 'ENOENT') fail('afplay not found. This player needs macOS (afplay and afinfo ship with it).');
        fail(`Could not play ${songs[index]}: ${err.message}`);
    });
    child.on('exit', (code) => {                 // only reached when the song ended on its own
        stopTicker();
        playing = null;
        playingIndex = -1;
        isPaused = false;
        duration = 0;
        elapsed = 0;
        if (code === 0) {                        // nonzero: afplay choked, don't autoplay down the whole list
            move(1);
            return play(cursor);
        }
        render();
    });

    ticker = setInterval(() => {
        if (!playing || isPaused) return;        // paused: counter stops, bar freezes where it is
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
    if (!playing) return;
    playing.kill(isPaused ? 'SIGCONT' : 'SIGSTOP');
    isPaused = !isPaused;
    render();
}

let cleanedUp = false;

function cleanup() {
    if (cleanedUp) return;   // runs once; otherwise the exit hook repaints over fail()'s message
    cleanedUp = true;
    killAudio();
    process.stdout.write('\x1b[2J\x1b[H\x1b[?25h');   // clear screen, home, show the terminal cursor again
}

function fail(message) {
    cleanup();
    console.error(message);
    process.exit(1);
}

process.on('exit', cleanup);   // covers an unhandled throw too, so no music outlives the app

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b[2J\x1b[?25l');   // clear once at startup, hide the blinking cursor
render();

process.stdin.on('data', (data) => {
    if (data[0] === 0x03 || data[0] === 0x71) {   // ctrl+c (raw mode gives us the byte, not SIGINT) or q
        cleanup();
        return process.exit(0);
    }
    if (data[0] === 0x0d) return play(cursor);    // enter
    if (data[0] === 0x6e) return skip(1);         // n -> next, moves the cursor AND plays
    if (data[0] === 0x62) return skip(-1);        // b -> back
    if (data[0] === 0x70) return togglePause();   // p
    if (data[0] === 0x73) { killAudio(); return render(); }   // s
    if (data[0] === 0x1b && data[1] === 0x5b) {   // arrows: escape sequence, cursor only, never plays
        if (data[2] === 0x41) move(-1);           // up
        else if (data[2] === 0x42) move(1);       // down
        else return;
        render();
    }
});
