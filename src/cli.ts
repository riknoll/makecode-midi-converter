import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
    buildMakeCodeSongHex,
    checkNameForPreset,
    DEFAULT_TICKS_PER_BEAT,
    guessInstrumentPreset,
    isLikelyDrumTrack,
    MAX_TICKS_PER_BEAT,
    mergeParsedMidi,
    parseMidiData,
    setSongLogger,
    type MidiTrackSummary,
    type ParsedMidiSummary,
} from './lib/makecodeSong'

const MIDI_EXTENSIONS = new Set(['.mid', '.midi', '.smf'])
const SONG_MIME_TYPE = 'application/mkcd-song'
const IMAGE_MIME_TYPE = 'image/x-mkcd-f4'
const IMAGES_NAMESPACE = 'myImages'
const SONG_NAMESPACE = 'mySongs'
const LIBRARY_NAMESPACE = 'sprites.songs'
const FORMATS = ['project', 'library'] as const

type Format = (typeof FORMATS)[number]

type SongEntry = {
    id: string
    displayName: string
    /** The song bytes as hex. Project jres files store this as-is; library jres files base64 it. */
    hex: string
}

type SongDirectory = {
    path: string
    name: string
    beatsPerMinute: number | null
    midiFiles: string[]
}

const HELP = `Usage: npm run convert -- <input-dir> [options]

Recursively searches <input-dir> for subdirectories containing MIDI files. Each
such subdirectory is treated as a single song, and its name is expected to use
the format "songname_BPM" (for example "boss_battle_140"). The BPM suffix is
used as the tempo of the generated song; if it is missing, the tempo stored in
the MIDI file is used instead.

Formats:
  project   For a MakeCode project. The jres stores the song data as hex and
            the companion TypeScript registers the songs with
            helpers._registerFactory. Defaults to images.g.jres/images.g.ts.
  library   For a MakeCode extension. The jres stores the song data as base64
            and the companion TypeScript declares each song as an exported
            fixedInstance constant. Defaults to music.jres/music.ts.

Options:
  -f, --format <name>       Output format: ${FORMATS.join(' | ')} (default: project)
  -o, --out <path>          Output .jres path (default: depends on the format)
      --ts <path>           Output .ts path (default: alongside the .jres)
      --no-ts               Skip emitting the companion .ts file
      --transpose <n>       Octaves to transpose melodic tracks (default: -3)
      --drum-transpose <n>  Octaves to transpose drum tracks (default: -2)
      --bpm <n>             Force this tempo for every song
      --ticks-per-beat <n>  Output timing resolution (default: ${DEFAULT_TICKS_PER_BEAT})
      --namespace <name>    Namespace for the generated songs
                            (default: ${SONG_NAMESPACE} for project, sprites.songs for library)
  -q, --quiet               Only print errors
  -h, --help                Show this message
`

const NUMERIC_FLAGS = ['transpose', 'drum-transpose', 'bpm', 'ticks-per-beat']

/**
 * parseArgs refuses to treat a leading-dash token as an option argument, so
 * rewrite "--transpose -3" into "--transpose=-3" before parsing.
 */
const normalizeNegativeNumbers = (args: string[]) => {
    const normalized: string[] = []

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        const flag = /^--([a-z-]+)$/.exec(arg)?.[1]
        const next = args[i + 1]

        if (flag && NUMERIC_FLAGS.includes(flag) && next !== undefined && /^-\d/.test(next)) {
            normalized.push(`${arg}=${next}`)
            i += 1
            continue
        }
        normalized.push(arg)
    }

    return normalized
}

const parseOptions = () => {
    const { values, positionals } = parseArgs({
        args: normalizeNegativeNumbers(process.argv.slice(2)),
        allowPositionals: true,
        options: {
            format: { type: 'string', short: 'f' },
            out: { type: 'string', short: 'o' },
            ts: { type: 'string' },
            'no-ts': { type: 'boolean', default: false },
            transpose: { type: 'string' },
            'drum-transpose': { type: 'string' },
            bpm: { type: 'string' },
            'ticks-per-beat': { type: 'string' },
            namespace: { type: 'string' },
            quiet: { type: 'boolean', short: 'q', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    })

    if (values.help || !positionals.length) {
        process.stdout.write(HELP)
        process.exit(values.help ? 0 : 1)
    }

    if (positionals.length > 1) {
        throw new Error(`Expected a single input directory but received ${positionals.length}.`)
    }

    const format = (values.format || 'project') as Format
    if (!FORMATS.includes(format)) {
        throw new Error(`Unknown format "${values.format}". Expected one of: ${FORMATS.join(', ')}.`)
    }

    const isLibrary = format === 'library'
    const jresPath = resolve(values.out || (isLibrary ? 'music.jres' : 'images.g.jres'))

    return {
        format,
        inputDir: resolve(positionals[0]),
        jresPath,
        tsPath: values['no-ts'] ? null : resolve(values.ts || defaultTsPath(jresPath)),
        transposeOctaves: parseNumber(values.transpose, 'transpose') ?? -3,
        drumTransposeOctaves: parseNumber(values['drum-transpose'], 'drum-transpose') ?? -2,
        beatsPerMinute: parseNumber(values.bpm, 'bpm'),
        ticksPerBeat: parseTicksPerBeat(values['ticks-per-beat']),
        namespace: values.namespace || (isLibrary ? LIBRARY_NAMESPACE : SONG_NAMESPACE),
        quiet: values.quiet,
    }
}

const defaultTsPath = (jresPath: string) => {
    const name = basename(jresPath).replace(/\.jres$/i, '')
    return join(dirname(jresPath), `${name}.ts`)
}

const parseNumber = (value: string | undefined, flag: string) => {
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
        throw new Error(`Expected a number for --${flag} but received "${value}".`)
    }
    return parsed
}

const parseTicksPerBeat = (value: string | undefined) => {
    if (value === undefined) return DEFAULT_TICKS_PER_BEAT
    const parsed = parseNumber(value, 'ticks-per-beat')!
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TICKS_PER_BEAT) {
        throw new Error(`Expected --ticks-per-beat to be an integer from 1 to ${MAX_TICKS_PER_BEAT}.`)
    }
    return parsed
}

