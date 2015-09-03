var fs = require('fs'),
    path = require('path'),
    http = require('http'),
    express = require('express'),
    app = express(),
    hbs = require('hbs'),
    socketIO = require('socket.io'),
    colors = require('colors'),
    config = require('config');

var Library = require('./lib/library.js'),
    TrackWatcher = require('./lib/trackWatcher.js'),
    TrackManager = require('./lib/trackManager.js');

process.title = "Grooveshare"

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


trackWatcher = new TrackWatcher();
trackManager = new TrackManager();
global.library = library = new Library(function() {
    console.log('%s %d tracks', 'Library loaded:'.green, this.countTracks()); trackWatcher.setup(this)
});

library.watch('added', function(trackID) {
    trackWatcher.queueSong(trackID);
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




// SOCKET.IO setup
var io = socketIO.listen(server);

// Watch TrackWatcher and emit changes
trackWatcher.watch('play', function(track) {
    io.sockets.emit('playlist.play', { track: track });
    // Update library
    library.playingTrack(track.id);
});

trackWatcher.watch('preload', function(track) {
    io.sockets.emit('playlist.preload', track);
});

trackWatcher.watch('queued', function(track) {
    io.sockets.emit('track.queued', track);
});

library.watch('added', function(trackID) {
    // Look up ID
    var track = library.lookupTrackID(trackID);
    io.sockets.emit('track.added', track);
});

library.watch('rated', function(data) {
    io.sockets.emit('track.rated', data);
});

var connections = 0;
io.on('connection', function(socket) {
    connections++;
    console.log('New client [' + connections + ']');

    // Get queue
    var q = trackWatcher.queue,
        queueLength = q.length,
        queue = [];

    for (n = 0; n < queueLength; n++) {
        queue[n] = library.lookupTrackID(q[n]);
    }

    socket.emit('playlist.play', { track: trackWatcher.playing, position: trackWatcher.getPosition(), queue: queue });

    // lyrics.fetch(tracker.track.artist, tracker.track.track, function (err, lyrics) {
    //     if (!err && lyrics) {
    //         socket.emit('song.lyrics', lyrics);
    //     } else {
    //         socket.emit('song.lyrics', 'No lyrics available');
    //     }
    // });

    socket.on('register', function(data) {
        socket.uuid = data.uuid;
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

    socket.on('disconnect', function () {
        connections--;
        console.log('Lost client [' + connections + ']');
    });
});