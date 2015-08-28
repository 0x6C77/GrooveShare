// Load tracks
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('songs.db');

var Library = function() {
    this.songs = [];

    // Load in library
    db.run("CREATE TABLE IF NOT EXISTS tracks (\
            mbid TEXT PRIMARY KEY NOT NULL,\
            track TEXT NOT NULL,\
            artist TEXT NOT NULL,\
            image TEXT,\
            likes INT,\
            dislikes INT,\
            added DATETIME DEFAULT CURRENT_TIMESTAMP,\
            last DATETIME,\
            plays INT,\
            youtube TEXT NOT NULL\
     )");

    db.all("SELECT * FROM tracks ORDER BY artist, track", function(err, rows) {
        this.songs = rows;

        global.ui.renderTracks(this.songs);
    });
}

Library.prototype.deleteSong = function(id) {
    if (!id) {
        return;
    }
    console.log(id);
    console.log(this.songs.length);
    return;
    
    var mbid = this.songs[id].mbid;
    console.log(mbid);

    // Delete file
    fs.unlink(path.resolve(__dirname, 'music/' + mbid + '.mp3'), function (err) { });
    console.log('File deleted: ' + path.resolve(__dirname, 'music/' + mbid + '.mp3'));

    // Remove from DB
    try {
        var stmt = db.prepare("DELETE FROM tracks WHERE `mbid` = ?");
        stmt.run(mbid);
        console.log('Removed from DB');
    } catch(e) {
        console.log(e);
        console.log('Error removing entry from DB');
    }

    // Remove from cached songs list
    this.songs.splice(id, 1);

    global.ui.renderTracks(this.songs);
}

module.exports = Library;