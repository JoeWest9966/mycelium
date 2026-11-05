import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchWarehouse,
  type WarehouseMachine,
  type WarehousePayload,
} from '../api/warehouse'
import { installMachine, type InstallEvent } from '../api/install'
import type { Host } from '../api/types'
import { copyFailureReason, copyText } from '../lib/clipboard'

type Props = {
  hosts: Host[]
  /** Called once a machine has installed itself and started reporting. */
  onInstalled?: () => void
}

type LogLine = { stream: 'out' | 'err' | 'note'; line: string }

type InstallState = {
  name: string
  status: 'running' | 'done' | 'error'
  lines: LogLine[]
  error?: string
  hint?: string | null
  host?: Host | null
}

/**
 * The warehouse catalog.
 *
 * The ssh commands are for you to run. "Install hypha" is different: it asks the
 * panel's own host to fetch that machine's credential from the warehouse and run
 * the installer over ssh. The credential never enters this page — there is no
 * endpoint that would hand it over — and that is the whole reason the button can
 * exist without the hub holding credentials.
 */
export default function WarehouseView({ hosts, onInstalled }: Props) {
  const [payload, setPayload] = useState<WarehousePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [install, setInstall] = useState<InstallState | null>(null)
  const abort = useRef<AbortController | null>(null)

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

  // An install must not keep streaming after the operator navigates away.
  useEffect(() => () => abort.current?.abort(), [])

  const copy = async (cmd: string, name: string) => {
    if (!(await copyText(cmd))) {
      setError(copyFailureReason())
      return
    }
    setError(null)
    setCopied(name)
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500)
  }

  const startInstall = useCallback(
    async (name: string) => {
      if (install?.status === 'running') return
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setInstall({ name, status: 'running', lines: [] })

      const push = (line: LogLine) =>
        setInstall((prev) => (prev ? { ...prev, lines: [...prev.lines, line] } : prev))

      const onEvent = (ev: InstallEvent) => {
        switch (ev.step) {
          case 'log':
            push({ stream: ev.stream, line: ev.line })
            break
          case 'done':
            setInstall((prev) =>
              prev ? { ...prev, status: 'done', host: ev.host, lines: prev.lines } : prev,
            )
            onInstalled?.()
            break
          case 'error':
            setInstall((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'error',
                    error: ev.message,
                    hint: ev.hint ?? null,
                    lines: prev.lines,
                  }
                : prev,
            )
            break
          default:
            push({ stream: 'note', line: ev.message })
        }
      }

      try {
        await installMachine(name, onEvent, controller.signal)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setInstall((prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
              }
            : prev,
        )
      }
    },
    [install, onInstalled],
  )

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
            Read-only catalog. The ssh command is for you to run; nothing here writes to the
            warehouse.
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
            install={install?.name === m.name ? install : null}
            busy={install?.status === 'running'}
            onInstall={() => void startInstall(m.name)}
            onDismiss={() => setInstall((prev) => (prev?.name === m.name ? null : prev))}
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
      h.hostname?.startsWith(`${machine.name}.`) ||
      h.tags.includes(machine.name) ||
      h.tags.includes(`wh:${machine.name}`),
  )
}

function MachineRow({
  machine,
  enrolled,
  copied,
  onCopy,
  install,
  busy,
  onInstall,
  onDismiss,
}: {
  machine: WarehouseMachine
  enrolled: boolean
  copied: boolean
  onCopy: (cmd: string, name: string) => void
  install: InstallState | null
  busy: boolean
  onInstall: () => void
  onDismiss: () => void
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
        <button
          className="btn btn-ghost btn-sm wh-install-btn"
          onClick={onInstall}
          disabled={busy}
          title="Fetch this machine's credential on the panel host and run the hypha installer over ssh"
        >
          {install?.status === 'running' ? 'installing…' : enrolled ? 'Reinstall' : 'Install hypha'}
        </button>
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

      {install && (
        <InstallLog
          state={install}
          onClose={onDismiss}
          onRetry={install.status === 'error' ? onInstall : undefined}
        />
      )}
    </div>
  )
}

function InstallLog({
  state,
  onClose,
  onRetry,
}: {
  state: InstallState
  onClose: () => void
  onRetry?: () => void
}) {
  const body = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = body.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.lines.length])

  return (
    <div className={`wh-install ${state.status}`}>
      <div className="wh-install-head">
        <span className={`pill ${state.status === 'running' ? 'running' : state.status === 'done' ? 'ok' : 'fail'}`}>
          {state.status === 'running' ? 'installing' : state.status === 'done' ? 'installed' : 'failed'}
        </span>
        {state.status === 'done' && state.host && (
          <span className="dim mono wh-install-meta">
            {state.host.hostname} · {state.host.id}
          </span>
        )}
        {state.status === 'error' && <span className="wh-install-error">{state.error}</span>}
        {state.status === 'running' && <span className="wh-install-meta" />}
        {onRetry && (
          <button className="btn btn-ghost btn-sm" onClick={onRetry}>
            Retry
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          ×
        </button>
      </div>

      {state.status === 'error' && state.hint && <div className="dim wh-install-hint">{state.hint}</div>}

      {state.lines.length > 0 && (
        <div className="wh-install-body mono" ref={body}>
          {state.lines.map((l, i) => (
            <div key={i} className={l.stream === 'err' ? 'err' : l.stream === 'note' ? 'note' : undefined}>
              {l.line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
