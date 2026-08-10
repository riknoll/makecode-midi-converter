# MakeCode Midi Converter

A little webapp for converting midi files into MakeCode Arcade songs.

## Batch conversion CLI

In addition to the webapp, there is a CLI for converting many songs at once into
a MakeCode `.jres` asset file:

```sh
npm run convert -- <input-dir> [options]
```

The CLI recursively searches `<input-dir>` for subdirectories that contain MIDI
files. Each of those subdirectories is treated as a single song (all of the MIDI
files inside are merged into one song), and its name is expected to use the
format `songname_BPM`:

```
songs/
  overworld_120/
    melody.mid
    drums.mid
  boss_battle_170/
    boss.mid
```

The number after the final underscore is used as the tempo of the generated
song. If a directory name does not end in `_BPM`, the tempo stored in the MIDI
file is used instead and a warning is printed.

Tracks whose name mentions "drum" or "percussion", or that use MIDI channel 10
(the General MIDI percussion channel), are routed to the MakeCode drum track.
All other tracks are assigned a MakeCode instrument based on their name.

### Output

Two files are written:

- `images.g.jres` — the song assets, one jres entry per song directory (the song
  bytes are stored base64 encoded)
- `images.g.ts` — the companion auto-generated code that registers the songs

Copy both into a MakeCode Arcade project and add them to the `files` list in
`pxt.json`. The songs will then show up in the asset explorer, and can be
referenced by name in code:

```ts
music.play(assets.song`overworld`, music.PlaybackMode.UntilDone)
```

### Options

| Option | Description |
| --- | --- |
| `-o, --out <path>` | Output `.jres` path (default: `./images.g.jres`) |
| `--ts <path>` | Output `.g.ts` path (default: alongside the `.jres`) |
| `--no-ts` | Skip emitting the companion `.g.ts` file |
| `--transpose <n>` | Octaves to transpose melodic tracks (default: `-3`) |
| `--drum-transpose <n>` | Octaves to transpose drum tracks (default: `-2`) |
| `--bpm <n>` | Force this tempo for every song, ignoring the directory names |
| `--namespace <name>` | Namespace for the generated songs (default: `mySongs`) |
| `-q, --quiet` | Only print errors |
| `-h, --help` | Show usage |

For example:

```sh
npm run convert -- ./songs -o ./out/images.g.jres --transpose -2
```
