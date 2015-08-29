process.title = "GrooveShare"

var fs = require('fs'),
    http = require('http'),
    path = require('path'),
    express = require('express'),
    app = express(),
    hbs = require('hbs'),
    search = require('youtube-search'),
    ytdl = require('ytdl-core'),
    LastfmAPI = require('lastfmapi'),
    ffmpeg = require('ffmpeg'),
    ffprobe = require('node-ffprobe'),
    lyrics = require('lyrics-fetcher'),
    lwip = require('lwip'),
    config = require('config');

// Check config file - Only checks for the existant of the entry, not the value.
if(!config.has('LastFM.key') || !config.has('LastFM.secret') || !config.has('YouTube.key')){
    console.log("Missing value in configuration file.\nBye Bye.");
    process.exit();
}

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

function updateTracklist() {
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

    tracklist = [];
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
}
updateTracklist();

// Build starting playlist
var trackWatcher = function() {
    var self = this;
    this.halfWay = false;
    this.queued = [];
    
    setInterval(function() {
        self.checkProgress();
    }, 500);

    this.playSong = function(track, duration) {
        this.next = null;
        this.track = track;
        this.duration = duration;
        this.started = Date.now() + 10000;
        this.halfWay = false;

        console.log('Playing song: ' + this.track.track + ' - ' + this.track.artist);

        // generateArtistBackground(this.track.artist);

        var self = this;
        var filePath = path.resolve(__dirname, 'music/' + this.track.mbid + '.mp3');
        ffprobe(filePath, function(err, probeData) {
            if (err || !probeData || !probeData.streams) {
                console.log(err);
                this.track = null;
                self.playRandom();
            } else {
                self.duration = probeData.streams[0].duration - probeData.streams[0].start_time;
                console.log('Song duration: ' + self.duration);
            }
        });

        // Update clients 
        io.sockets.emit('playlist.now', { track: this.track, position: this.getPosition() });
        console.log(this.track.artist, this.track.track);
        lyrics.fetch(this.track.artist, this.track.track, function (err, lyrics) {
            if (!err && lyrics) {
                io.sockets.emit('song.lyrics', lyrics);
            } else {
                io.sockets.emit('song.lyrics', 'No lyrics available');
            }
        });

        // Regenerate tracklist - just in case
        updateTracklist();
    }

    this.setDuration = function(mbid, duration) {
        if (mbid == this.track.mbid && !this.duration) {
            this.duration = duration;
        }
    }

    this.getPosition = function() {
        if (!this.track || !this.track.mbid) return;
        return (Date.now() - this.started) / 1000;
    }

    this.queueSong = function(mbid) {
        var valid = false;
        // Do we have that song?
        for (var n = 0; n < tracklist.length; n++) {
            if (tracklist[n].mbid == mbid) {
                valid = true;
                break;
            }
        }

        if (!valid || this.queued.indexOf(mbid) > -1) {
            return false;
        } else {
            this.queued.push(mbid);
            return true;
        }
    }

    this.playRandom = function() {
        if (!this.track) {
            this.getNext();

            // Get a random song to start with
            this.playSong(this.next, null);
        }
    }

    this.getNext = function() {
        if (!this.next) {
            // Do we have anything queued?
            if (this.queued.length) {
                var mbid = this.queued.shift();
                for (var n = 0; n < tracklist.length; n++) {
                    if (tracklist[n].mbid == mbid) {
                        this.next = tracklist[n];
                        break;
                    }
                }
            }

            if (!this.next) {
                this.next = tracklist[Math.floor(Math.random()*tracklist.length)];
            }

            generateArtistBackground(this.next.artist);
        }

        return this.next;
    }

    this.checkProgress = function() {
        if (this.getPosition() > this.duration/2 && !this.halfWay) {
            console.log('Preloading: ' + this.getNext().track + ' - ' + this.getNext().artist);
            // Tell clients to preload
            io.sockets.emit('playlist.next', this.getNext());
            this.halfWay = true;
        }

        if (this.duration && this.getPosition() > this.duration) {
            this.track = null;
            this.playRandom();
        }
    }

    return this;
}
var tracker = trackWatcher();

setTimeout(function() {
    tracker.playRandom(); // Only will run once
}, 2000);

