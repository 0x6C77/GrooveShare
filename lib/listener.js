// Load tracks
var colors = require('colors'),
    config = require('config'),
    LastfmAPI = require('lastfmapi');

var lastFM = new LastfmAPI({
    'api_key' : config.get('LastFM.key'),
    'secret' : config.get('LastFM.secret')
});

var Listener = function(socket) {
    var self = this;

    this.socket = socket;
    this.scrobbling = false;

    // TODO: Check if user has stored credentials, probably DB
    // lastFM.setSessionCredentials(username, key);
}

Listener.prototype.scrobbleSong = function(track, artist, timestamp) {
    if (!this.scrobbling) return;
    var self  = this;

    console.log(lastFM.sessionCredentials);

    lastFM.track.scrobble({
        'artist' : artist,
        'track' : track,
        'timestamp' : timestamp,
        'chosenByUser' : 0
    }, function (err, scrobbles) {
        if (err) console.log(err);
        console.log(self.session.useranem + ' has just scrobbled:', scrobbles);
    });
}

Listener.prototype.authLastFM = function(token) {
    if (!token) {
        var url = lastFM.getAuthenticationUrl({ 'cb' : 'http://grooveshare.co.uk/lastfm?listener=' + this.socket.uuid });
        this.socket.emit('lastfm.authURL', url);
    } else {
        lastFM.authenticate(token, function (err, session) {
        if (err) { throw err; }
            self.session = session;
            self.scrobbling = true;
        });
    }
}


module.exports = Listener;