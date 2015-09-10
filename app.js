var fs = require('fs'),
    path = require('path'),
    http = require('http'),
    express = require('express'),
    app = express(),
    hbs = require('hbs'),
    socketIO = require('socket.io'),
    colors = require('colors'),
    config = require('config'),
    sqlite3 = require('sqlite3').verbose();

var Library = require('./lib/library.js'),
    TrackManager = require('./lib/trackManager.js'),
    Listener = require('./lib/listener.js'),
    channels = [];

process.title = "Grooveshare";

// Check config file - Only checks for the existant of the entry, not the value.
if(!config.has('LastFM.key') || !config.has('LastFM.secret') || !config.has('YouTube.key') || !config.has('Service.port') || !config.has('Service.interface')){
    console.log("Missing value in configuration file, please see config/example.json.\nBye Bye.");
    process.exit();
}

// Check folder structure is in tact
if (!fs.existsSync(path.resolve(__dirname, 'data'))) {
    fs.mkdirSync(path.resolve(__dirname, 'data'));
}
if (!fs.existsSync(path.resolve(__dirname, 'data/music'))) {
    fs.mkdirSync(path.resolve(__dirname, 'data/music'));
}
if (!fs.existsSync(path.resolve(__dirname, 'data/images'))) {
    fs.mkdirSync(path.resolve(__dirname, 'data/images'));
}


// Check DB is initiated
var db = new sqlite3.Database('tracks.db');
global.db = db;

db.run("CREATE TABLE IF NOT EXISTS listeners (\
        uuid TEXT NOT NULL,\
        username TEXT,\
        email TEXT,\
        lastfm_username TEXT,\
        lastfm_session TEXT,\
        added DATETIME DEFAULT CURRENT_TIMESTAMP,\
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,\
        PRIMARY KEY (uuid)\
     )");

db.run("CREATE TABLE IF NOT EXISTS channels (\
        channel_id INT PRIMARY KEY AUTOINCREMENT,\
        channel TEXT NOT NULL,\
        created DATETIME DEFAULT CURRENT_TIMESTAMP,\
        PRIMARY KEY (uuid, track)\
     )");

db.run("CREATE TABLE IF NOT EXISTS channels_tracks (\
        channel_id INT PRIMARY,\
        track_id INT PRIMARY,\
        uuid INT,\
        last DATETIME,\
        plays INT,\
        added DATETIME DEFAULT CURRENT_TIMESTAMP,\
        PRIMARY KEY (uuid, track)\
     )");

db.run("CREATE TABLE IF NOT EXISTS tracks_ratings (\
        uuid TEXT NOT NULL,\
        track TEXT NOT NULL,\
        channel INT,\
        rating INT,\
        added DATETIME DEFAULT CURRENT_TIMESTAMP,\
        PRIMARY KEY (uuid, track)\
     )");

db.run("CREATE TABLE IF NOT EXISTS tracks (\
        id TEXT PRIMARY KEY NOT NULL,\
        track TEXT NOT NULL,\
        artist TEXT NOT NULL,\
        image TEXT,\
        uuid INT,\
        last DATETIME,\
        plays INT,\
        added DATETIME DEFAULT CURRENT_TIMESTAMP,\
        youtube TEXT NOT NULL\
     );");


trackManager = new TrackManager();
global.library = library = new Library(db, function() {
    console.log('%s %d tracks', 'Library loaded:'.green, this.countTracks());
    // trackWatcher.setup(this);
});

library.watch('added', function(trackID) {
    // trackWatcher.queueSong(trackID);
});


// Express setup
var server = app.listen(config.get('Service.port'), config.get('Service.interface'), function () {
    console.log('Grooveshare running on %s:%s'.green, config.get('Service.interface'), config.get('Service.port'));
});

// hbs.registerPartials(__dirname + '/client/views/partials');

app.set('views', __dirname + '/client/views')
app.set('view engine', 'hbs');

app.use('/css', express.static(__dirname + '/client/css'));
app.use('/js', express.static(__dirname + '/client/js'));
app.use('/fonts', express.static(__dirname + '/client/fonts'));

app.use('/music', express.static(__dirname + '/data/music'));
app.use('/images', express.static(__dirname + '/data/images'));

app.get('/', function (req, res) {
    res.render('index', { });
});

app.get('/search/:q', function (req, res) {    
    trackManager.findSong(req.params.q, function(response) {
        res.send(response);
    });
});

app.get('/add/:q', function (req, res) {
    trackManager.addSong(req.params.q);
    // Close connection
    res.send();
});

app.get('/lastfm', function (req, res) {
    console.log(req.query.listener, req.query.token);
    listeners[req.query.listener].authLastFM(req.query.token);
    res.send('<script>window.close();</script>');
});


// SOCKET.IO setup
var io = socketIO.listen(server);


library.watch('added', function(trackID) {
    // Look up ID
    var track = library.lookupTrackID(trackID);
    io.sockets.emit('track.added', track);
});

library.watch('rated', function(data) {
    io.sockets.emit('track.rated', data);

    // Update trackWatcher
    trackWatcher.updateRatings(data);
});

var connections = 0,
    listeners = [];
io.on('connection', function(socket) {
    connections++;

    socket.on('register', function(data) {
        socket.uuid = data.uuid;

        // Create listener object
        socket.listener = new Listener(db, socket);
        listeners[data.uuid] = socket.listener;
    });


    socket.on('channel.join', function(channel) {
        console.log(socket.rooms);

        // Is this channel setup?
        if (!(req.params.channel in channels)) {
            // Create channel
            var channel = new Channel(req.params.channel, library, io)
            channels[req.params.channel] = channel;
        }

        // Join channel
        socket.join('#' + req.params.channel);

        // Get queue
        var q = channel.trackWatcher.queue,
            queueLength = q.length,
            queue = [];

        for (n = 0; n < queueLength; n++) {
            queue[n] = library.lookupTrackID(q[n]);
        }

        socket.emit('playlist.play', { track: channel.trackWatcher.playing, position: channel.trackWatcher.getPosition(), queue: queue });
    });


    socket.on('playlist.queue', function(data) {
        trackWatcher.queueSong(data.id);
    });

    socket.on('tracklist.list', function(data) {
        socket.emit('tracklist.list', library.tracks);
    });

    socket.on('track.rate', function(data) {
        library.rateTrack(data.id, socket.uuid, data.rating);
    });

    socket.on('lastfm.auth', function(data) {
        socket.listener.authLastFM();
    });

    socket.on('lastfm.scrobble', function() {
        socket.listener.scrobbleSong(trackWatcher.playing.track, trackWatcher.playing.artist, Math.floor((new Date()).getTime() / 1000));
    });

    socket.on('disconnect', function () {
        connections--;
    });
});