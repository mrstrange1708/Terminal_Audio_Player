const fs = require('fs');
const path = require('path');

const songDir = path.join(__dirname, 'songs');

function listSongs() {
    const songs = fs.readdirSync(songDir).filter((name) => name.toLowerCase().endsWith('.mp3'));

    console.log('Terminal Audio Player\n');

    if (songs.length === 0) {
        console.log('No songs found. Drop some .mp3 files into the songs/ folder.');
        return songs;
    }

    songs.forEach((songName, index) => {
        console.log(`${index + 1}. ${songName}`);
    });

    return songs;
}

listSongs();
