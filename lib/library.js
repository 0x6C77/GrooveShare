// Load tracks
var sqlite3 = require('sqlite3').verbose(),
    colors = require('colors'),
    fs = require('fs'),
    lwip = require('lwip'),
    path = require('path'),
    config = require('config'),
    LastfmAPI = require('lastfmapi'),
    http = require('http');

var lastFM = new LastfmAPI({
    'api_key' : config.get('LastFM.key'),
    'secret' : config.get('LastFM.secret')
});

var Library = function(callback) {
    var self = this;

    // Keep track of callbacks
    this.watchers = [];

    this.db = new sqlite3.Database('tracks.db');

    this.initiated = false;
    this.tracks = [];

    // Load in library
    this.db.run("CREATE TABLE IF NOT EXISTS tracks_ratings (\
                    uuid TEXT NOT NULL,\
                    track TEXT NOT NULL,\
                    rating INT,\
                    added DATETIME DEFAULT CURRENT_TIMESTAMP,\
                    PRIMARY KEY (uuid, track)\
                 )");

    this.db.run("CREATE TABLE IF NOT EXISTS tracks (\
                    id TEXT PRIMARY KEY NOT NULL,\
                    track TEXT NOT NULL,\
                    artist TEXT NOT NULL,\
                    image TEXT,\
                    user_id INT,\
                    added DATETIME DEFAULT CURRENT_TIMESTAMP,\
                    last DATETIME,\
                    plays INT,\
                    youtube TEXT NOT NULL\
                 );", function() {

        self.db.all("SELECT * FROM tracks ORDER BY artist, track", function(err, rows) {
            self.tracks = rows;
            self.initiated = true;

            if (callback && typeof(callback) === "function") {
                callback.call(self);
            }

            // global.ui.renderTracks(this.tracks);
        });
    });
}


/**
 * Count number of tracks in the library
 * @return {Number} track id
 */
Library.prototype.countTracks = function() {
    return this.tracks.length;
}

/**
 * Update DB
 * @param {Number} track id
 */
Library.prototype.playingTrack = function(id) {
    var stmt = this.db.prepare("UPDATE tracks SET `last` = datetime(), plays = IFNULL(plays, 0) + 1 WHERE id = ?");
    stmt.run(id);
}

/**
 * Rate track
 * @param {Number} track id
 * @param {Number} uuid
 */
Library.prototype.rateTrack = function(id, uuid, rating) {
    if (rating !== 1 && rating !== 0 && rating !== -1) return;

    var self = this;

    try {
        // Delete any previous ratings
        var stmt = this.db.prepare("DELETE FROM tracks_ratings WHERE `uuid` = ? AND `track` = ?");
        stmt.run(uuid, id, function() {
            // Add new rating
            var stmt = self.db.prepare("INSERT INTO tracks_ratings (`uuid`, `track`, `rating`) VALUES (?, ?, ?)");
            stmt.run(uuid, id, rating);
        });
    } catch(e) {
        console.log(e);
    }
}

/**
 * Get a random track from the library
 * @param {Function} callback [{Number} track id]
 */
Library.prototype.getRandomTrackID = function(callback) {
    // Build weighted tracklisting
    this.db.all("SELECT\
                    id,\
                    julianday('now') - julianday(IFNULL(last,added)) - (IFNULL(ratings_down.down, 0)*2) + IFNULL(ratings_down.down, 0) AS weight\
                 FROM tracks\
                 LEFT JOIN (SELECT track, COUNT(*) AS up, GROUP_CONCAT(uuid) AS up_uuid FROM tracks_ratings WHERE rating > 0 GROUP BY track) ratings_up\
                 ON ratings_up.track = tracks.id\
                 LEFT JOIN (SELECT track, COUNT(*) AS down, GROUP_CONCAT(uuid) AS down_uuid FROM tracks_ratings WHERE rating < 0 GROUP BY track) ratings_down\
                 ON ratings_down.track = tracks.id\
                 ORDER BY weight", function(err, tracks) {
        var trackCount = tracks.length,
            tracksWeighted = [];

        if (!trackCount) {
            console.log('Library empty!'.red);
            return;
        }

        for(n = 0; n < trackCount; n++) {
            var t = tracks[n],
                w = Math.ceil(t.weight);

            // Duplicate this track into tracksWeighted multiple times, based on weight
            for (i = 0; i < w; i++) {
                tracksWeighted.push(t.id);
            }
        }

        var track = tracksWeighted[Math.floor(Math.random() * tracksWeighted.length)];

        if (callback && typeof(callback) === "function") {
            callback(track);
        }
    });
}

/**
 * Get track details
 * @param {Number} track id
 * @param {Function} callback [{Object} track details]
 * @return {Object} track details (only if callback is not set)
 */
