import { useState } from 'react'
import type { Host } from '../api/types'

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
        <div className="host-name">{host.hostname}</div>
        <div className="host-meta dim">
          {host.os} {host.arch}
          {host.version && ` · v${host.version}`}
          {host.online && host.load > 0 && ` · load ${host.load.toFixed(2)}`}
        </div>
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
