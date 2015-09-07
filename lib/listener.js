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
}


TrackManager.prototype.authLastFM = function() {
    var url = lastFM.getAuthenticationUrl({ 'cb' : 'http://grooveshare.co.uk/lastfm' });
    this.socket.emit('lastfm.authURL', url);
}