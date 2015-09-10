var TrackWatcher = require('./lib/trackWatcher.js');


var Channel = function(channel_id, library, io) {
    var self = this;
    this.id = channelId;
    this.library = library;
    this.io = io;
    this.trackWatcher = new TrackWatcher(channel_id, library);

    // Watch TrackWatcher and emit changes
    this.trackWatcher.watch('play', function(track) {
        self.io.to('#'+self.channel_id).emit('playlist.play', { track: track });

        // Update library
        self.library.playingTrack(track.id, self.id);
    });

    this.trackWatcher.watch('preload', function(track) {
        self.io.to('#'+self.channel_id).emit('playlist.preload', track);
    });

    this.trackWatcher.watch('queued', function(track) {
        self.io.to('#'+self.channel_id).emit('track.queued', track);
    });

}


module.exports = Channel;