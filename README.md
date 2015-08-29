# Grooveshare
An experimental collaborative listening experience - Personal use only, not for public use!

# Install

1. ```cp config/example.json config/default.json```
2. Enter API keys into ```config/default.json```
3. ```mkdir music images```
4. ```sudo apt-get install ffmpeg```
5. ```npm install```
6. Need to add at least one song into the database before it will run.
	- **BUG**: admin.js does not create the database. **Fix**: run app.js wait for it to crash when it can't find any songs then add the song with admin.js.
6. ```nodejs admin.js add  'BooBest - The Boo Radleys'```
7. Update 'baseURI' in `js/main.js' to point to your domain.
	- On localhost it would be ```http://localhost:6872/```
8. ```nodejs app.js``` 
9. Navigate your browser to <http://localhost:6872>
