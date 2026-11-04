import { useState } from 'react'
import type { Host, HostMetrics } from '../api/types'

type Props = {
  hosts: Host[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onShell: (host: Host) => void
  onRemove: (host: Host) => void
  onSaveTags: (host: Host, tags: string[]) => void
}

export default function HostList({
  hosts,
  selected,
  onToggle,
  onToggleAll,
  onShell,
  onRemove,
  onSaveTags,
}: Props) {
  const allSelected = hosts.length > 0 && selected.size === hosts.length

  return (
    <section className="panel" aria-label="Hosts">
      <div className="panel-head">
        <h2 className="panel-title">Hosts</h2>
        <span className="badge">{hosts.length}</span>
        {hosts.length > 0 && (
          <label className="select-all">
            <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
            <span>all</span>
          </label>
        )}
      </div>

      <div className="host-list" role="list">
        {hosts.map((h) => (
          <HostRow
            key={h.id}
            host={h}
            selected={selected.has(h.id)}
            onToggle={onToggle}
            onShell={onShell}
            onRemove={onRemove}
            onSaveTags={onSaveTags}
          />
        ))}
      </div>

      {hosts.length === 0 && (
        <div className="empty">
          <p>No hosts yet.</p>
          <p className="dim">Open Install commands and paste the command on the target machine.</p>
        </div>
      )}
    </section>
  )
}

function HostRow({
  host,
  selected,
  onToggle,
  onShell,
  onRemove,
  onSaveTags,
}: {
  host: Host
  selected: boolean
  onToggle: (id: string) => void
  onShell: (host: Host) => void
  onRemove: (host: Host) => void
  onSaveTags: (host: Host, tags: string[]) => void
}) {
  const [editingTags, setEditingTags] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const commitTags = () => {
    if (editingTags === null) return
    const tags = editingTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    onSaveTags(host, tags)
    setEditingTags(null)
  }

  return (
    <div
      role="listitem"
      className={`host${selected ? ' selected' : ''}${host.online ? '' : ' offline'}`}
      onClick={() => onToggle(host.id)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(host.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`select ${host.hostname}`}
      />
      <span className={`dot${host.online ? ' on' : ''}`} aria-hidden="true" />

      <div className="host-main">
        <button
          className="host-name"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          title={expanded ? 'hide details' : 'show details'}
        >
          {host.hostname}
        </button>
        <div className="host-meta dim">
          {host.os} {host.arch}
          {host.version && ` · v${host.version}`}
          {host.online && host.load > 0 && ` · load ${host.load.toFixed(2)}`}
        </div>
        {host.metrics && <MetricBars m={host.metrics} />}
        {expanded && <HostDetail host={host} />}
      </div>

      <div className="host-actions" onClick={(e) => e.stopPropagation()}>
        {editingTags !== null ? (
          <input
            className="tags-input"
            autoFocus
            value={editingTags}
            onChange={(e) => setEditingTags(e.target.value)}
            onBlur={commitTags}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTags()
              if (e.key === 'Escape') setEditingTags(null)
            }}
            placeholder="tag, tag"
            aria-label={`tags for ${host.hostname}`}
          />
        ) : (
          <button
            className="tags"
            onClick={() => setEditingTags(host.tags.join(', '))}
            title="Edit tags"
            aria-label={`edit tags for ${host.hostname}`}
          >
            {host.tags.length > 0 ? (
              host.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))
            ) : (
              <span className="tag ghost">+tag</span>
            )}
          </button>
        )}

        <button
          className="btn btn-ghost btn-sm"
          disabled={!host.online}
          onClick={() => onShell(host)}
          title={host.online ? 'Open a shell' : 'host is offline'}
        >
          Shell
        </button>

        <button
          className={`btn btn-ghost btn-sm${armed ? ' btn-danger-ghost' : ''}`}
          onClick={() => {
            if (!armed) {
              setArmed(true)
              setTimeout(() => setArmed(false), 3000)
              return
            }
            onRemove(host)
          }}
          title={armed ? 'click again to confirm' : 'remove host'}
        >
          {armed ? 'Confirm' : '×'}
        </button>
      </div>
    </div>
  )
}

/** Three thin bars: cpu, memory, root disk. Values are 0-100, so a missing
 *  metric reads as an empty bar rather than "unknown" chrome. */
function MetricBars({ m }: { m: HostMetrics }) {
  const mem = m.mem_total && m.mem_used ? (m.mem_used / m.mem_total) * 100 : 0
  const disk = m.disk_total && m.disk_used ? (m.disk_used / m.disk_total) * 100 : 0
  const rows: [string, number][] = [
    ['cpu', m.cpu_pct ?? 0],
    ['mem', mem],
    ['disk', disk],
  ]
  return (
    <div className="metric-bars">
      {rows.map(([label, pct]) => (
        <span className="metric" key={label} title={`${label} ${pct.toFixed(0)}%`}>
          <span className="metric-label dim">{label}</span>
          <span className="metric-track">
            <span
              className={`metric-fill${pct > 90 ? ' hot' : pct > 70 ? ' warm' : ''}`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </span>
          <span className="metric-value dim">{pct.toFixed(0)}%</span>
        </span>
      ))}
    </div>
  )
}

function HostDetail({ host }: { host: Host }) {
  const m = host.metrics
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`
  const rows: [string, string][] = [
    ['id', host.id],
    ['os', `${host.os} ${host.arch}`],
    ['agent', host.version || '—'],
    ['enrolled', new Date(host.created_at * 1000).toLocaleString()],
    ['last seen', host.online ? 'now' : new Date(host.last_seen * 1000).toLocaleString()],
    ['load', host.load > 0 ? host.load.toFixed(2) : '—'],
    ['memory', m?.mem_total ? `${gb(m.mem_used ?? 0)} / ${gb(m.mem_total)}` : '—'],
    ['disk /', m?.disk_total ? `${gb(m.disk_used ?? 0)} / ${gb(m.disk_total)}` : '—'],
    ['procs', m ? String(m.procs) : '—'],
    ['uptime', m && m.uptime_sec ? `${(m.uptime_sec / 86400).toFixed(1)} days` : '—'],
  ]
  return (
    <dl className="host-detail">
      {rows.map(([k, v]) => (
        <div className="host-detail-row" key={k}>
          <dt className="dim">{k}</dt>
          <dd className="mono">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
