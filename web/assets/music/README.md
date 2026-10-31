# Background music

`beneath_the_sunken_hall.mp3` (about 2 min 49 s, 4 MB) is the game's background track. It was supplied by the project owner, who is
responsible for having the right to publish it; replace the file (keeping the name) or change `TRACK_URL` in `web/audio.js` to use another one.
`web/audio.js` loops it seamlessly on the music bus, opens a lowpass filter a little as tension rises, and dips it under the victory and defeat
stings. If the file cannot be loaded the game falls back to the synthesised adaptive score.

**Do not put Dungeon Keeper II audio here**: it belongs to EA (the Pages workflow refuses `.sdt` files).
