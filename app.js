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
    Channel = require('./lib/channel.js'),
    channels = {};

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
// global.db = db;

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
        channel_id INTEGER PRIMARY KEY AUTOINCREMENT,\
        channel TEXT NOT NULL,\
        image TEXT,\
        owner INT,\
        created DATETIME DEFAULT CURRENT_TIMESTAMP\
     )");

db.run("CREATE TABLE IF NOT EXISTS channels_tracks (\
        channel_id INT,\
        track_id INT,\
        uuid INT,\
        last DATETIME,\
        plays INT,\
        added DATETIME DEFAULT CURRENT_TIMESTAMP,\
        PRIMARY KEY (channel_id, track_id)\
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


// Add starting channels
// var stmt = db.prepare("INSERT INTO channels (`channel`, `image`) VALUES (?, ?)");
// stmt.run('Random spamdom', 'Hsakdfuhwiue4ryh59834.jpg');
// stmt.run('Friday playlist', 'ASDbksdjifhbgi9o324b4.jpg');
// stmt.run('Metal Mayhem', 'KSdfbkauie4th9834nhuin.jpg');



global.trackManager = trackManager = new TrackManager();
global.library = library = new Library(db, function() {
    console.log('%s %d tracks', 'Library loaded:'.green, this.countTracks());
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
app.use('/images', express.static(__dirname + '/client/images'));

app.use('/music', express.static(__dirname + '/data/music'));
app.use('/music/images', express.static(__dirname + '/data/images'));

app.get('/', function (req, res) {
    res.render('index', { });
});

app.get('/lastfm', function (req, res) {
    console.log(req.query.listener, req.query.token);
    listeners[req.query.listener].authLastFM(req.query.token);
    res.send('<script>window.close();</script>');
});


// SOCKET.IO setup
var io = socketIO.listen(server);


// library.watch('rated', function(data) {
//     io.sockets.emit('track.rated', data);

//     // Update trackWatcher
//     trackWatcher.updateRatings(data);
// });

var connections = 0,
    listeners = [];
io.on('connection', function(socket) {
    connections++;

    socket.on('register', function(data) {
        socket.uuid = data.uuid;

        // Create listener object
        socket.listener = new Listener(db, socket);
        listeners[data.uuid] = socket.listener;

        // Get channels list
        db.all("SELECT * FROM channels ORDER BY channel_id", function(err, rows) {
            if (err) {
                console.log('Error loading channels'.red);
                return;
            }

            socket.emit('channels.list', rows);
        });
    });


    socket.on('channel.join', function(channel_id) {
        // Is this channel setup?
        if (!(channel_id in channels)) {
            // Create channel
            var channel = new Channel(channel_id, db, library, io, function() {
                channels[channel_id] = channel;
                joinedChannel(channel_id, socket);
            });
        } else {
            joinedChannel(channel_id, socket);
        }
    });

    socket.on('channel.leave', function() {
        var channel = channels[socket.channel];

        socket.leave('#' + socket.channel);
        socket.broadcast.to('#' + socket.channel).emit('channel.details', { listeners: channel.getListeners() });

        socket.channel = null;
    });

    socket.on('playlist.add', function(data) {
        channels[socket.channel].addSong(data.id);
    });

    socket.on('playlist.queue', function(data) {
        channels[socket.channel].trackWatcher.queueSong(data.id);
    });

    socket.on('tracklist.list', function(data) {
        channels[socket.channel].getTracks(function(tracks) {
            socket.emit('tracklist.list', tracks);
        });
    });

    socket.on('track.rate', function(data) {
        library.rateTrack(data.id, socket.uuid, data.rating);
    });

    socket.on('track.search', function(data) {
        trackManager.findSong(data.q, function(response) {
            socket.emit('track.search', response);
        });
    });

    socket.on('lastfm.auth', function(data) {
        socket.listener.authLastFM();
    });

    socket.on('lastfm.scrobble', function() {
        if (socket.channel) {
            var channel = channels[socket.channel];
            socket.listener.scrobbleSong(channel.trackWatcher.playing.track, channel.trackWatcher.playing.artist, Math.floor((new Date()).getTime() / 1000));
        }
    });

    socket.onclose = function(reason) {
        if (socket.channel) {
            var channel = channels[socket.channel];
            socket.leave('#' + socket.channel);
            socket.broadcast.to('#' + socket.channel).emit('channel.details', { listeners: channel.getListeners() });
        }
        Object.getPrototypeOf(this).onclose.call(this,reason);
    }

    socket.on('disconnect', function () {
        connections--;
    });
});


function joinedChannel(channel_id, socket) {
    // Join channel
    socket.join('#' + channel_id);
    socket.channel = channel_id;

    var channel = channels[channel_id];

    // Tell everyone we have a new user
    socket.broadcast.to('#' + channel_id).emit('channel.details', { listeners: channel.getListeners() });

    // Get queue
    var q = channel.trackWatcher.queue,
        queueLength = q.length,
        queue = [];

    for (n = 0; n < queueLength; n++) {
        queue[n] = library.lookupTrackID(q[n]);
    }

    socket.emit('channel.joined', { channel: channel.getDetails(), track: channel.trackWatcher.playing, position: channel.trackWatcher.getPosition(), queue: queue });
}
