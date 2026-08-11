import * as MidiModule from '@tonejs/midi'
import type { Midi as MidiType } from '@tonejs/midi'

import { type Song, type Instrument, type NoteEvent, getEmptySong, encodeSongToHex, type Track } from "./pxt"

// Bundlers resolve @tonejs/midi to its ESM build (named exports), while node resolves
// the UMD build, where everything hangs off the CommonJS default export.
const MidiCtor: typeof MidiType =
    (MidiModule as unknown as { Midi?: typeof MidiType }).Midi ??
    (MidiModule as unknown as { default: { Midi: typeof MidiType } }).default.Midi


export type MidiTrackSummary = {
    id: number
    name: string
    /** The track name from the MIDI file, before any merge-time renaming */
    sourceTrackName: string
    sourceFileName: string
    sourcePpq: number
    noteCount: number
    channel: number | null
    minMidiNote: number
    maxMidiNote: number
    notes: NoteEvent[]
}

type BuildSongOptions = {
    transposeOctaves?: number
    drumTransposeOctaves?: number
    drumTrackIds?: ReadonlySet<number>
    beatsPerMinute?: number
    ticksPerBeat?: number
}

export type ParsedMidiSummary = {
    fileNames: string[]
    beatsPerMinute: number
    beatsPerMeasure: number
    tracks: MidiTrackSummary[]
}

export type InstrumentPreset = {
    id: string
    makecodeTrackId: number
    label: string
    instrument: Instrument
}

export const MAKECODE_INSTRUMENT_PRESETS: InstrumentPreset[] = getEmptySong(4).tracks.map(track => ({
    id: track.name!,
    makecodeTrackId: track.id,
    label: track.name!,
    instrument: track.instrument!
}))

export const DEFAULT_TICKS_PER_BEAT = 8
export const MAX_TICKS_PER_BEAT = 255

const presetById = new Map(MAKECODE_INSTRUMENT_PRESETS.map((preset) => [preset.id, preset]))

// Presets that correspond to melodic (non-drum) tracks only
export const MAKECODE_MELODIC_INSTRUMENT_PRESETS = MAKECODE_INSTRUMENT_PRESETS.filter(p => {
    const track = getEmptySong(1).tracks.find(t => t.id === p.makecodeTrackId)
    return !track?.drums
})

export type SongLogger = {
    log: (message: string) => void
    warn: (message: string) => void
}

let logger: SongLogger = {
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
}

// Allows non-browser hosts (e.g. the CLI) to silence or redirect diagnostics
export const setSongLogger = (next: SongLogger) => {
    logger = next
}

export const parseMidi = async (file: File): Promise<ParsedMidiSummary> => {
    const arrayBuffer = await file.arrayBuffer()
    return parseMidiData(arrayBuffer, file.name)
}

export const parseMidiData = (data: ArrayBuffer | Uint8Array, fileName: string): ParsedMidiSummary => {
    const midi = new MidiCtor(data instanceof Uint8Array ? data : new Uint8Array(data))

    const beatsPerMinute = Math.max(1, Math.round(midi.header.tempos[0]?.bpm || 120))
    const beatsPerMeasure = Math.min(Math.max(midi.header.timeSignatures[0]?.timeSignature?.[0] || 4, 1), 12)
    const ppq = midi.header.ppq || 480

    const tracks = midi.tracks.reduce<MidiTrackSummary[]>((result, track, index) => {
        if (!track.notes.length) return result

        const midiNotes = track.notes.map((note) => note.midi)
        const channel: number | null = typeof track.channel === 'number' ? track.channel : null
        const trackName = track.name?.trim() || `Track ${index + 1}`

        result.push({
            id: index,
            name: trackName,
            sourceTrackName: trackName,
            sourceFileName: fileName,
            sourcePpq: ppq,
            noteCount: track.notes.length,
            channel,
            minMidiNote: Math.min(...midiNotes),
            maxMidiNote: Math.max(...midiNotes),
            notes: extractNoteEvents(midi, index, false),
        })

        return result
    }, [])

    if (!tracks.length) {
        throw new Error('No note data found in this MIDI file.')
    }

    return {
        fileNames: [fileName],
        beatsPerMinute,
        beatsPerMeasure,
        tracks,
    }
}

export const parseMidiFiles = async (files: File[]): Promise<ParsedMidiSummary> => {
    if (!files.length) {
        throw new Error('Select at least one MIDI file.')
    }

    return mergeParsedMidi(await Promise.all(files.map((file) => parseMidi(file))))
}

export const mergeParsedMidi = (parsedFiles: ParsedMidiSummary[]): ParsedMidiSummary => {
    if (!parsedFiles.length) {
        throw new Error('Select at least one MIDI file.')
    }

    const first = parsedFiles[0]
    let nextTrackId = 0

    const mergedTracks = parsedFiles.flatMap((parsed) => {
        const hasMultipleTracks = parsed.tracks.length > 1;

        return parsed.tracks.map((track, index) => {
            const displayName = hasMultipleTracks ? `${track.sourceFileName} - ${index}` : track.sourceFileName;
            const mergedTrack: MidiTrackSummary = {
                ...track,
                id: nextTrackId,
                name: displayName,
            }
            nextTrackId += 1
            return mergedTrack
        })
    })

    return {
        fileNames: parsedFiles.flatMap((parsed) => parsed.fileNames),
        beatsPerMinute: first.beatsPerMinute,
        beatsPerMeasure: first.beatsPerMeasure,
        tracks: mergedTracks,
    }
}