const isMidiFile = (fileName: string) => MIDI_EXTENSIONS.has(extname(fileName).toLowerCase())

/**
 * Song directories are named "songname_BPM". Everything after the final
 * underscore is treated as the tempo when it parses as a positive integer.
 */
const parseSongDirectoryName = (directoryName: string) => {
    const match = /^(.*)_(\d+)$/.exec(directoryName)
    if (!match || !match[1]) {
        return { name: directoryName, beatsPerMinute: null }
    }
    const beatsPerMinute = Number(match[2])
    return {
        name: match[1],
        beatsPerMinute: beatsPerMinute > 0 ? beatsPerMinute : null,
    }
}

const findSongDirectories = async (root: string): Promise<SongDirectory[]> => {
    const found: SongDirectory[] = []

    const walk = async (directory: string) => {
        const entries = await readdir(directory, { withFileTypes: true })

        const midiFiles = entries
            .filter((entry) => entry.isFile() && isMidiFile(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b))

        if (midiFiles.length) {
            found.push({
                path: directory,
                ...parseSongDirectoryName(basename(directory)),
                midiFiles,
            })
        }

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                await walk(join(directory, entry.name))
            }
        }
    }

    await walk(root)
    return found.sort((a, b) => a.path.localeCompare(b.path))
}

const parseSongDirectory = async (song: SongDirectory): Promise<ParsedMidiSummary> => {
    const parsedFiles = []
    for (const fileName of song.midiFiles) {
        const data = await readFile(join(song.path, fileName))
        parsedFiles.push(parseMidiData(data, fileName))
    }
    return mergeParsedMidi(parsedFiles)
}

const assignInstruments = (tracks: MidiTrackSummary[]) => {
    const instrumentAssignments: Record<number, string> = {}
    const drumTrackIds = new Set<number>()

    let melodicIndex = 0
    for (const track of tracks) {
        if (isLikelyDrumTrack(track)) {
            drumTrackIds.add(track.id)
            continue
        }
        const filePreset = checkNameForPreset(track.sourceFileName.split("_").pop()!);
        if (filePreset !== null) {
            instrumentAssignments[track.id] = filePreset
        }
        else {
            instrumentAssignments[track.id] = guessInstrumentPreset(track.sourceTrackName, melodicIndex)
        }
        melodicIndex += 1
    }

    return { instrumentAssignments, drumTrackIds }
}

/** jres ids must be valid TypeScript identifiers because they become factory keys */
const toJResId = (name: string) => {
    const id = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_')
    return id || 'song'
}

const uniqueName = (name: string, taken: Set<string>) => {
    let candidate = name
    let suffix = 2
    while (taken.has(candidate)) {
        candidate = `${name}_${suffix}`
        suffix += 1
    }
    taken.add(candidate)
    return candidate
}

/** Project jres files keep the song data as hex, matching what the MakeCode editor writes */
const buildProjectJRes = (songs: SongEntry[], namespace: string) => {
    const entries: Record<string, unknown> = {}

    for (const song of songs) {
        entries[song.id] = {
            data: song.hex,
            mimeType: SONG_MIME_TYPE,
            displayName: song.displayName,
            namespace: `${namespace}.`,
        }
    }

    entries['*'] = {
        mimeType: IMAGE_MIME_TYPE,
        dataEncoding: 'base64',
        namespace: IMAGES_NAMESPACE,
    }

    return JSON.stringify(entries, null, 4) + '\n'
}

/** Library jres files base64 encode the song bytes and share a single namespace */
const buildLibraryJRes = (songs: SongEntry[], namespace: string) => {
    const entries: Record<string, unknown> = {
        '*': {
            namespace,
            mimeType: IMAGE_MIME_TYPE,
            dataEncoding: 'base64',
        },
    }

    for (const song of songs) {
        entries[song.id] = {
            data: Buffer.from(song.hex, 'hex').toString('base64'),
            mimeType: SONG_MIME_TYPE,
            ...(song.displayName === song.id ? {} : { displayName: song.displayName }),
        }
    }

    return JSON.stringify(entries, null, 4) + '\n'
}

