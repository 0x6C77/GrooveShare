var config = require('config'),
    path = require('path'),
    fs = require('fs'),
    LastfmAPI = require('lastfmapi'),
    shortid = require('shortid'),
    YTSearch = require('youtube-search'),
    ytdl = require('ytdl-core'),
    ffmpeg = require('ffmpeg');

var lastFM = new LastfmAPI({
    'api_key' : config.get('LastFM.key'),
    'secret' : config.get('LastFM.secret')
});

var YTSearchOpts = {
    maxResults: 10,
    regionCode: 'GB',
    type: 'video',
    safeSearch: 'none',
    key: config.get('YouTube.key')
};



var TrackManager = function() {
    this.tmpIDs = []; // Track songs that don't have mbid's supplied

    // RegEx matching MBID
    this.mbidRegex = /^[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}$/;
}


/**
 * Lookup songs via last.fm api
 * @param {String} search query
 * @param {Function} callback [{String} JSON of search results]
 */
TrackManager.prototype.findSong = function(q, callback) {
    if (!callback && typeof(callback) !== "function") {
        return;
    }

    if (!q) {
        callback([]);
        return;
    }

    var self = this;

    lastFM.track.search({
        'track' : q,
        'limit' : 10
    }, function (err, response) {
        if (err) {
            console.log('Error tm.fs.lastFM '.red + err);
            callback([]);
            return;
        }
        
        var results = [];

        if (response.trackmatches.track) {
            // Loop results
            var resultsLength = response.trackmatches.track.length;

            // No results found
            if (!resultsLength) {
                callback([]);
                return;
            }

            for (i = 0; i < resultsLength; i++) {
                if (!response.trackmatches.track[i]) continue;
                var item = response.trackmatches.track[i];

                var tmpItem = {};
                tmpItem.artist = item.artist;
                tmpItem.track = item.name;

                if (!tmpItem.artist || !tmpItem.track) {
                    continue; // skip track
                }

                // If item has mbid use that
                if (item.mbid) {
                    tmpItem.id = item.mbid;
                    tmpItem.added = Boolean(global.library.lookupTrackID(tmpItem.id));
                } else {
                    // Generate an ID
                    tmpItem.id = shortid.generate();

                    // Store track in lookup
                    self.tmpIDs[tmpItem.id] = tmpItem;

                    tmpItem.added = Boolean(global.library.lookupTrack(item.track, item.artist));
                }

                // Get image
                if (item.image) {
                    for (n = 0; n < item.image.length; n++) {
                        if (item.image[n].size == 'large') {
                            tmpItem.image = item.image[n]['#text'];
                        }
                    }
                }

                results.push(tmpItem);
            }
        }

        callback(JSON.stringify(results));
    });
}

/**
 * Add song to library
 * @param {String} mbid or search query
 * @param {Function} callback [{Boolean} track has been added]
 */
TrackManager.prototype.addSong = function(q, callback) {
    if (!q) return;

    var self = this;

    // If it a mbid?
    var opts = {}
    if (this.mbidRegex.test(q)) {
        opts.mbid = q;
    } else if (this.tmpIDs[q]) {
        opts.track = this.tmpIDs[q].track
        opts.artist = this.tmpIDs[q].artist
    } else {
        console.log('Error tm.as.tmp: '.red + q + ' not in tmpIDs'.red);
        return;
    }

    // Load track details from last.fm
    lastFM.track.getInfo(opts, function (err, response) {
        if(err || !response) {
            console.log('Error tm.as.lookup:'.red, err, response);
            return;
        }

        // Check song is from an album
        // if (!response.album) return;

        var data = {};

        if (response.mbid) {
            data.id = response.mbid;
        } else {
            data.id = shortid.generate();
        }
        data.track = response.name;
        data.artist = response.artist.name;
        data.image = '';
        // data.outputPath = 'music/' + data.id + '.mp4';
        data.duration = response.duration;

        // Check if item is already in library
        if (global.library.lookupTrack(data.track, data.artist)) {
            return;
        }

        // Get image
        if (response.album) {
            for (n = 0; n < response.album.image.length; n++) {
                if (response.album.image[n].size == 'large' && !data.image ||
                    response.album.image[n].size == 'extralarge') {
                    data.image = response.album.image[n]['#text'];
                }
            }
        } else {
            data.image = '';
        }

        self.findVideo(data, function(YTID) {
            data.YTID = YTID;
            global.library.addTrack(data);
        });
    });
}

TrackManager.prototype.findVideo = function(data, callback) {
    var self = this;
    YTSearch(data.track + ' ' + data.artist, YTSearchOpts, function(err, results) {
        if(err || !results || !results.length) {
            console.log('Error tm.fv.yts:'.red, err);
            return;
        }

        // Loop through results until we find an appropriate file
        self.checkVideoResults(results, data, callback);
    });
}

TrackManager.prototype.checkVideoResults = function(results, data, callback, n) {
    if (typeof n === 'undefined') {
        n = 0;
    }

    // Run out of search results without finding suitable match
    if (n >= results.length || n > 10) {
        console.log('No source found'.red);
        return;
    }

    var self = this,
        result = results[n],
        duration = data.duration / 1000;

    // Skip result if it doesn't exist
    if (!result || !result.id) {
        self.checkVideoResults(results, data, callback, ++n);
        return;
    }

    ytdl.getInfo('http://www.youtube.com/watch?v=' + result.id, {downloadURL: true}, function(err, info) {
        if (err) {
            console.log('Error tm.cvr.ytdl:'.red, err);
            self.checkVideoResults(results, data, callback, ++n);
            return;
        }

        // Check if duration is valid
        if (duration && (info.length_seconds < duration * 0.8 || info.length_seconds > duration * 1.5 || info.length_seconds > 600)) {
            console.log('Invalid duration: ' + info.length_seconds + ', target is: ' + duration);
            self.checkVideoResults(results, data, callback, ++n);
            return;
        }

        self.downloadVideo(result.id, data.id);
        callback(result.id); // Don't wait for download
    });
}

TrackManager.prototype.downloadVideo = function(YTID, trackID) {
    var outputPath = path.resolve(__dirname, '../data/music', trackID);

    try {
        // Download video from YT
        var stream = ytdl('http://www.youtube.com/watch?v=' + YTID);

        // Create file from video
        stream.pipe(fs.createWriteStream(outputPath + '.mp4'));

        // Once download has finished
        stream.on('end', function() {
                // Load in video
                var process = new ffmpeg(outputPath + '.mp4');
                process.then(function (video) {
                    // Export as mp3
                    video.fnExtractSoundToMP3(outputPath + '.mp3', function (error, file) {
                        if (!error) {
                            // Delete original mp4
                            fs.unlink(path.resolve(__dirname, outputPath + '.mp4'));
                        } else {
                            console.log(error);
                        }
                    });
                }, function (err) {
                    console.log('Error: ' + err);
                });
        });
    } catch (e) {
        console.log(e);
    }
}


module.exports = TrackManager;