var server = app.listen(6872, function () {
    var port = server.address().port;

    console.log('Example app listening at :%s', port);
});


// SOCKET.IO
var io = require('socket.io').listen(server);
io.on('connection', function(socket) {
    tracker.playRandom(); // Only will run once

    socket.emit('playlist.now', { track: tracker.track, position: tracker.getPosition() });

    lyrics.fetch(tracker.track.artist, tracker.track.track, function (err, lyrics) {
        if (!err && lyrics) {
            socket.emit('song.lyrics', lyrics);
        } else {
            socket.emit('song.lyrics', 'No lyrics available');
        }
    });

    socket.on('playlist.update', function(data) {
        current = data;
    });

    socket.on('playlist.queue', function(data) {
        socket.emit('playlist.queue', tracker.queueSong(data.mbid));
        // Tell everyone the track has been queued

        for (var n = 0; n < tracklist.length; n++) {
            if (tracklist[n].mbid == data.mbid) {
                data = tracklist[n];
                break;
            }
        }
        io.emit('playlist.queued', data);
    });

    socket.on('playlist.playing', function(data) {
        // tracker.setDuration(data.mbid, data.duration);
    });

    socket.on('tracklist.rate', function(data) {
        rateSong(data);
    });

    socket.on('tracklist.list', function(data) {
        socket.emit('tracklist.list', tracklist);
    });
});



hbs.registerPartials(__dirname + '/views/partials');

app.set('views', './views')
app.set('view engine', 'hbs');

app.use('/css', express.static('css'));
app.use('/js', express.static('js'));
app.use('/fonts', express.static('fonts'));

app.use('/music', express.static('music'));
app.use('/images', express.static('images'));

app.get('/', function (req, res) {
    res.render('index', { });
});

app.get('/search/:q', function (req, res) {    

    if (!req.params.q || !req.params.q.length) {
        res.send([]);
        return;
    }

    lastFM.track.search({
        'track' : req.params.q,
        'limit' : 10
    }, function (err, response) {
        if (err) { console.log('l.fm Search ' + err); res.send('[]'); return; }
        
        var results = [];

        console.log('\n\nSearch: '+req.params.q);

        if (response.trackmatches.track) {
            // Loop results
            var resultsLength = response.trackmatches.track.length;

            if (resultsLength) {
                for (i = 0; i < resultsLength; i++) {
                    // Check item has mbid
                    var item = response.trackmatches.track[i];

                    if (!item.mbid) continue;

                    var tmpItem = {};
                    tmpItem.artist = item.artist;
                    tmpItem.track = item.name;
                    tmpItem.mbid = item.mbid;

                    for (var n = 0; n < tracklist.length; n++) {
                        if (tracklist[n].mbid == item.mbid) {
                            tmpItem.added = true;
                            break;
                        }
                    }

                    // Get image
                    if (item.image) {
                        for (n = 0; n < item.image.length; n++) {
                            if (item.image[n].size == 'large') {
                                tmpItem.image = item.image[n]['#text'];
                            }
                        }
                    }

                    results.push(tmpItem);
                }
            } else {
                // Check item has mbid
                var item = response.trackmatches.track;

                if (item.mbid) {
                    var tmpItem = {};
                    tmpItem.artist = item.artist;
                    tmpItem.track = item.name;
                    tmpItem.mbid = item.mbid;

                    for (var n = 0; n < tracklist.length; n++) {
                        if (tracklist[n].mbid == item.mbid) {
                            tmpItem.added = true;
                            break;
                        }
                    }

                    // Get image
                    if (item.image) {
                        for (n = 0; n < item.image.length; n++) {
                            if (item.image[n].size == 'large') {
                                tmpItem.image = item.image[n]['#text'];
                            }
                        }
                    }

                    results.push(tmpItem);
                }
            }
        }

        res.send(JSON.stringify(results));
    });
});

app.get('/add/:id', function (req, res) {
    addSong(req.params.id, res, false);
});

