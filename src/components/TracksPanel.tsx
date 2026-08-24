import { useMemo } from 'react'
import { type ParsedMidiSummary } from '../lib/makecodeSong'
import { TrackCard } from './TrackCard'
import { TransposeControls } from './TransposeControls'

interface TracksPanelProps {
  parsedMidi: ParsedMidiSummary
  instrumentAssignments: Record<number, string>
  drumTrackIds: Set<number>
  transposeOctaves: number
  drumTransposeOctaves: number
  beatsPerMinute: number
  ticksPerBeat: number
  doubleResolution: boolean
  quantizeNoteEvents: boolean
  truncateMeasures: number | undefined
  onInstrumentChange: (trackId: number, presetId: string) => void
  onDrumToggle: (trackId: number, isDrum: boolean) => void
  onTransposeChange: (value: number) => void
  onDrumTransposeChange: (value: number) => void
  onBeatsPerMinuteChange: (value: number) => void
  onTicksPerBeatChange: (value: number) => void
  onDoubleResolutionChange: (value: boolean) => void
  onQuantizeNoteEventsChange: (value: boolean) => void
  onTruncateMeasuresChange: (value: number | undefined) => void
  onGenerate: () => void
}

export function TracksPanel({
  parsedMidi,
  instrumentAssignments,
  drumTrackIds,
  transposeOctaves,
  drumTransposeOctaves,
  beatsPerMinute,
  ticksPerBeat,
  doubleResolution,
  quantizeNoteEvents,
  truncateMeasures,
  onInstrumentChange,
  onDrumToggle,
  onTransposeChange,
  onDrumTransposeChange,
  onBeatsPerMinuteChange,
  onTicksPerBeatChange,
  onDoubleResolutionChange,
  onQuantizeNoteEventsChange,
  onTruncateMeasuresChange,
  onGenerate,
}: TracksPanelProps) {
  const totalNotes = useMemo(
    () => parsedMidi.tracks.reduce((sum, track) => sum + track.noteCount, 0),
    [parsedMidi],
  )

  return (
    <section className="panel tracks-panel">
      <div className="panel-head">
        <h2>Track Instrument Mapping</h2>
        <p>
          {parsedMidi.fileNames.length} file(s) · {parsedMidi.tracks.length} tracks · {totalNotes} notes ·{' '}
          {beatsPerMinute} BPM
        </p>
      </div>

      <TransposeControls
        transposeOctaves={transposeOctaves}
        drumTransposeOctaves={drumTransposeOctaves}
        beatsPerMinute={beatsPerMinute}
        ticksPerBeat={ticksPerBeat}
        doubleResolution={doubleResolution}
        quantizeNoteEvents={quantizeNoteEvents}
        truncateMeasures={truncateMeasures}
        onTransposeChange={onTransposeChange}
        onDrumTransposeChange={onDrumTransposeChange}
        onBeatsPerMinuteChange={onBeatsPerMinuteChange}
        onTicksPerBeatChange={onTicksPerBeatChange}
        onDoubleResolutionChange={onDoubleResolutionChange}
        onQuantizeNoteEventsChange={onQuantizeNoteEventsChange}
        onTruncateMeasuresChange={onTruncateMeasuresChange}
      />

      <div className="track-grid">
        {parsedMidi.tracks.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            isDrum={drumTrackIds.has(track.id)}
            instrumentPresetId={instrumentAssignments[track.id]}
            onDrumToggle={onDrumToggle}
            onInstrumentChange={onInstrumentChange}
          />
        ))}
      </div>

      <button type="button" className="action" onClick={onGenerate}>
        Generate MakeCode Song Snippet
      </button>
    </section>
  )
}
