var fs = require('fs');
var path = require('path');
var express = require('express');
var app = express();
var hbs = require('hbs');
var search = require('youtube-search');
var ytdl = require('ytdl-core');
var LastfmAPI = require('lastfmapi');
var ffmpeg = require('ffmpeg');
var ffprobe = require('node-ffprobe');
var lyrics = require('lyrics-fetcher');
var shortid = require('shortid'),
    config = require('config');

var lastFM = new LastfmAPI({
    'api_key' : config.get('LastFM.key'),
    'secret' : config.get('LastFM.secret')
});

var searchOpts = {
    maxResults: 10,
    regionCode: 'GB',
    type: 'video',
    safeSearch: 'none',
    key: config.get('YouTube.key')
};

var tracklist = [],   // All songs
    playlist  = [],   // Queued songs
    current = {};

// Setup SQLite
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('songs.db');
var check;
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

db.each("SELECT * FROM tracks", function(err, row) {
    tracklist.push({
        mbid: row.mbid,
        track: row.track,
        artist: row.artist,
        image: row.image,
        likes: 1,
        youtube: row.youtube,
    });
});


if (process.argv[2] == 'search' && process.argv[3]) {
    findSong(process.argv[3]);
} else if (process.argv[2] == 'add' && process.argv[3]) {
    addSong(process.argv[3], true);
} else if (process.argv[2] == 'download' && process.argv[3]) {
    addSong(process.argv[3]);
} else if (process.argv[2] == 'delete' && process.argv[3]) {
    deleteSong(process.argv[3]);
} else {
    console.log('No paramaters given');
}



function findSong(q) {
    console.log('Finding song: ' + q);
    if (!q || !q.length) {
        console.log('No query given');
        process.exit();
    }

    lastFM.track.search({
        'track' : q,
        'limit' : 5
    }, function (err, response) {
        if (err) { console.log('l.fm Search error: ' + err); process.exit() }
        
        var result;

        if (response.trackmatches.track) {
            // Loop results
            var resultsLength = response.trackmatches.track.length;

            if (resultsLength) {
                for (i = 0; i < resultsLength; i++) {
                    // Check item has mbid
                    var item = response.trackmatches.track[i];

                    console.log('Song found: ' + item.name + ' - ' + item.artist  + ' [' + item.mbid + ']');
                    if (!item.mbid) continue;

                    result = item.mbid;
                }
            } else {
                // Check item has mbid
                var item = response.trackmatches.track;

                result = item.mbid;
            }
        }

        if (!result) {
            console.log('No results found');
        }
    });
}

