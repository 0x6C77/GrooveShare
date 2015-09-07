// Load tracks
var colors = require('colors'),
    config = require('config'),
    LastfmAPI = require('lastfmapi');

var Listener = function(socket) {
    var self = this;

    // Keep a local lastFM copy for authentication
    this.lastFM = new LastfmAPI({
        'api_key' : config.get('LastFM.key'),
        'secret' : config.get('LastFM.secret')
    });

    this.socket = socket;
    this.scrobbling = false;

    // TODO: Check if user has stored credentials, probably DB
    // lastFM.setSessionCredentials(username, key);
}

Listener.prototype.scrobbleSong = function(track, artist, timestamp) {
    if (!this.scrobbling) return;
    var self  = this;

    this.lastFM.track.scrobble({
        'artist' : artist,
        'track' : track,
        'timestamp' : timestamp,
        'chosenByUser' : 0
    }, function (err, scrobbles) {
        if (err) console.log(err);
        console.log(self.session.username + ' has just scrobbled:', scrobbles);
    });
}

Listener.prototype.authLastFM = function(token) {
    var self  = this;
    if (!token) {
        var url = this.lastFM.getAuthenticationUrl({ 'cb' : 'http://grooveshare.co.uk/lastfm?listener=' + this.socket.uuid });
        this.socket.emit('lastfm.authURL', url);
    } else {
        this.lastFM.authenticate(token, function (err, session) {
        if (err) { throw err; }
            self.session = session;
            self.scrobbling = true;
        });
    }
}


module.exports = Listener;