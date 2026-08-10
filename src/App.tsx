import { useMemo, useState } from 'react'
import './App.css'
import {
  buildMakeCodeSongSnippet,
  guessInstrumentPreset,
  isLikelyDrumTrack,
  parseMidiFiles,
  type ParsedMidiSummary,
} from './lib/makecodeSong'
import { FileUploadPanel } from './components/FileUploadPanel'
import { TracksPanel } from './components/TracksPanel'
import { OutputPanel } from './components/OutputPanel'
import { MakeCodeSongPreview } from './components/MakeCodeSongPreview'
import { InstrumentRangeTable } from './components/InstrumentRangeTable'

function App() {
  const [parsedMidi, setParsedMidi] = useState<ParsedMidiSummary | null>(null)
  const [instrumentAssignments, setInstrumentAssignments] = useState<Record<number, string>>({})
  const [drumTrackIds, setDrumTrackIds] = useState<Set<number>>(new Set())
  const [transposeOctaves, setTransposeOctaves] = useState(0)
  const [drumTransposeOctaves, setDrumTransposeOctaves] = useState(0)
  const [beatsPerMinute, setBeatsPerMinute] = useState(120)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const generatedSongHex = useMemo(() => {
    const match = /hex`([a-fA-F0-9]+)`/.exec(output)
    return match?.[1] || ''
  }, [output])

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : []
    if (!files.length) return

    try {
      setIsLoading(true)
      setError('')
      setOutput('')
      setCopyState('idle')
      setTransposeOctaves(-3)
      setDrumTransposeOctaves(-2)
      const initialDrumIds = new Set<number>()

      const parsed = await parseMidiFiles(files)
      setParsedMidi(parsed)
      setBeatsPerMinute(parsed.beatsPerMinute)

      const defaults: Record<number, string> = {}
      parsed.tracks.forEach((track, index) => {
        defaults[track.id] = guessInstrumentPreset(track.name, index)
        if (isLikelyDrumTrack(track)) {
          initialDrumIds.add(track.id)
        }
      })

      setInstrumentAssignments(defaults)
      setDrumTrackIds(initialDrumIds)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to parse MIDI files.'
      setParsedMidi(null)
      setInstrumentAssignments({})
      setError(message)
    } finally {
      setIsLoading(false)
      event.target.value = ''
    }
  }

  const handleInstrumentChange = (trackId: number, presetId: string) => {
    setInstrumentAssignments((current) => ({ ...current, [trackId]: presetId }))
  }

  const handleDrumToggle = (trackId: number, isDrum: boolean) => {
    setDrumTrackIds((prev) => {
      const next = new Set(prev)
      if (isDrum) next.add(trackId)
      else next.delete(trackId)
      return next
    })
  }

  const generateSong = () => {
    if (!parsedMidi) {
      setError('Load a MIDI file before generating output.')
      return
    }

    try {
      setError('')
      const snippet = buildMakeCodeSongSnippet(parsedMidi, instrumentAssignments, {
        transposeOctaves,
        drumTransposeOctaves,
        drumTrackIds,
        beatsPerMinute,
      })
      setOutput(snippet)
      setCopyState('idle')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to generate MakeCode song output.'
      setError(message)
    }
  }

  const copyToClipboard = async () => {
    if (!output) return

    try {
      await navigator.clipboard.writeText(output)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">MIDI to MakeCode Arcade</p>
        <h1>Turn Any MIDI into an Arcade Song Asset</h1>
        <p className="hero-copy">
          Upload one or more MIDI files, choose a MakeCode instrument for each track, then copy the generated
          TypeScript snippet.
        </p>
      </header>

      <InstrumentRangeTable />

      <FileUploadPanel isLoading={isLoading} error={error} onFilesSelected={handleFilesSelected} />

      {parsedMidi && (
        <TracksPanel
          parsedMidi={parsedMidi}
          instrumentAssignments={instrumentAssignments}
          drumTrackIds={drumTrackIds}
          transposeOctaves={transposeOctaves}
          drumTransposeOctaves={drumTransposeOctaves}
          beatsPerMinute={beatsPerMinute}
          onInstrumentChange={handleInstrumentChange}
          onDrumToggle={handleDrumToggle}
          onTransposeChange={setTransposeOctaves}
          onDrumTransposeChange={setDrumTransposeOctaves}
          onBeatsPerMinuteChange={setBeatsPerMinute}
          onGenerate={generateSong}
        />
      )}

      <OutputPanel
        output={output}
        copyState={copyState}
        onOutputChange={setOutput}
        onCopy={copyToClipboard}
      />

      {generatedSongHex && <MakeCodeSongPreview songHex={generatedSongHex} />}
    </main>
  )
}

export default App