export const extractNoteEvents = (midi: MidiType, trackIndex: number, isDrumTrack: boolean) => {
    const makecodeEvents: NoteEvent[] = [];
    const track = midi.tracks[trackIndex];
    if (!track) {
        throw new Error(`Track index ${trackIndex} out of bounds for MIDI with ${midi.tracks.length} tracks`);
    }

    for (const event of track.notes) {
        const startTick = event.ticks;
        const endTick = startTick + event.durationTicks;

        const spelling = isDrumTrack ? "normal" : (isBlackKey(event.midi) ? "sharp" : "normal");

        const velocity = event.velocity !== undefined ? Math.round(event.velocity * 127) : undefined;

        makecodeEvents.push({
            notes: [
                {
                    note: isDrumTrack ? event.midi : event.midi + 1,
                    enharmonicSpelling: spelling
                }
            ],
            startTick: startTick,
            endTick: endTick,
            velocity: velocity
        });
    }

    logger.log(`Generated ${makecodeEvents.length} makecode events for track`);
    for (const event of makecodeEvents) {
        if (makecodeEvents.some(e => {
            if (e === event) return false;

            if ((e.startTick >= event.startTick && e.startTick < event.endTick) || (e.endTick > event.startTick && e.endTick <= event.endTick)) {
                return true;
            }

            return false;
        })) {
            logger.warn(`Event with notes ${event.notes.map(n => n.note).join(', ')} from tick ${event.startTick} to ${event.endTick} overlaps with another event`);
        }
    }

    return makecodeEvents;
}

const remapDrumNotes = (events: NoteEvent[], drumTransposeOctaves: number, numDrums: number): NoteEvent[] => {
    const semitones = drumTransposeOctaves * 12
    return events.map(event => ({
        ...event,
        notes: event.notes.map(note => {
            const rawMidi = note.note
            const transposed = rawMidi + semitones
            const drumIndex = ((transposed % numDrums) + numDrums) % numDrums
            return { ...note, note: drumIndex, enharmonicSpelling: "normal" }
        })
    }))
}

const transposeNoteEvents = (events: NoteEvent[], octaves: number): NoteEvent[] => {
    const semitones = octaves * 12;
    return events.map(event => ({
        ...event,
        notes: event.notes.map(note => ({
            ...note,
            note: note.note + semitones
        }))
    }));
}

const scaleTiming = (events: NoteEvent[], sourcePPQ: number, targetPPQ: number): NoteEvent[] => {
    const scale = targetPPQ / sourcePPQ;
    const scaled = events.map(event => {
        const startTick = Math.round(event.startTick * scale);
        const endTick = Math.max(Math.round(event.endTick * scale), startTick + 1);
        return {
            ...event,
            startTick,
            endTick
        };
    });

    const deduped: NoteEvent[] = [];
    for (const event of scaled) {
        const existing = deduped.find(e => e.startTick === event.startTick && e.endTick === event.endTick);
        if (existing) {
            existing.notes.push(...event.notes);
        } else {
            deduped.push(event);
        }
    }

    return deduped;
}

