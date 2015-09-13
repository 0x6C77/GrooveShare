var TrackWatcher = require('./trackWatcher.js');


var Channel = function(channel_id, db, library, io, callback) {
    var self = this;
    this.id = channel_id;
    this.db = db;
    this.library = library;
    this.io = io;
    this.trackWatcher = new TrackWatcher(channel_id, library);
    this.songs = 0;

    // Get library info
    var stmt = this.db.prepare("SELECT channel, image, IFNULL(songs.songs, 0) AS `songs`\
                                FROM channels\
                                LEFT JOIN (SELECT channel_id, count(*) AS `songs` FROM channels_tracks GROUP BY channel_id) `songs`\
                                ON songs.channel_id = channels.channel_id\
                                WHERE channels.channel_id = ?");
    stmt.get(channel_id, function(err, channel) {
        self.channel = channel.channel;
        self.image = channel.image;
        self.songs = channel.songs;
        callback();
    });


    // Watch TrackWatcher and emit changes
    this.trackWatcher.watch('play', function(track) {
        self.io.to('#'+self.id).emit('playlist.play', { track: track });

        // Update library
        self.library.playingTrack(track.id, self.id);
    });

    this.trackWatcher.watch('preload', function(track) {
        self.io.to('#'+self.id).emit('playlist.preload', track);
    });

    this.trackWatcher.watch('queued', function(track) {
        console.log('[%d] Song queued: %s - %s', self.id, track.track, track.artist);
        self.io.to('#'+self.id).emit('track.queued', track);
    });
};

Channel.prototype.addSong = function(id) {
    var self = this;
    // Check if the library has the song
    this.library.lookupTrackID(id, function(track) {
        if (track) {
            // We already have it, just add it to this library
            self.addSongToChannel(id);
        } else {
            // Download song
            global.trackManager.addSong(id, function(data) {
                self.addSongToChannel(data.id);
            });
        }
    });
};

Channel.prototype.addSongToChannel = function(id) {
    var stmt = this.db.prepare("INSERT OR IGNORE INTO channels_tracks (`channel_id`, `track_id`) VALUES (?, ?)");
    stmt.run(this.id, id);
    console.log('[%d] Track added: %s', this.id, id);

    // Was this the first song?
    if (this.songs === 0) {
        this.trackWatcher.getNext();
    }

    // Queue song
    this.trackWatcher.queueSong(id);

    // Tell everyone
    var track = library.lookupTrackID(id);
    this.io.to('#'+this.id).emit('track.added', track);
    this.getSongCount();
};

Channel.prototype.getListeners = function() {
    var room = this.io.sockets.adapter.rooms['#'+this.id];
    if (!room) return 0;
    return Object.keys(room).length;
};

Channel.prototype.getTracks = function(callback) {
    var tracks = this.library.getTracks(this.id, callback);
};

Channel.prototype.getSongCount = function() {
    var self = this;

    var stmt = this.db.prepare("SELECT count(*) AS `songs` FROM channels_tracks WHERE channel_id = ?");
    stmt.get(self.id, function(err, details) {
        self.songs = details.songs;
        self.io.to('#'+self.id).emit('channel.details', { songs: self.songs });
    });
};

Channel.prototype.getDetails = function() {
    return {
        'channel_id': this.id,
        'channel': this.channel,
        'image': this.image,
        'listeners': this.getListeners(),
        'songs': this.songs
    }
};

module.exports = Channel;
