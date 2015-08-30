$(function() {
    var baseURI = '/',
        socket  = io();



    // ****************************
    // TEMPLATES
    // ****************************
    var tmplSearchResuls = '<ul class="search-results">\
                                {{#each .}}\
                                    <li data-id="{{ id }}">\
                                    <img src="{{ image }}">\
                                    <i class="icon-plus"></i>\
                                    <h3>{{ track }}</h3>\
                                    <strong>{{ artist }}</strong></li>\
                                {{else}}\
                                    <li class="no-results">No search results</li>\
                                {{/each}}\
                            </ul>';
    tmplSearchResuls = Handlebars.compile(tmplSearchResuls);

    var tmplTrackList = '   {{#each .}}\
                                <li class="letter">{{ @key }}</li>\
                                {{#each .}}\
                                    <li>\
                                        <a href="https://www.youtube.co.uk/watch?v={{ youtube }}" class="play-youtube" target="_blank">\
                                            <i class="icon-youtube"></i>\
                                        </a>\
                                        <a href="#" data-id="{{ id }}" class="queue-add">\
                                            <i class="icon-plus"></i>\
                                        </a>\
                                        <strong>{{ track }}</strong> - {{ artist }}</li>\
                                {{/each}}\
                            {{/each}}';
    tmplTrackList = Handlebars.compile(tmplTrackList);


    // ****************************
    // SOCKETS
    // ****************************
    socket.on('tracklist.add', function(data) {
        $('#debug').prepend('New track added: ' + data.track + ' - ' + data.artist + "<br/>");
    });

    socket.on('playlist.play', function(data) {
        $('#debug').prepend('Currently playing: ' + data.track.track + ' by ' + data.track.artist + ' - ' + data.position + "<br/>");
        player.play(data.track, data.position);
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

    var tracklist;
    socket.on('tracklist.list', function(data) {
        tracklist = data;
        renderTracklist(data);
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
            $('#search .search-results').remove();
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
        var $results = tmplSearchResuls(data);
        $('#search').append($results).show();
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

    $('#playlist .tracklist-search i').on('click', function(e) {
        e.preventDefault();
        $('#playlist').toggleClass('show-search');

        if (!$('#playlist').hasClass('show-search')) {
            renderTracklist(tracklist);
        }
    });

    $('#playlist .tracklist-search input').on('keyup', function() {
        var q = $(this).val().toLowerCase();

        if (!q) {
            renderTracklist(tracklist);
            return;
        }

        // Loop tracklist and build new list of results
        var results = [];
        for (var trackID in tracklist) {
            track = tracklist[trackID];

            if (track.track.toLowerCase().indexOf(q) != -1 || track.artist.toLowerCase().indexOf(q) != -1) {
                results.push(track);
            }
        }

        renderTracklist(results);
    });

    function renderTracklist(data) {
        // Build and sort basic tracklist
        var tracks = [];
        for (var track in data) {
            tracks.push(data[track]);
        }
        tracks.sort(playlistSort);

        var tracklist = {};
        for (var trackID in tracks) {
            track = tracks[trackID];

            var letter = track.artist.replace(/^the /i,"")[0].toUpperCase();

            if (!(letter in tracklist)) {
                tracklist[letter] = [];
            }
            tracklist[letter].push(track);
        }

        $('#playlist ul').html(tmplTrackList(tracklist));
        $('#playlist').scrollTop(0);

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
            if (self.position) {
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

            this.position = position;
            this.halfWay = false;

            this.$progress.width('0%');

            $('#details .track').text(this.currentTrack.track);
            $('#details .artist').text(this.currentTrack.artist);


            // Remove current album art
            $('#details img').attr('src', '');
            $('<img>', {src: this.currentTrack.image}).on('load', function() {
                $('#details img').attr('src', self.currentTrack.image);
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
