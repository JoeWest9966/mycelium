import { useCallback, useEffect, useState } from 'react'
import {
  fetchWarehouse,
  type WarehouseMachine,
  type WarehousePayload,
} from '../api/warehouse'
import type { Host } from '../api/types'

type Props = {
  hosts: Host[]
}

/**
 * The warehouse catalog, read-only.
 *
 * It lists what the warehouse knows and gives you the exact ssh command per
 * machine. It deliberately does not offer "install here": doing that needs a
 * credential, and no read API in that project hands one out — it hands out
 * commands instead. So does this.
 */
export default function WarehouseView({ hosts }: Props) {
  const [payload, setPayload] = useState<WarehousePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPayload(await fetchWarehouse())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async (cmd: string, name: string) => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(name)
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
    } catch {
      setError('clipboard blocked by the browser; select the command manually')
    }
  }

  const machines = payload?.data.machines ?? []
  const upstream = payload?.data.upstream
  const source = payload?.data.source

  return (
    <section className="panel warehouse" aria-label="Warehouse">
      <div className="panel-head">
        <h2 className="panel-title">Warehouse</h2>
        <span className="badge">{machines.length}</span>
        {upstream?.ms !== undefined && (
          <span className="dim mono provenance">
            {source?.panel ?? 'warehouse'} · {upstream.ms}ms
            {upstream.nw ? ` · nw ${upstream.nw}` : ''}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="warehouse-error">
          <p>{error}</p>
          <p className="dim">
            Read-only catalog. Nothing here writes to the warehouse; every action is a command you
            run yourself.
          </p>
        </div>
      )}

      <div className="wh-list">
        {machines.map((m) => (
          <MachineRow
            key={m.name}
            machine={m}
            enrolled={isEnrolled(m, hosts)}
            copied={copied === m.name}
            onCopy={copy}
          />
        ))}
      </div>

      {!error && machines.length === 0 && !loading && (
        <div className="empty">
          <p>The warehouse catalog is empty.</p>
        </div>
      )}

      {source && (
        <div className="wh-foot dim mono">
          {source.catalog && <span>catalog {source.catalog}</span>}
          {source.schema && <span>schema {source.schema}</span>}
        </div>
      )}
    </section>
  )
}

/** A machine is "in the fleet" when a host reports the same name or carries it as a tag. */
function isEnrolled(machine: WarehouseMachine, hosts: Host[]): boolean {
  return hosts.some(
    (h) =>
      h.hostname === machine.name ||
      h.tags.includes(machine.name) ||
      h.tags.includes(`wh:${machine.name}`),
  )
}

function MachineRow({
  machine,
  enrolled,
  copied,
  onCopy,
}: {
  machine: WarehouseMachine
  enrolled: boolean
  copied: boolean
  onCopy: (cmd: string, name: string) => void
}) {
  const ssh = machine.ssh ?? []
  const primary = ssh[0]

  return (
    <div className="wh-row">
      <div className="wh-head">
        <span className={`dot${enrolled ? ' on' : ''}`} aria-hidden="true" />
        <span className="wh-name">{machine.name}</span>
        {enrolled ? (
          <span className="pill ok">in fleet</span>
        ) : (
          <span className="pill">not enrolled</span>
        )}
        {machine.tags?.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>

      <div className="wh-meta dim mono">
        {machine.user ?? 'root'}@{primary?.addr ?? machine.ips?.[0]?.addr ?? '?'}
        {machine.port ? `:${machine.port}` : ''}
        {machine.ips?.length && machine.ips.length > 1
          ? ` · ${machine.ips.map((i) => `${i.label}:${i.addr}`).join(' ')}`
          : ''}
      </div>

      {machine.note && <div className="wh-note dim">{machine.note}</div>}

      {primary && (
        <div className="wh-cmd">
          <code>{primary.cmd}</code>
          <button className="btn btn-ghost btn-sm" onClick={() => void onCopy(primary.cmd, machine.name)}>
            {copied ? 'copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  )
}
