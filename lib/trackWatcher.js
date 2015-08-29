var path = require('path'),
    ffprobe = require('node-ffprobe'),
    colors = require('colors');

var TrackWatcher = function() {
    var self = this;
    this.queue = [];
    this.playing = {};

    // Keep track of callbacks
    this.watchers = [];
    
    setInterval(function() {
        self.checkProgress();
    }, 500);
}


TrackWatcher.prototype.setup = function(library) {
    var self = this;
    this.library = library;

    // Play next song
    this.getNext(function(track) {
        self.play(track);
    });
}

TrackWatcher.prototype.getNext = function(callback) {
    var track;

    // Is there anything in the queue?
    if (this.queue.length) {
        trackID = this.queue.shift();
        // Lookup id in library
        this.library.lookupTrackID(trackID, function(track) {
            if (callback && typeof(callback) === "function") {
                callback(track);
            }
        });
    } else {
        // Get random song from library
        this.library.getRandomTrackID(function(trackID) {
            this.library.lookupTrackID(trackID, function(track) {
                if (callback && typeof(callback) === "function") {
                    callback(track);
                }
            });
        });
    }


    // Make sure the artwork is ready
    // this.library.generateArtistBackground(track);

    return track;
}

TrackWatcher.prototype.play = function(track) {
    var self = this;

    // Check the track file exists and is valid
    var filePath = path.resolve(__dirname, '../data/music/' + track.id + '.mp3');
    ffprobe(filePath, function(err, probeData) {
        // Check if song is corrupted
        if (err || !probeData || !probeData.streams) {
            // Skip track
            console.log('%s %s - %s [%s]',
                'Skipped song:'.red,
                self.playing.track,
                self.playing.artist,
                'Error tw.p.ffprobe'
            );

            self.playing = null;
            // Play next song
            self.getNext(function(track) {
                self.play(track);
            });
        } else {

            // Set playing track
            self.playing = track;
            self.playing.started = Date.now() + 5000; // Give clients 5 seconds to sync
            self.playing.duration = probeData.streams[0].duration - probeData.streams[0].start_time;

            var m = Math.floor(self.playing.duration/60),
                s = Math.floor(self.playing.duration - (m*60));

            // Emit event
            self.emit('play', self.playing);

            console.log('%s %s - %s [%d:%d]',
                'Playing song:'.bold,
                self.playing.track,
                self.playing.artist,
                m,
                s
            );

        }
    });
}

TrackWatcher.prototype.getPosition = function() {
    if (!this.playing) return;
    return (Date.now() - this.playing.started) / 1000;
}

TrackWatcher.prototype.queueSong = function(id) {
    if (this.queue.indexOf(id) > -1) {
        return false;
    } else {
        this.queue.push(id);
        this.library.lookupTrackID(id, function(track) {
            console.log('Song queued: ' + track.track + ' - ' + track.artist);
        });        
        return true;
    }
}


TrackWatcher.prototype.checkProgress = function() {
    if (!this.playing) return; // Nothing playing

    var self = this,
        data = {};

    data.current = this.getPosition();
    data.duration = this.playing.duration;
    data.progress = (data.current / data.duration) * 100;


    // Time to play the next song
    if (data.progress > 75 && !this.playing.preloading) {
        this.getNext(function(next) {
            console.log('Preloading: ' + next.track + ' - ' + next.artist);
            // Add to the front of the queue
            self.queue.unshift(next.id);

            // Tell clients to preload
            self.emit('preload', next);
            self.playing.preloading = true;
        });
    }

    if (data.progress >= 100) {
        this.getNext(function(track) {
            self.play(track);
        });
    }


    // Dispatch events
    this.emit('progress', data);
}


// Subscribe to events
TrackWatcher.prototype.watch = function(event, callback) {
    if (typeof this.watchers[event] === 'undefined') {
        this.watchers[event] = [];
    }
    this.watchers[event].push(callback);
}

// Emit events
TrackWatcher.prototype.emit = function(event, data) {
    if (event in this.watchers && this.watchers[event].length) {
        for (i = 0; i < this.watchers[event].length; i++) {
            this.watchers[event][i](data);
        }
    }
}




module.exports = TrackWatcher;