Library.prototype.lookupTrackID = function(id, callback) {
    var self = this;

    // If callback check against DB, else use quick method
    if (callback && typeof(callback) === "function") {
        var stmt = this.db.prepare("SELECT tracks.*, IFNULL(ratings_up.up, 0) AS up, ratings_up.up_uuid, IFNULL(ratings_down.down, 0) AS down, ratings_down.down_uuid\
                                    FROM tracks\
                                    LEFT JOIN (SELECT track, COUNT(*) AS up, GROUP_CONCAT(uuid) AS up_uuid FROM tracks_ratings WHERE rating > 0 GROUP BY track) ratings_up\
                                    ON ratings_up.track = tracks.id\
                                    LEFT JOIN (SELECT track, COUNT(*) AS down, GROUP_CONCAT(uuid) AS down_uuid FROM tracks_ratings WHERE rating < 0 GROUP BY track) ratings_down\
                                    ON ratings_down.track = tracks.id\
                                    WHERE tracks.id = ?");
        stmt.get(id, function(err, track) {
            // Make sure artist has background image
            self.generateArtistBackground(track.artist);

            callback(track);
        });
    } else {
        for (var n = 0; n < this.tracks.length; n++) {
            if (this.tracks[n].id == id) {
                return this.tracks[n];
            }
        }
        return false;
    }
}

/**
 * Get track details
 * @param {String} track
 * @param {String} artist
 * @param {Function} callback [{Object} track details]
 * @return {Object} track details (only if callback is not set)
 */
Library.prototype.lookupTrack = function(track, artist, callback) {
    // If callback check against DB, else use quick method
    if (callback && typeof(callback) === "function") {
        var stmt = this.db.prepare("SELECT * FROM tracks WHERE track = ? AND artist = ?");
        stmt.get(array(track, artist), function(err, track) {
            callback(track);
        });
    } else {
        for (var n = 0; n < this.tracks.length; n++) {
            if (this.tracks[n].track == track && (!artist || this.tracks[n].artist == artist)) {
                return this.tracks[n];
            }
        }
        return false;
    }
}

/**
 * Add track
 * @param {Object} track details
 */
Library.prototype.addTrack = function(data) {
    // Add to tracklist
    this.tracks.push({
        id: data.id,
        track: data.track,
        artist: data.artist,
        image: data.image,
        youtube: data.YTID
    });

    // Add to db
    try {
        var stmt = this.db.prepare("INSERT OR IGNORE INTO tracks (`id`, `track`, `artist`, `image`, `youtube`) VALUES (?, ?, ?, ?, ?)");
        stmt.run(data.id, data.track, data.artist, data.image, data.YTID);
        console.log('Track added:', data.track, data.artist);
    } catch(e) {
        console.log(e);
    }

    // Download artist background image
    this.generateArtistBackground(data.artist);

    // Emit event
    this.emit('added', data.id);
}



Library.prototype.generateArtistBackground = function(artist) {
    var outputPath = path.resolve(__dirname, '../data/images', artist.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.png');
    if (fs.existsSync(outputPath)) return;

    // Create file to stop others
    var file = fs.createWriteStream(outputPath);

    lastFM.artist.getInfo({
        'artist' : artist
    }, function (err, response) {
        if (response) {
            var images = response.image;
            var image, n = 0;

            // Get the largest image
            for (n = images.length; n >= 0; n--) {
                if (images[n] && images[n].size) {
                    image = images[n]['#text'];
                    break;
                }
            }

            // If we've found an image download it
            if (image) {
                http.get(image, function (res) {
                    res.pipe(file);
                    file.on('finish', function() {
                        file.close(function() {
                            // Import image into LWIP
                            lwip.open(outputPath, 'png', function(err, image) {
                                if (err) {
                                    console.log('Open err: ' + err);
                                    return;
                                }

                                var h = (image.height() / image.width()) * 600;

                                // Add effects to image
                                image.batch()
                                     .saturate(-0.4)
                                     .darken(0.3)
                                     .resize(600, h)
                                     .writeFile(outputPath, function(err, buffer) {
                                        if (err) {
                                            console.log('Couldn\'t save image found for ' + artist);
                                        }
                                     });
                            });
                        });
                    });
                });
            } else {
                console.log('No artist image found for ' + artist);
            }

        } else if (err) {
            console.log(err);
        }
    });
}

// Subscribe to events
Library.prototype.watch = function(event, callback) {
    if (typeof this.watchers[event] === 'undefined') {
        this.watchers[event] = [];
    }
    this.watchers[event].push(callback);
}

// Emit events
Library.prototype.emit = function(event, data) {
    if (event in this.watchers && this.watchers[event].length) {
        for (i = 0; i < this.watchers[event].length; i++) {
            this.watchers[event][i](data);
        }
    }
}




module.exports = Library;