function addSong(mbid, res, skipCheck) {
    console.log(mbid);
    lastFM.track.getInfo({
        'mbid' : mbid
    }, function (err, response) {
        if(err || !response || !response.mbid) {
            console.log('Add song:',err, response);
            if (res) {
                res.render('added', { title: 'Hey', message: 'Song not found'});
            }
            return;
        }

        var data = {};

        data.mbid = response.mbid,
        data.track = response.name,
        data.artist = response.artist.name,
        data.image = '',
        data.outputPath = 'music/' + data.mbid + '.mp4';
        data.duration = response.duration;


        // Check file doesn't already exist
        if (!skipCheck) {
            var added = false;
            for (var i = 0; i < tracklist.length; i++) {
                if (tracklist[i].mbid == data.mbid) {
                    added = true;
                    break;
                }
            }
            if (added || fs.existsSync(data.outputPath)) { 
                if (res) {
                    res.render('added', { message: 'File already downloaded'});
                }
                console.log('File already downloaded');
                return;
            }
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
                if (res) {
                    res.render('added', { title: 'Hey', message: 'No results found'});
                }
                return;
            }

            // Loop through results until we find an appropriate file
            console.log(results);
            checkResults(res, results, data, 0);
        });
    });
}

function rateSong(data) {
    var action = data.action,
        mbid = data.mbid;

        try {
            if (action == 'like') {
                var stmt = db.prepare("UPDATE tracks SET likes = likes + 1 WHERE mbid = ?");
                stmt.run(mbid);
            } else {
                var stmt = db.prepare("UPDATE tracks SET dislikes = dislikes + 1 WHERE mbid = ?");
                stmt.run(mbid);
            }

            for (var n = 0; n < tracklist.length; n++) {
                if (tracklist[n].mbid == mbid) {
                    data.track = tracklist[n];
                    break;
                }
            }
            io.emit('tracklist.rate', data);
        } catch(e) {
            //
        }
}


function checkResults(res, results, data, n) {
    if (n >= results.length || n > 10) {
        console.log('No source found');
        return;
    }

    if (!results[n] || !results[n].id) {
        console.log(n + ' checkResults, missing ID');
        checkResults(res, results, data, ++n);
        return;
    }

    console.log('Checking result ' + results[n].id);

    var duration = data.duration / 1000;
    ytdl.getInfo('http://www.youtube.com/watch?v=' + results[n].id, {downloadURL: true}, function(err, info) {
        if (err) {
            console.log(err);
            checkResults(res, results, data, ++n);
            return;
        }

        // Check if duration is valid
        if (info.length_seconds < duration * 0.8 || info.length_seconds > duration * 1.2) {
            console.log('Invalid duration: ' + info.length_seconds + ', target is: ' + data.duration);
            checkResults(res, results, data, ++n);
            return;
        }

        downloadSong(results[n].id, data.outputPath);

        console.log("Downloaded " + data.track + " - " + data.artist);

        io.emit('tracklist.add', data);

        // Add to tracklist
        tracklist.push({
            mbid: data.mbid,
            track: data.track,
            artist: data.artist,
            image: data.image,
            likes: 1,
            youtube: results[n].id
        });

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
                // Callback mode
                video.fnExtractSoundToMP3(path.resolve(__dirname, outputPath.replace(/4$/, "3")), function (error, file) {
                    if (!error) {
                        console.log('File converted: ' + file);

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


function generateArtistBackground(artist) {
    var outputPath =  'images/' + artist.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.png';
    if (fs.existsSync(outputPath)) return;

    // Create file to stop others
    var file = fs.createWriteStream(outputPath);

    console.log('Get artist info: ' + artist);
    lastFM.artist.getInfo({
        'artist' : artist
    }, function (err, response) {
        if (response) {
            var images = response.image;
            var image, n = 0;
            for (n = images.length; n >= 0; n--) {
                if (images[n] && images[n].size) {
                    image = images[n]['#text'];
                    break;
                }
            }

            if (image) {
                http.get(image, function (res) {
                    console.log('Artist image downloaded');
                    res.pipe(file);
                    file.on('finish', function() {
                        file.close(function() {

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
                                            console.log('write error: ' + err);
                                        } else {
                                            console.log('Image saved to: ' + outputPath);
                                        }
                                     });
                            });
                        });
                    });
                });
            } else {
                console.log('No artist image found');
            }

        } else if (err) {
            console.log(err);
        }
    });
}