const emitFactoryHelper = (factoryKind: string, entries: { keys: string[]; expression: string }[]) => {
    const indent = '    '
    return (
        '\n' +
        `${indent}helpers._registerFactory("${factoryKind}", function(name: string) {\n` +
        `${indent}${indent}switch(helpers.stringTrim(name)) {\n` +
        entries
            .map(
                (entry) =>
                    entry.keys
                        .filter((key) => !!key)
                        .map((key) => `${indent}${indent}${indent}case "${key}":`)
                        .join('\n') + `return ${entry.expression};`,
            )
            .join('\n') +
        '\n' +
        `${indent}${indent}}\n` +
        `${indent}${indent}return null;\n` +
        `${indent}})\n`
    )
}

const buildProjectImagesTs = (songs: SongEntry[]) => {
    const songEntries = songs.map((song) => ({
        keys: [...new Set([song.id, song.displayName])],
        expression: `hex\`${song.hex}\``,
    }))

    const warning = 'Auto-generated code. Do not edit.'
    const body =
        emitFactoryHelper('image', []) +
        emitFactoryHelper('animation', []) +
        emitFactoryHelper('song', songEntries) +
        emitFactoryHelper('json', [])

    return `// ${warning}\nnamespace ${IMAGES_NAMESPACE} {\n${body}\n}\n// ${warning}\n`
}

/**
 * Library songs are declared as fixedInstance constants with empty hex literals;
 * the compiler fills in the data from the matching jres entry.
 */
const buildLibraryTs = (songs: SongEntry[], namespace: string) => {
    const body = songs
        .map(
            (song) =>
                `    //% fixedInstance jres blockIdentity=music._song\n` +
                `    //% tags="song" whenUsed\n` +
                `    export const ${song.id} = music.createSong(hex\`\`)\n`,
        )
        .join('\n')

    return `namespace ${namespace} {\n${body}}\n`
}

const main = async () => {
    const options = parseOptions()
    const log = options.quiet ? () => {} : (message: string) => process.stdout.write(`${message}\n`)
    const warn = (message: string) => process.stderr.write(`${message}\n`)

    // The library logs per-track diagnostics; keep them out of the way unless something is wrong
    setSongLogger({ log: () => {}, warn })

    const songDirectories = await findSongDirectories(options.inputDir)
    if (!songDirectories.length) {
        throw new Error(`No directories containing MIDI files were found under ${options.inputDir}.`)
    }

    const songEntries: SongEntry[] = []
    const takenIds = new Set<string>()
    const takenDisplayNames = new Set<string>()
    let failures = 0

    for (const song of songDirectories) {
        try {
            const parsed = await parseSongDirectory(song)
            const { instrumentAssignments, drumTrackIds } = assignInstruments(parsed.tracks)

            if (options.beatsPerMinute === undefined && song.beatsPerMinute === null) {
                warn(
                    `Warning: "${basename(song.path)}" does not end in _BPM; using ${parsed.beatsPerMinute} BPM from the MIDI file.`,
                )
            }

            const hex = buildMakeCodeSongHex(parsed, instrumentAssignments, {
                transposeOctaves: options.transposeOctaves,
                drumTransposeOctaves: options.drumTransposeOctaves,
                drumTrackIds,
                beatsPerMinute: options.beatsPerMinute ?? song.beatsPerMinute ?? parsed.beatsPerMinute,
                ticksPerBeat: options.ticksPerBeat,
            })

            songEntries.push({
                id: uniqueName(toJResId(song.name), takenIds),
                displayName: uniqueName(song.name, takenDisplayNames),
                hex,
            })

            log(
                `${song.name}: ${song.midiFiles.length} file(s), ${parsed.tracks.length} track(s), ` +
                    `${drumTrackIds.size} drum track(s), ${options.beatsPerMinute ?? song.beatsPerMinute ?? parsed.beatsPerMinute} BPM`,
            )
        } catch (caught) {
            failures += 1
            const message = caught instanceof Error ? caught.message : String(caught)
            warn(`Failed to convert ${song.path}: ${message}`)
        }
    }

    if (!songEntries.length) {
        throw new Error('No songs were converted.')
    }

    const isLibrary = options.format === 'library'

    await mkdir(dirname(options.jresPath), { recursive: true })
    await writeFile(
        options.jresPath,
        isLibrary
            ? buildLibraryJRes(songEntries, options.namespace)
            : buildProjectJRes(songEntries, options.namespace),
    )
    log(`Wrote ${songEntries.length} song(s) to ${options.jresPath} (${options.format} format)`)

    if (options.tsPath) {
        await mkdir(dirname(options.tsPath), { recursive: true })
        await writeFile(
            options.tsPath,
            isLibrary ? buildLibraryTs(songEntries, options.namespace) : buildProjectImagesTs(songEntries),
        )
        log(`Wrote ${options.tsPath}`)
    }

    if (failures) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
})
