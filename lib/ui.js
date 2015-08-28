var blessed = require('blessed');

var UI = function(socket) {
    this.elements = [];

    this.colors = {'main': {'fg': 'white', 'bg': 'black'}, 'highlight': {'fg': 'black', 'bg': 'white'}};

    // Create a screen object.
    this.screen = blessed.screen({
      smartCSR: true
    });

    this.screen.title = 'Grooveshare';

    this.renderLayout();

    // Quit on Escape, q, or Control-C.
    this.screen.key(['q'], function(ch, key) {
      return process.exit(0);
    });

    // Render the screen.
    this.screen.render();
}

UI.prototype.renderLayout = function() {
    var self = this;

    // Footer
    this.elements['nowPlaying'] = blessed.Box({
        content: ' {bold}Catepillar Song{/bold} - Dead Cannons [01:20/03:42]',
        tags: true,
        align: 'left',
        valign: 'top',
        width: '100%',
        height: '5%',
        bottom: 0,
        left: 0,
        style: {
            bg: this.colors.highlight.bg,
            fg: this.colors.highlight.fg
        }
    });
    this.screen.append(this.elements['nowPlaying']);


    // Left column song library
    this.elements['main'] = blessed.Box({
      border: {
        type: 'line'
      },
      label: ' Library ',
      align: 'left',
      valign: 'top',
      width: '70%',
      height: '98%',
      top: 0,
      left: 0
    });
    this.screen.append(this.elements['main']);

    // Library track list
    this.elements['library'] = blessed.ListTable({
        top: 0,
        left: 1,
        width: '95%',
        height: '90%',
        keys: true,
        interactive: true,
        invertSelected: false,
        data: [
            [ 'Track', 'Artist', 'Played', 'Rating' ]
        ],
        align: 'left',
        valign: 'top',
        style: {
            bg: this.colors.main.bg,
            fg: this.colors.main.fg,
            header: {
                bold: true
            },
            cell: {
                selected: {
                    bg: this.colors.highlight.bg,
                    fg: this.colors.highlight.fg
                }
            }
        }
    });
    this.elements['main'].append(this.elements['library']);
    this.elements['library'].focus();

    this.elements['library'].on('select', function(e, index) {
        self.showTrackOptions(index);
    });



    // Right column queue
    this.elements['sidebar'] = blessed.Box({
        border: {
            type: 'line'
        },
        label: ' Queue ',
        align: 'left',
        valign: 'top',
        width: '30%',
        height: '98%',
        top: 0,
        left: '71%'
    });
    this.screen.append(this.elements['sidebar']);


    // Render the screen.
    this.screen.render();
}

UI.prototype.renderTracks = function(library) {
    var tracks = [];
    tracks.push([ 'Track', 'Artist', 'Played', 'Rating' ]);

    var libraryLength = library.length;
    for (n = 0; n < libraryLength; n++) {
        var t = library[n].track;
        if (t.length > 16) {
            t = t.substr(0, 14) + '..';
        }

        var a = library[n].artist;
        if (a.length > 12) {
            a = a.substr(0, 10) + '..';
        }

        tracks.push([ t, a, 'N/A', '+0 -0' ]);
    }

    this.elements['main'].setLabel(' Library ['+libraryLength+'] ');

    this.elements['library'].setData(tracks);
    this.screen.render();
}

UI.prototype.showTrackOptions = function(id) {
    var self = this;

    this.elements['nowPlaying'] = blessed.Box({
        content: ' {bold}Catepillar Song{/bold} - Dead Cannons [01:20/03:42]',
        tags: true,
        align: 'left',
        valign: 'top',
        width: '100%',
        height: '5%',
        bottom: 0,
        left: 0,
        style: {
            bg: this.colors.highlight.bg,
            fg: this.colors.highlight.fg
        }
    });

    this.elements['trackOptions'] = blessed.List({
        border: 'line',
        height: 'half',
        width: 'half',
        top: 'center',
        left: 'center',
        items : ['Queue', 'Redownload', 'Change source', 'Delete'],
        keys: true,
        style: {
            bg: this.colors.main.bg,
            fg: this.colors.main.fg,
            selected: {
                bg: this.colors.highlight.bg,
                fg: this.colors.highlight.fg
            }
        }
    });
    this.screen.append(this.elements['trackOptions']);
    this.elements['trackOptions'].focus();

    this.elements['trackOptions'].on('select', function(e, index) {
        if (index == 3) {
            global.library.deleteSong(id);
        }

        self.screen.remove(self.elements['trackOptions']);
        self.screen.render();
    });

    this.screen.render();
}



module.exports = UI;