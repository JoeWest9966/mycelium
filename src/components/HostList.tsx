import type { Host } from '../api/types'

type Props = {
  hosts: Host[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
}

export default function HostList({ hosts, selected, onToggle, onToggleAll }: Props) {
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
        {hosts.map((h) => {
          const isSelected = selected.has(h.id)
          return (
            <div
              key={h.id}
              role="listitem"
              className={`host${isSelected ? ' selected' : ''}${h.online ? '' : ' offline'}`}
              onClick={() => onToggle(h.id)}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(h.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`select ${h.hostname}`}
              />
              <span className={`dot${h.online ? ' on' : ''}`} aria-hidden="true" />
              <div className="host-main">
                <div className="host-name">{h.hostname}</div>
                <div className="host-meta dim">
                  {h.os} {h.arch}
                  {h.version && ` · v${h.version}`}
                  {h.online && h.load > 0 && ` · load ${h.load.toFixed(2)}`}
                </div>
              </div>
              {h.tags.length > 0 && (
                <div className="tags">
                  {h.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hosts.length === 0 && (
        <div className="empty">
          <p>No hosts yet.</p>
          <p className="dim">Enroll one with an install command from the hypha CLI or hub API.</p>
        </div>
      )}
    </section>
  )
}
