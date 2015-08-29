# Configuration

'''example.json''' contains the example configuration file. Rename to '''default.json''' to be used by default, or export the variable.

You can have multiple configuration files.

    cp config/example.json config/live.json
    export NODE_ENV=live
    node app.js

This will now start the application using the live config file.