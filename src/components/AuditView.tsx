// The audit trail. Every state change the hub makes lands in SQLite, and this is
// the only screen that answers "who ran what on which machine last week".
//
// It is deliberately read-only and deliberately boring: a log you cannot edit
// from the UI is the entire point.

import { useCallback, useEffect, useState } from 'react'
import { listAudit } from '../api/client'
import type { AuditEntry } from '../api/types'

const ACTIONS = [
  { value: '', label: 'everything' },
  { value: 'exec', label: 'exec' },
  { value: 'exec.cancel', label: 'exec.cancel' },
  { value: 'file.push', label: 'file.push' },
  { value: 'pty.open', label: 'pty.open' },
  { value: 'host.enroll', label: 'host.enroll' },
  { value: 'host.tags', label: 'host.tags' },
  { value: 'host.delete', label: 'host.delete' },
  { value: 'enroll.token', label: 'enroll.token' },
  { value: 'enroll.token.reusable', label: 'enroll.token.reusable' },
  { value: 'enroll.token.revoke', label: 'enroll.token.revoke' },
]

export default function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [action, setAction] = useState('')
  const [host, setHost] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listAudit({ limit: 300, action, host })
      setEntries(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [action, host])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="panel" aria-label="Audit trail">
      <div className="panel-head">
        <h2 className="panel-title">Audit</h2>
        <span className="badge">{entries.length}</span>
        {loading && <span className="dim small">loading…</span>}
      </div>

      <div className="audit-filters">
        <select
          className="input"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
        >
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <input
          className="input mono"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="host id or hostname"
          aria-label="Filter by host"
          spellCheck={false}
        />
        <button className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <div className="job-error">{error}</div>}

      <div className="audit-list" role="table">
        {entries.map((e) => (
          <div className="audit-row" role="row" key={e.id}>
            <span className="audit-time mono dim" title={new Date(e.ts * 1000).toISOString()}>
              {new Date(e.ts * 1000).toLocaleString()}
            </span>
            <span className={`audit-action audit-${e.action.replace(/\./g, '-')}`}>{e.action}</span>
            <span className="audit-host mono">{e.host || '—'}</span>
            <span className="audit-detail mono" title={e.detail}>
              {e.detail || ''}
            </span>
          </div>
        ))}
      </div>

      {entries.length === 0 && !loading && !error && (
        <div className="empty">
          <p>Nothing recorded yet.</p>
          <p className="dim">Enroll a host, run a command, or push a file.</p>
        </div>
      )}
    </section>
  )
}