function addSong(mbid, textSearch) {
    if (!textSearch) {
        console.log('Downloading song: ' + mbid);
        lastFM.track.getInfo({
            'mbid' : mbid
        }, function (err, response) {
            if(err || !response || !response.mbid) {
                console.log('Add song:',err, response);
                return;
            }

            var data = {};

            console.log('Song mbid: ' + response.mbid);

            data.mbid = response.mbid,
            data.track = response.name,
            data.artist = response.artist.name,
            data.image = '',
            data.outputPath = 'music/' + data.mbid + '.mp4';
            data.duration = response.duration;

            // Check file doesn't already exist
            var added = false;
            for (var i = 0; i < tracklist.length; i++) {
                if (tracklist[i].mbid == data.mbid) {
                    added = true;
                    break;
                }
            }
            if (added || fs.existsSync(data.outputPath)) {
                console.log('Re-downloading file');
            }

            // Get image
            for (n = 0; n < response.album.image.length; n++) {
                if (response.album.image[n].size == 'large' && !data.image ||
                    response.album.image[n].size == 'extralarge') {
                    data.image = response.album.image[n]['#text'];
                }
            }

            console.log('Looking up ' + data.track + ' - ' + data.artist + '...');
            search(data.track + ' ' + data.artist, searchOpts, function(err, results) {
                if(err || !results || !results.length) {
                    console.log(err);
                    return;
                }

                // Loop through results until we find an appropriate file
                checkResults(results, data, 0);
            });
        });
    } else {
        console.log('Searching song: ' + mbid);
        // Search again
        lastFM.track.search({
            'track' : mbid,
            'limit' : 1
        }, function (err, response) {
            if (err) { console.log('l.fm Search error: ' + err); process.exit() }
            
            var result;

            if (!response.trackmatches.track.length) {
                console.log('No results found');
                return;
            }

            var data = {};

            data.track = response.trackmatches.track[0].name;
            data.artist = response.trackmatches.track[0].artist;
            data.mbid = shortid.generate();
            data.image = '';
            data.outputPath = 'music/' + data.mbid + '.mp4';

            // Get image
            for (n = 0; n < response.trackmatches.track[0].image.length; n++) {
                if (response.trackmatches.track[0].image[n].size == 'large' && !data.image ||
                    response.trackmatches.track[0].image[n].size == 'extralarge') {
                    data.image = response.trackmatches.track[0].image[n]['#text'];
                }
            }

            console.log('Looking up ' + data.track + ' - ' + data.artist + '...');
            search(data.track + ' ' + data.artist, searchOpts, function(err, results) {
                if(err || !results || !results.length) {
                    console.log(err);
                    return;
                }

                // Loop through results until we find an appropriate file
                checkResults(results, data, 0);
            });

        });
    }
}


function checkResults(results, data, n) {
    if (n >= results.length) {
        console.log('No source found');
        return;
    }

    console.log('Checking result ' + results[n].id);

    var duration = data.duration / 1000;
    ytdl.getInfo('http://www.youtube.com/watch?v=' + results[n].id, {downloadURL: true}, function(err, info) {
        if (err) {
            console.log(err);
            checkResults(results, data, ++n);
            return;
        }

        // Check if duration is valid
        if (info.length_seconds < duration * 0.8 || info.length_seconds > duration * 1.2) {
            console.log('Invalid duration: ' + info.length_seconds + ', target is: ' + data.duration);
            checkResults(results, data, ++n);
            return;
        }

        downloadSong(results[n].id, data.outputPath);
        console.log("Downloaded " + data.track + " - " + data.artist);

        // Add to db
        try {
            var stmt = db.prepare("INSERT OR IGNORE INTO tracks (`mbid`, `track`, `artist`, `image`, `likes`, `youtube`) VALUES (?, ?, ?, ?, 1, ?)");
            stmt.run(data.mbid, data.track, data.artist, data.image, results[n].id);
        } catch(e) {
            //
        }
    });
}

function downloadSong(id, outputPath) {
    // var stream = ytdl('http://www.youtube.com/watch?v=' + id, { filter: function(format) { return format.resolution === null; } })
    var stream = ytdl('http://www.youtube.com/watch?v=' + id);
    stream.on('end', function() {
        // Convert to MP3
        try {
            var process = new ffmpeg(path.resolve(__dirname, outputPath));
            process.then(function (video) {
                console.log('Converting file');
                // Callback mode
                video.fnExtractSoundToMP3(path.resolve(__dirname, outputPath.replace(/4$/, "3")), function (error, file) {
                    if (!error) {
                        console.log('File converted: ' + path.resolve(__dirname, outputPath) + ' -> ' + path.resolve(__dirname, outputPath.replace(/4$/, "3")));

                        // Delete original mp4
                        fs.unlink(path.resolve(__dirname, outputPath));
                    } else {
                        console.log(error);
                    }
                });
            }, function (err) {
                console.log('Error: ' + err);
            });
        } catch (e) {
            console.log(e);
        }
    });
    stream.pipe(fs.createWriteStream(outputPath));
}

function deleteSong(mbid) {
    if (!mbid) {
        console.log('No ID given');
        process.exit();
    }

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
}
