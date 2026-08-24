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

### Output formats

Two files are always written: a `.jres` containing the song assets (one entry
per song directory) and a companion `.ts`. Use `--format` to choose how they are
generated.

#### `--format project` (default)

For dropping into a MakeCode Arcade project. The jres stores the song data as
hex, and the companion TypeScript registers the songs with
`helpers._registerFactory`, which is what the MakeCode editor itself emits.
Defaults to writing `images.g.jres` and `images.g.ts`.

Add both files to the `files` list in `pxt.json`. The songs will then show up in
the asset explorer, and can be referenced by name in code:

```ts
music.play(assets.song`overworld`, music.PlaybackMode.UntilDone)
```

#### `--format library`

For shipping songs in a MakeCode extension. The jres stores the song data as
base64 under a single namespace, and the companion TypeScript declares each song
as an exported `fixedInstance` constant with an empty `hex` literal that the
compiler fills in from the jres. Defaults to writing `music.jres` and
`music.ts`, using the `sprites.songs` namespace:

```ts
namespace sprites.songs {
    //% fixedInstance jres blockIdentity=music._song
    //% tags="song" whenUsed
    export const overworld = music.createSong(hex``)
}
```

Songs are then referenced directly as `sprites.songs.overworld`.

### Options

| Option | Description |
| --- | --- |
| `-f, --format <name>` | Output format: `project` or `library` (default: `project`) |
| `-o, --out <path>` | Output `.jres` path (default: `./images.g.jres`, or `./music.jres` for `library`) |
| `--ts <path>` | Output `.ts` path (default: alongside the `.jres`) |
| `--no-ts` | Skip emitting the companion `.ts` file |
| `--transpose <n>` | Octaves to transpose melodic tracks (default: `-3`) |
| `--drum-transpose <n>` | Octaves to transpose drum tracks (default: `-2`) |
| `--bpm <n>` | Force this tempo for every song, ignoring the directory names |
| `--ticks-per-beat <n>` | Output timing resolution (default: `8`, range: `1`-`255`) |
| `--double-resolution` | Double note timing, measures, and BPM without changing ticks per beat |
| `--quantize` | Merge notes starting on the same tick using their average duration, then truncate overlaps |
| `--truncate <n>` | Truncate each output song after the specified number of measures |
| `--namespace <name>` | Namespace for the generated songs (default: `mySongs`, or `sprites.songs` for `library`) |
| `-q, --quiet` | Only print errors |
| `-h, --help` | Show usage |

For example:

```sh
npm run convert -- ./songs -o ./out/images.g.jres --transpose -2
npm run convert -- ./songs --format library --namespace sprites.myTunes
```
