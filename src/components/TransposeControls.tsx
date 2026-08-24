import {
  DEFAULT_TICKS_PER_BEAT,
  MAX_SONG_MEASURES,
  MAX_TICKS_PER_BEAT,
} from '../lib/makecodeSong'

interface TransposeControlsProps {
  transposeOctaves: number
  drumTransposeOctaves: number
  beatsPerMinute: number
  ticksPerBeat: number
  doubleResolution: boolean
  quantizeNoteEvents: boolean
  truncateMeasures: number | undefined
  onTransposeChange: (value: number) => void
  onDrumTransposeChange: (value: number) => void
  onBeatsPerMinuteChange: (value: number) => void
  onTicksPerBeatChange: (value: number) => void
  onDoubleResolutionChange: (value: boolean) => void
  onQuantizeNoteEventsChange: (value: boolean) => void
  onTruncateMeasuresChange: (value: number | undefined) => void
}

function clampOctaves(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(-4, Math.min(4, value))
}

function clampBeatsPerMinute(value: number): number {
  return Number.isNaN(value) ? 120 : Math.max(1, Math.min(400, Math.round(value)))
}

function clampTicksPerBeat(value: number): number {
  return Number.isNaN(value)
    ? DEFAULT_TICKS_PER_BEAT
    : Math.max(1, Math.min(MAX_TICKS_PER_BEAT, Math.round(value)))
}

function clampTruncateMeasures(value: number): number | undefined {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_SONG_MEASURES, Math.round(value)))
    : undefined
}

export function TransposeControls({
  transposeOctaves,
  drumTransposeOctaves,
  beatsPerMinute,
  ticksPerBeat,
  doubleResolution,
  quantizeNoteEvents,
  truncateMeasures,
  onTransposeChange,
  onDrumTransposeChange,
  onBeatsPerMinuteChange,
  onTicksPerBeatChange,
  onDoubleResolutionChange,
  onQuantizeNoteEventsChange,
  onTruncateMeasuresChange,
}: TransposeControlsProps) {
  return (
    <div className="transpose-row">
      <label>
        Transpose Melodic Tracks
        <input
          type="number"
          min={-4}
          max={4}
          step={1}
          value={transposeOctaves}
          onChange={(event) => onTransposeChange(clampOctaves(Number(event.target.value)))}
        />
        <span className="unit-label">octaves</span>
      </label>
      <label>
        Transpose Drum Tracks
        <input
          type="number"
          min={-4}
          max={4}
          step={1}
          value={drumTransposeOctaves}
          onChange={(event) => onDrumTransposeChange(clampOctaves(Number(event.target.value)))}
        />
        <span className="unit-label">octaves</span>
      </label>
      <label>
        BPM
        <input
          type="number"
          min={1}
          max={400}
          step={1}
          value={beatsPerMinute}
          onChange={(event) => onBeatsPerMinuteChange(clampBeatsPerMinute(Number(event.target.value)))}
        />
        <span className="unit-label">beats/min</span>
      </label>
      <label>
        Timing Resolution
        <input
          type="number"
          min={1}
          max={MAX_TICKS_PER_BEAT}
          step={1}
          value={ticksPerBeat}
          onChange={(event) => onTicksPerBeatChange(clampTicksPerBeat(Number(event.target.value)))}
        />
        <span className="unit-label">ticks/beat</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={doubleResolution}
          onChange={(event) => onDoubleResolutionChange(event.target.checked)}
        />
        Double Resolution
        <span className="unit-label">2× measures and BPM</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={quantizeNoteEvents}
          onChange={(event) => onQuantizeNoteEventsChange(event.target.checked)}
        />
        Quantize Note Events
        <span className="unit-label">merge chords and remove overlaps</span>
      </label>
      <label>
        Truncate
        <input
          type="number"
          min={1}
          max={MAX_SONG_MEASURES}
          step={1}
          value={truncateMeasures ?? ''}
          placeholder="None"
          onChange={(event) => {
            const value = event.target.value
            onTruncateMeasuresChange(
              value === '' ? undefined : clampTruncateMeasures(Number(value)),
            )
          }}
        />
        <span className="unit-label">measures</span>
      </label>
    </div>
  )
}
