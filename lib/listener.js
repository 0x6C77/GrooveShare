// Load tracks
var colors = require('colors'),
    config = require('config'),
    LastfmAPI = require('lastfmapi');

var Listener = function(db, socket) {
    var self = this;

    this.db = db;

    // Keep a local lastFM copy for authentication
    this.lastFM = new LastfmAPI({
        'api_key' : config.get('LastFM.key'),
        'secret' : config.get('LastFM.secret')
    });

    this.socket = socket;
    this.scrobbling = false;

    // Check if user exists in db
    var stmt = this.db.prepare("SELECT * FROM listeners WHERE uuid = ?");
    stmt.get(socket.uuid, function(err, user) {
        if (user) {
            // Is this user scrobbling
            if (user.lastfm_session) {
                self.lastFM.setSessionCredentials(user.lastfm_username, user.lastfm_session);
                self.socket.emit('lastfm.authorised');
                self.scrobbling = true;
                self.lastfm_username = user.lastfm_username;
            }

            var stmt = self.db.prepare("UPDATE listeners SET last_seen = datetime() WHERE uuid = ?");
            stmt.run(self.socket.uuid);
        } else {
            // Add user
            var stmt = self.db.prepare("INSERT OR IGNORE INTO listeners (`uuid`) VALUES (?)");
            stmt.run(socket.uuid);
        }
    });
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
    });
}

Listener.prototype.authLastFM = function(token) {
    var self  = this;
    // Are we already authorized
    if (this.scrobbling) {
        self.socket.emit('lastfm.authorised');
    } else if (!token) {
        var url = this.lastFM.getAuthenticationUrl({ 'cb' : 'http://grooveshare.co.uk/lastfm?listener=' + this.socket.uuid });
        this.socket.emit('lastfm.authURL', url);
    } else {
        this.lastFM.authenticate(token, function (err, session) {
        if (err) { throw err; }
            self.lastfm_username = session.username;
            self.lastfm_session = session.key;
            self.scrobbling = true;

            // Store session
            var stmt = self.db.prepare("UPDATE listeners SET lastfm_username = ?, lastfm_session = ? WHERE uuid = ?");
            stmt.run(self.lastfm_username, self.lastfm_session, self.socket.uuid);

            self.socket.emit('lastfm.authorised');
        });
    }
}


module.exports = Listener;