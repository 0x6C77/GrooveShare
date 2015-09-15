var path = require('path'),
    ffprobe = require('node-ffprobe'),
    colors = require('colors');

var TrackWatcher = function(channel_id, library) {
    var self = this;
    this.channel_id = channel_id;
    this.queue = [];
    this.playing = {};
    this.library = library;

    // Play next song
    this.getNext(function(track) {
        self.play(track);
    });

    // Keep track of callbacks
    this.watchers = [];
    
    setInterval(function() {
        self.checkProgress();
    }, 500);
}


TrackWatcher.prototype.getNext = function(callback) {
    var self = this,
        track;

    // Is there anything in the queue?
    if (this.queue.length) {
        trackID = this.queue.shift();
        // Lookup id in library
        this.library.lookupTrackID(trackID, this.channel_id, function(track) {
            if (callback && typeof(callback) === "function") {
                callback(track);
            }
        });
    } else {
        // Get random song from library
        this.library.getRandomTrackID(this.channel_id, function(trackID) {
            this.library.lookupTrackID(trackID, self.channel_id, function(track) {
                if (callback && typeof(callback) === "function") {
                    callback(track);
                }
            });
        });
    }

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
            console.log('[%s] %s %s - %s [%s]',
                self.channel_id,
                'Skipped song:'.red,
                track.track,
                track.artist,
                'Error tw.p.ffprobe'
            );

            self.playing = null;
            // Play next song
            self.getNext(function(track) {
                self.play(track);
            });

        } else if (probeData.streams[0].duration - probeData.streams[0].start_time > 600) {
            // Skip track
            console.log('[%s] %s %s - %s [%s]',
                self.channel_id,
                'Skipped song:'.red,
                track.track,
                track.artist,
                'Track longer than 10 minutes'
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

            console.log('[%s] %s %s - %s [%d:%d]',
                self.channel_id,
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
    var self = this;
    if (this.queue.indexOf(id) > -1) {
        return false;
    } else {
        this.queue.push(id);
        this.library.lookupTrackID(id, function(track) {
            self.emit('queued', track);
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

TrackWatcher.prototype.updateRatings = function(data) {
    if (this.playing.id == data.trackID) {
        this.playing.up = data.up;
        this.playing.up_uuid = data.up_uuid;
        this.playing.down = data.down;
        this.playing.down_uuid = data.down_uuid;
    }
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