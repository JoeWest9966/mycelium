// Push a file to hosts. The browser reads the file as bytes, base64s it, and the
// agent writes it atomically (temp + rename), so a failure at any point leaves
// the previous file intact.

import { useState } from 'react'
import { ApiError, pushFile } from '../api/client'
import type { FilePushResult, Host } from '../api/types'

type Props = {
  hosts: Host[]
  selected: Set<string>
}

export default function FilesView({ hosts, selected }: Props) {
  const [path, setPath] = useState('')
  const [mode, setMode] = useState('0644')
  const [file, setFile] = useState<{ name: string; content: string; size: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<FilePushResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const targets = selected.size > 0 ? hosts.filter((h) => selected.has(h.id)) : hosts
  const online = targets.filter((h) => h.online)

  const pick = async (f: File | null) => {
    if (!f) {
      setFile(null)
      return
    }
    const buf = new Uint8Array(await f.arrayBuffer())
    // btoa on a binary string: chunked so a large file cannot blow the argument
    // limit of String.fromCharCode.
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
    }
    setFile({ name: f.name, content: btoa(bin), size: buf.length })
    if (!path) setPath(`/tmp/${f.name}`)
  }

  const push = async () => {
    if (!file || !path.trim() || busy) return
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      const modeNum = parseInt(mode, 8)
      const res = await pushFile({
        targets:
          selected.size > 0
            ? { hosts: [...selected], tags: [], all: false }
            : { hosts: [], tags: [], all: true },
        path: path.trim(),
        mode: Number.isNaN(modeNum) ? undefined : modeNum,
        content: file.content,
      })
      setResults(res.results)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-label="Push a file">
      <div className="panel-head">
        <h2 className="panel-title">Files</h2>
      </div>

      <div className="file-form">
        <label className="field">
          <span className="dim small">file</span>
          <input
            className="input"
            type="file"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
        </label>

        <label className="field">
          <span className="dim small">path on host</span>
          <input
            className="input mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/etc/nginx/nginx.conf"
            spellCheck={false}
          />
        </label>

        <label className="field narrow">
          <span className="dim small">mode</span>
          <input
            className="input mono"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            spellCheck={false}
            aria-label="unix mode in octal"
          />
        </label>

        <button
          className="btn btn-primary"
          onClick={() => void push()}
          disabled={busy || !file || !path.trim() || online.length === 0}
        >
          {busy ? '…' : `Push to ${online.length}`}
        </button>
      </div>

      <p className="hint dim">
        {file
          ? `${file.name} · ${(file.size / 1024).toFixed(1)} KiB → ${targets.length} host${targets.length === 1 ? '' : 's'}`
          : selected.size > 0
            ? 'Pushing to the selected hosts.'
            : 'Nothing selected — pushes to every host.'}
        . Written atomically: temp file, fsync, rename.
      </p>

      {error && <div className="job-error">{error}</div>}

      {results && (
        <div className="file-results">
          {results.map((r) => (
            <div className="file-result" key={r.host_id}>
              <span className={`dot${r.ok ? ' on' : ''}`} aria-hidden="true" />
              <span className="job-host">{r.hostname}</span>
              {r.ok ? (
                <span className="pill ok">{r.bytes} B</span>
              ) : (
                <span className="pill fail">{r.error ?? 'failed'}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
