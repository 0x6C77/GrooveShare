$(function() {
    var baseURI = '/',
        socket  = io();


    // ****************************
    // SOCKETS
    // ****************************
    socket.on('tracklist.add', function(data) {
        $('#debug').prepend('New track added: ' + data.track + ' - ' + data.artist + "<br/>");
        console.log(data);
    });

    socket.on('playlist.play', function(data) {
        $('#debug').prepend('Currently playing: ' + data.track.track + ' by ' + data.track.artist + ' - ' + data.position + "<br/>");
        player.play(data.track, data.position);
        console.log(data);
    });

    socket.on('playlist.preload', function(data) {
        $('#debug').prepend('Preloading: ' + data.track + ' by ' + data.artist + "<br/>");
        player.preloadNext(data);
    });

    socket.on('playlist.queued', function(data) {
        $('#debug').prepend('Queued: ' + data.track + ' by ' + data.artist + "<br/>");
    });

    socket.on('tracklist.rate', function(data) {
        $('#debug').prepend(((data.action == 'like')?'Liked':'Disliked') + ': ' + data.track.track + ' by ' + data.track.artist + "<br/>");
    });

    socket.on('tracklist.list', function(data) {
        renderPlaylist(data);
    });

    socket.on('song.lyrics', function(data) {
        $('#lyrics').html(nl2br(data));
    });

    function nl2br(str, is_xhtml) {
        var breakTag = (is_xhtml || typeof is_xhtml === 'undefined') ? '<br />' : '<br>';
        return (str + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1' + breakTag + '$2');
    }


    // ****************************
    // SEARCH
    // ****************************
    $('#search .search-container input').on('keyup', debounce(function(e) {
        var term = $(this).val();

        if (!term) {
            $('#search .search-results').hide();
            return;
        }

        $.getJSON(baseURI + 'search/' + term, function(data) {
            renderSearchResults(data);
        });
    }, 250)).on('focus', function() {
        if ($('#search .search-results').length) {
            $('#search .search-results').show();
        }
    });


    $('#search').on('click', '.search-results li:not(.added)', function(e) {
        $.get('/add/' + $(this).data('id'), function(data) {
            // $('#debug').append(data + "<br/>");
        });

        $(this).addClass('added');
    });

    $(document).on('click', function (e) {
        if ($(e.target).closest("#search").length === 0) {
            $("#search .search-results").hide();
        }
    });

    function debounce(func, wait, immediate) {
        var timeout;
        return function() {
            var context = this, args = arguments;
            var later = function() {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            var callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    };


    function renderSearchResults(data) {
        var $results = $('#search .search-results');

        if (!$results.length) {
            $results = $('<ul>', {class: 'search-results'});
            $('#search').append($results);
        } else {
            $results.empty();
        }

        if (data.length) {
            $(data).each(function() {
                var tmpItem = $('<li>', { 'data-id': this.id });

                if (this.added) {
                    tmpItem.addClass('added');
                }

                tmpItem.append($('<img>', {src: this.image}))
                       .append($('<i>', {class: 'icon-plus'}))
                       .append($('<h3>', {text: this.track}))
                       .append($('<strong>', {text: this.artist}));

                $results.append(tmpItem);
            });
        } else {
                var tmpItem = $('<li>', { class: 'no-results', text: 'No results found' });

                $results.append(tmpItem);
        }

        $results.show();
    }


    // ****************************
    // PLAYLIST
    // ****************************    
    $('.show-playlist').on('click', function(e) {
        if (!$('body').hasClass('showing-playlist')) {
            socket.emit('tracklist.list');
        } else {
            $('body').removeClass('showing-playlist');
        }
    });

    $('#playlist').on('click', 'li.letter', function(e) {
        e.preventDefault();

        if ($(this).nextAll('.letter:first').length) {
            $('#playlist').animate({scrollTop: $('#playlist').scrollTop() + $(this).nextAll('.letter:first').position().top + 25}, 'fast');
        }
    });

    $('#playlist').on('click', 'li a.queue-add[data-id]', function(e) {
        e.preventDefault();

        socket.emit('playlist.queue', { id: $(this).data('id') });
    });


    function renderPlaylist(data) {
        var $playlist = $('#playlist ul').detach();
        $playlist.empty();
        $('#playlist').scrollTop(0);

        var playlist = [];
        for (var track in data) {
            playlist.push(data[track]);
        }

        playlist.sort(playlistSort);

        var lastTrackLetter,
            lastArtist,
            lastArtistLi;

        for (var trackID in playlist) {
            track = playlist[trackID];

            if (lastArtist != track.artist) {
                // Do we need to append the last artist list
                if (lastArtistLi) {
                    $playlist.append(lastArtistLi);
                }

                lastArtist = track.artist;
                lastArtistLi = null;

                if (lastTrackLetter !== track.artist.replace(/^the /i,"")[0].toUpperCase()) {
                    var li = $('<li>', {class: 'letter'});
                    li.append(track.artist[0].toUpperCase());
                    $playlist.append(li);

                    lastTrackLetter = track.artist.replace(/^the /i,"")[0];
                }
            }

            var li = $('<li>');
            var link = $('<a>', {href: 'https://www.youtube.co.uk/watch?v=' + track.youtube, class: 'play-youtube', target: '_blank'});
            link.append($('<i>', {class: 'icon-youtube'}));
            li.append(link);

            link = $('<a>', {href: '#', 'data-id': track.id, 'class': 'queue-add'});
            link.append($('<i>', {class: 'icon-plus'}));
            li.append(link);

            if ((playlist[parseInt(trackID)+1] && playlist[parseInt(trackID)+1].artist == track.artist) || (playlist[parseInt(trackID)-1] && playlist[parseInt(trackID)-1].artist == track.artist)) {
                li.append($('<strong>', {text: track.track}));

                if (!lastArtistLi) {
                    lastArtistLi = $('<li>').addClass('artist-list');
                    lastArtistLi.append(track.artist);
                }
                lastArtistLi.append(li);
            } else {
                li.append($('<strong>', {text: track.track})).append(' - ' + track.artist);
                $playlist.append(li);
            }

            if (!playlist[parseInt(trackID)+1]) {
                if (lastArtistLi) {
                    $playlist.append(lastArtistLi);
                }
            }
        }

        $('#playlist').append($playlist);
        $('body').addClass('showing-playlist');
    }

    function playlistSort(a, b) {
        var o1 = a.artist.replace(/^the /i,"").toLowerCase();
        var o2 = b.artist.replace(/^the /i,"").toLowerCase();

        var p1 = a.track.toLowerCase();
        var p2 = b.track.toLowerCase();

        if (o1 < o2) return -1;
        if (o1 > o2) return 1;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
        return 0;
    }


    // ****************************
    // LAST.FM
    // ****************************



    // ****************************
    // CONTROLS
    // ****************************    
    $('#controls .control').on('click', function(e) {
        $(this).removeClass('control-deactive').addClass('control-active');
        $(this).siblings('.control').removeClass('control-active').addClass('control-deactive');

        var action = 'dislike';
        if ($(this).hasClass('control--like')) {
            action = 'like';
        }

        var id = player.currentTrack.id;

        socket.emit('tracklist.rate', { action: action, id: id });
    });


    // ****************************
    // PLAYER
    // ****************************

    $('.toggle-mute').on('click', function(e) {
        if ($(this).hasClass('icon-volume-off')) {
            $(this).removeClass('icon-volume-off').addClass('icon-volume-on');
            player.player.volume = 1;
            player.player.play();
        } else {
            $(this).addClass('icon-volume-off').removeClass('icon-volume-on');
            player.player.volume = 0;
        }
        localStorage.setItem('volume', player.player.volume);
    });

    var Player = function() {
        var self = this;

        this.$player = $('audio');
        this.player = this.$player.get(0);

        this.$preloader = $('<audio>');
        this.preloader = this.$preloader.get(0);

        this.$progress = $('#details .progress');

        this.currentTrack;
        this.position = 0;

        // Mute player by default
        this.player.volume = 0;

        // Check if user has unmuted previously
        console.log(localStorage.getItem('volume'));
        if (localStorage.getItem('volume')) {
            this.player.volume = localStorage.getItem('volume');
            if (this.player.volume == 1) {
                $('.toggle-mute').removeClass('icon-volume-off').addClass('icon-volume-on');
            }
        }

        // Add event listeners
        this.$player.on('timeupdate', function() {
            var width = self.player.currentTime / self.player.duration * 100;
            self.$progress.width(width + '%');
        });

        this.$player.on('canplay', function() {
            console.log('ready');

            if (self.position) {
                console.log(self.position);
                self.player.currentTime = self.position;
                self.position = null;
            }
        });

        this.preloadNext = function(track) {
            // Create new player to preload
            self.$preloader = $('<audio>');
            self.preloader = self.$preloader.get(0);

            self.$preloader.attr('autoplay', false);
            self.$preloader.attr('preload', 'auto');
            self.$preloader.attr('src', baseURI + 'music/' + track.id + '.mp3');

            self.preloader.volume = 0;
            self.preloader.load();
            self.preloader.play();
        }

        this.play = function(track, position) {
            this.currentTrack = track;

            console.log('Playing song: ' + this.currentTrack.id);

            this.position = position;
            this.halfWay = false;

            this.$progress.width('0%');

            $('#details .track').text(this.currentTrack.track);
            $('#details .artist').text(this.currentTrack.artist);


            $('<img>', {src: this.currentTrack.image}).on('load', function() {
                $('#details img').attr('src', this.currentTrack.image);
            });

            // Remove current background
            $('body').attr('style', '');

            // Set page background
            var bg = '/images/' + this.currentTrack.artist.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.png';
                css = 'radial-gradient(ellipse at center, rgba(40,40,40,0.8) 0%,rgba(14,14,14,1) 100%), url("'+bg+'")';

            $('<img>', {src: bg}).on('load', function() {
                $('body').css({'background': css, 'background-size': 'cover', 'background-position': 'center'});
            });

            $('#container').fadeIn('slow');

            this.$player.attr('src', baseURI + 'music/' + this.currentTrack.id + '.mp3');
            this.player.load();
            this.player.play();

            this.newSong = true;
        }


        return this;
    }
    var player = Player();





});
