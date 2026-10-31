# Optional recordings

The game makes all of its sound with WebAudio (`web/audio.js`), so this folder can stay empty. To replace a synthesised
effect with a real recording, put the file here and list it in `sounds.json` (paths are relative to that file):

```json
{
  "sword":  ["sword1.ogg", "sword2.ogg"],
  "gas":    "gas_hiss.ogg",
  "chime":  { "files": ["bell.ogg"], "gain": 0.8, "rate": [0.98, 1.02] }
}
```

* A key is a voice id (see `Sound.voices` in the console, or the table in `docs/05-audio.md`). Several files = one is picked at random.
* `gain` scales the recording; `rate` is the random playback-rate range (pitch variation). Distance volume, panning, the
  per-voice rate limit and the voice cap still apply.
* Ids you leave out keep their synthesised sound. `{}` (the shipped file) means everything is synthesised.
* Files here are git-ignored on purpose. **Do not put Dungeon Keeper II audio in this repo**: it belongs to EA.