export const buildMakeCodeSong = (
    parsed: ParsedMidiSummary,
    instrumentAssignments: Record<number, string>,
    options: BuildSongOptions = {},
): Song => {
    const ticksPerBeat = options.ticksPerBeat ?? DEFAULT_TICKS_PER_BEAT
    if (!Number.isInteger(ticksPerBeat) || ticksPerBeat < 1 || ticksPerBeat > MAX_TICKS_PER_BEAT) {
        throw new Error(`Ticks per beat must be an integer from 1 to ${MAX_TICKS_PER_BEAT}.`)
    }
    const transposeOctaves = options.transposeOctaves || 0
    const drumTransposeOctaves = options.drumTransposeOctaves || 0
    const drumTrackIds = options.drumTrackIds ?? new Set<number>()
    const beatsPerMinute = Math.max(1, Math.round(options.beatsPerMinute ?? parsed.beatsPerMinute))

    const defaultDrums = getEmptySong(1).tracks.find(t => t.drums)?.drums ?? []
    const numDrums = defaultDrums.length || 16

    const melodicSourceTracks = parsed.tracks.filter(t => !drumTrackIds.has(t.id))
    const drumSourceTracks = parsed.tracks.filter(t => drumTrackIds.has(t.id))

    const tracks: Track[] = melodicSourceTracks.map((track, index) => {
        const presetId = instrumentAssignments[track.id] || MAKECODE_MELODIC_INSTRUMENT_PRESETS[index % MAKECODE_MELODIC_INSTRUMENT_PRESETS.length].id
        const preset = presetById.get(presetId) || MAKECODE_MELODIC_INSTRUMENT_PRESETS[0]

        const instrument = {
            ...preset.instrument,
            ampEnvelope: { ...preset.instrument.ampEnvelope },
            pitchEnvelope: preset.instrument.pitchEnvelope && { ...preset.instrument.pitchEnvelope },
            ampLFO: preset.instrument.ampLFO && { ...preset.instrument.ampLFO },
            pitchLFO: preset.instrument.pitchLFO && { ...preset.instrument.pitchLFO },
        }

        const transposed = transposeNoteEvents(track.notes, transposeOctaves)
        const scaled = scaleTiming(transposed, track.sourcePpq, ticksPerBeat)

        return {
            id: preset.makecodeTrackId,
            instrument,
            notes: scaled,
        }
    })

    if (drumSourceTracks.length > 0) {
        const allDrumNotes: NoteEvent[] = []
        for (const drumTrack of drumSourceTracks) {
            const remapped = remapDrumNotes(drumTrack.notes, drumTransposeOctaves, numDrums)
            const scaled = scaleTiming(remapped, drumTrack.sourcePpq, ticksPerBeat)
            allDrumNotes.push(...scaled)
        }
        allDrumNotes.sort((a, b) => a.startTick - b.startTick)

        tracks.push({
            id: 9, // MakeCode drums track id
            instrument: { waveform: 0, ampEnvelope: { attack: 0, decay: 0, sustain: 0, release: 0, amplitude: 0 } },
            drums: defaultDrums,
            notes: allDrumNotes,
        })
    }

    const maxTick = tracks.reduce(
        (songMax, track) => Math.max(songMax, ...track.notes.map((note) => note.endTick), 0),
        0,
    )

    const ticksPerMeasure = ticksPerBeat * parsed.beatsPerMeasure
    const measures = Math.max(1, Math.ceil(maxTick / ticksPerMeasure))

    const song: Song = {
        beatsPerMinute,
        beatsPerMeasure: parsed.beatsPerMeasure,
        ticksPerBeat,
        measures,
        tracks,
    }

    return song
}

export const buildMakeCodeSongHex = (
    parsed: ParsedMidiSummary,
    instrumentAssignments: Record<number, string>,
    options: BuildSongOptions = {},
): string => encodeSongToHex(buildMakeCodeSong(parsed, instrumentAssignments, options))

export const buildMakeCodeSongSnippet = (
    parsed: ParsedMidiSummary,
    instrumentAssignments: Record<number, string>,
    options: BuildSongOptions = {},
): string => {
    const songHex = buildMakeCodeSongHex(parsed, instrumentAssignments, options)

    const transposeOctaves = options.transposeOctaves || 0
    const drumTransposeOctaves = options.drumTransposeOctaves || 0
    const beatsPerMinute = Math.max(1, Math.round(options.beatsPerMinute ?? parsed.beatsPerMinute))

    const fileLabel =
        parsed.fileNames.length === 1 ? parsed.fileNames[0] : `${parsed.fileNames.length} MIDI files`

    const melodicTransposeLabel =
        transposeOctaves === 0 ? '' : `\n// Melodic tracks transposed ${transposeOctaves > 0 ? '+' : ''}${transposeOctaves} octave(s)`
    const drumTransposeLabel =
        drumTransposeOctaves === 0 ? '' : `\n// Drum tracks transposed ${drumTransposeOctaves > 0 ? '+' : ''}${drumTransposeOctaves} octave(s)`
    const bpmLabel =
        beatsPerMinute === parsed.beatsPerMinute ? '' : `\n// Tempo set to ${beatsPerMinute} BPM`

    return `// Generated from ${fileLabel}${melodicTransposeLabel}${drumTransposeLabel}${bpmLabel}\nconst song = music.createSong(hex\`${songHex}\`)\nmusic.play(song, music.PlaybackMode.UntilDone)`
}

function isBlackKey(noteNumber: number) {
    const pitchClass = noteNumber % 12;
    return [1, 3, 6, 8, 10].includes(pitchClass);
}

export const guessInstrumentPreset = (trackName: string, index: number) => {
    const presetId = checkNameForPreset(trackName)
    if (presetId !== null) {
        return presetId
    }
    return MAKECODE_MELODIC_INSTRUMENT_PRESETS[index % MAKECODE_MELODIC_INSTRUMENT_PRESETS.length].id
}

export const checkNameForPreset = (trackName: string) => {
    const lowerName = trackName.toLowerCase()
    for (const preset of MAKECODE_MELODIC_INSTRUMENT_PRESETS) {
        if (lowerName.includes(preset.label.toLowerCase())) {
            return preset.id
        }
    }
    return null
}

// MIDI channel 10 (zero-indexed 9) is reserved for percussion by the General MIDI spec
export const isLikelyDrumTrack = (track: MidiTrackSummary) => {
    const lowerName = `${track.name} ${track.sourceTrackName}`.toLowerCase()
    return track.channel === 9 || lowerName.includes('drum') || lowerName.includes('percussion')
}
