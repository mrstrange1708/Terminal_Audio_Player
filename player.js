const fs = require('fs');
const path = require('path');

const songDir = path.join(__dirname, 'songs');
const songs = fs.readdirSync(songDir).filter((name) => name.toLowerCase().endsWith('.mp3'));

let cursor = 0;

function render() {
    console.log('Terminal Audio Player\n');

    if (songs.length === 0) {
        console.log('No songs found. Drop some .mp3 files into the songs/ folder.');
        return;
    }

    songs.forEach((songName, index) => {
        const marker = index === cursor ? '>' : ' ';
        console.log(`${marker} ${index + 1}. ${songName}`);
    });
}

render();
