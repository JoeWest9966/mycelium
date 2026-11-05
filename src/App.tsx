import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  b64Bytes,
  cancelExec,
  createExec,
  deleteHost,
  getMeta,
  listHosts,
  setHostTags,
  streamExec,
} from './api/client'
import type { ExecEvent, Host, Meta } from './api/types'
import HostList from './components/HostList'
import RunPanel from './components/RunPanel'
import WarehouseView from './components/WarehouseView'
import KeysView from './components/KeysView'
import AuditView from './components/AuditView'
import FilesView from './components/FilesView'
import { TerminalView } from './components/TerminalView'
import PageMenu, { type PageMenuItem } from './components/PageMenu'
import InstallCommandButton from './components/InstallCommandButton'
import { AuditIcon, FilesIcon, FleetIcon, KeyIcon, WarehouseIcon } from './components/icons'
import { PATHS, viewForPath, type View } from './lib/routes'

/** The pages, in the order the dock shows them. */
const VIEWS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: 'fleet', label: 'Fleet', icon: <FleetIcon /> },
  { key: 'warehouse', label: 'Warehouse', icon: <WarehouseIcon /> },
  { key: 'files', label: 'Files', icon: <FilesIcon /> },
  { key: 'keys', label: 'Keys', icon: <KeyIcon /> },
  { key: 'audit', label: 'Audit', icon: <AuditIcon /> },
]

export type JobState = {
  jobId: string
  hostname: string
  status: 'pending' | 'running' | 'done' | 'failed'
  /** stdout and stderr are separate streams; merging them loses the distinction
   *  that makes a failure readable. Both are UTF-8 decoded from base64. */
  out: string
  err: string
  code: number | null
  error?: string
}

export type Run = {
  execId: string
  command: string
  jobs: JobState[]
  cancelled?: boolean
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [hosts, setHosts] = useState<Host[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  // null means the address in the bar is not a page we have. That is shown, not
  // quietly redirected: a bookmarked link that silently lands somewhere else is
  // a broken link nobody ever reports.
  const [route, setRoute] = useState<View | null>(() => viewForPath(location.pathname))
  const [shellHost, setShellHost] = useState<Host | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // One decoder per job: a multi-byte UTF-8 character can be split across two
  // SSE chunks, and decoding each chunk independently would corrupt it.
  const decoders = useRef(new Map<string, TextDecoder>())
  const unsubscribers = useRef(new Set<() => void>())

  const refresh = useCallback(async () => {
    try {
      const list = await listHosts()
      setHosts(list)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Handshake first, then anything else. A panel that renders before knowing
  // the hub's contract version is guessing.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await getMeta()
        if (cancelled) return
        setMeta(m)
        await refresh()
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // Presence has to age out on its own: a host that died two minutes ago
  // should not keep looking alive because nobody clicked Refresh.
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    return () => clearInterval(iv)
  }, [refresh])

  useEffect(() => {
    const subs = unsubscribers.current
    return () => {
      for (const off of subs) off()
      subs.clear()
    }
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => (prev.size === hosts.length ? new Set() : new Set(hosts.map((h) => h.id))))
  }

  // Back and forward move between pages, because they are addresses now.
  useEffect(() => {
    const onPop = () => setRoute(viewForPath(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // One tab, several pages: the title says which one you are looking at.
  useEffect(() => {
    const label = VIEWS.find((v) => v.key === route)?.label
    document.title = label ? `${label} · mycelium` : 'mycelium'
  }, [route])

  const go = (next: View) => {
    if (next === route) return
    // pushState, not a reload: the URL changes, the page does not blink, and a
    // reload of the new URL lands on the same page because the server falls back
    // to index.html for extensionless paths.
    history.pushState({ view: next }, '', PATHS[next])
    setRoute(next)
  }

  const notify = (message: string) => {
    setToast(message)
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2200)
  }

  const removeHost = async (host: Host) => {
    try {
      await deleteHost(host.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(host.id)
        return next
      })
      notify(`${host.hostname} removed`)
      await refresh()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : String(err))
    }
  }

  const cancelRun = async (execId: string) => {
    try {
      const res = await cancelExec(execId)
      setRuns((prev) => prev.map((r) => (r.execId === execId ? { ...r, cancelled: true } : r)))
      notify(res.cancelled.length > 0 ? `cancel sent to ${res.cancelled.length}` : 'run already finished')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : String(err))
    }
  }

  const saveTags = async (host: Host, tags: string[]) => {
    try {
      await setHostTags(host.id, tags)
      notify(`${host.hostname} tags saved`)
      await refresh()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : String(err))
    }
  }

  const applyEvent = useCallback((execId: string, ev: ExecEvent) => {
    setRuns((prev) =>
      prev.map((run) => {
        if (run.execId !== execId) return run
        const jobs = run.jobs.map((job) => {
          if (!('job_id' in ev) || job.jobId !== ev.job_id) return job
          switch (ev.kind) {
            case 'started':
              return { ...job, status: 'running' as const }
            case 'output': {
              // Keyed per stream: a multi-byte character can straddle two SSE
              // chunks, and each stream is decoded independently.
              const key = `${job.jobId}:${ev.stream}`
              let dec = decoders.current.get(key)
              if (!dec) {
                dec = new TextDecoder()
                decoders.current.set(key, dec)
              }
              const text = dec.decode(b64Bytes(ev.data), { stream: true })
              return ev.stream === 'stderr'
                ? { ...job, err: job.err + text, status: 'running' as const }
                : { ...job, out: job.out + text, status: 'running' as const }
            }
            case 'exit': {
              // Flush whatever the decoders were holding back.
              const out = decoders.current.get(`${job.jobId}:stdout`)?.decode() ?? ''
              const err = decoders.current.get(`${job.jobId}:stderr`)?.decode() ?? ''
              return {
                ...job,
                out: job.out + out,
                err: job.err + err,
                status: 'done' as const,
                code: ev.code ?? null,
              }
            }
            case 'failed':
              return { ...job, status: 'failed' as const, error: ev.message }
            default:
              return job
          }
        })
        return { ...run, jobs }
      }),
    )
  }, [])

  const run = async (command: string) => {
    if (!command.trim() || busy) return
    setBusy(true)
    try {
      // No selection means "everything", matching the hub's Targets semantics
      // (empty hosts + empty tags + all:false still matches all hosts).
      const res = await createExec({
        command,
        targets: selected.size > 0 ? { hosts: [...selected], tags: [], all: false } : { hosts: [], tags: [], all: true },
      })

      const fresh: Run = {
        execId: res.exec_id,
        command,
        jobs: res.jobs.map((j) => ({
          jobId: j.job_id,
          hostname: j.hostname,
          status: 'pending' as const,
          out: '',
          err: '',
          code: null,
        })),
      }
      setRuns((prev) => [fresh, ...prev].slice(0, 20))

      const off = streamExec(
        res.exec_id,
        (ev) => applyEvent(res.exec_id, ev),
        (err) => applyEvent(res.exec_id, { kind: 'failed', job_id: '', host_id: '', hostname: '', message: err.message }),
      )
      unsubscribers.current.add(off)
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}` : String(err)
      setRuns((prev) => [
        {
          execId: `err-${Date.now()}`,
          command,
          jobs: [{ jobId: 'err', hostname: '(hub)', status: 'failed', out: '', err: '', code: null, error: msg }],
        },
        ...prev,
      ])
    } finally {
      setBusy(false)
    }
  }

  if (bootError) {
    return (
      <div className="boot boot-error">
        <h1>mycelium can't talk to this hub</h1>
        <p className="mono">{bootError}</p>
        <p className="dim">
          If it mentions <code>api_version</code>, the hub and this panel were built against different
          contracts. Check <code>GET /api/meta</code>.
        </p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="boot">
        <p className="dim">connecting…</p>
      </div>
    )
  }

  const online = hosts.filter((h) => h.online).length

  // The page menu is the page switcher. It moved down here because the top of the
  // window is for state you read (fleet counts, versions), not for things you
  // click every minute.
  const pageMenu: PageMenuItem[] = VIEWS.map((v) => ({
    key: v.key,
    title: v.label,
    icon: v.icon,
    href: PATHS[v.key],
    active: route === v.key,
    onClick: () => go(v.key),
  }))

  return (
    <div className={`app${pageMenu.length > 0 ? ' has-page-menu' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="wordmark">mycelium</span>
          <span className="fleet-stats">
            {hosts.length} hosts · {online} online
          </span>
        </div>
        <div className="topbar-right">
          <span className="dim mono">
            hypha {meta.version} · api v{meta.api_version}
          </span>
          <button className="btn btn-ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          {/* The install command is a one-click action, not a page. */}
          <InstallCommandButton onNotify={notify} />
        </div>
      </header>

      <main className={route === 'fleet' ? 'layout' : 'layout single'}>
        {route === null && (
          <section className="panel" aria-label="Not found">
            <div className="panel-head">
              <h2 className="panel-title">No such page</h2>
            </div>
            <div className="keys-body">
              <p className="hint dim">
                <code>{location.pathname}</code> is not one of the panel&apos;s pages.
              </p>
              <p>
                <a className="btn btn-ghost" href="/">
                  Back to Fleet
                </a>
              </p>
            </div>
          </section>
        )}
        {route === 'fleet' && (
          <>
            <HostList
              hosts={hosts}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onShell={setShellHost}
              onRemove={(h) => void removeHost(h)}
              onSaveTags={(h, tags) => void saveTags(h, tags)}
            />
            <RunPanel
              runs={runs}
              busy={busy}
              hasSelection={selected.size > 0}
              onRun={run}
              onCancel={(id) => void cancelRun(id)}
            />
          </>
        )}
        {route === 'warehouse' && <WarehouseView
            hosts={hosts}
            onInstalled={() => {
              // The satellite needs a beat to dial home; poll twice so the new
              // row appears without the operator hitting Refresh.
              void refresh()
              setTimeout(() => void refresh(), 2500)
            }}
          />}
        {route === 'keys' && <KeysView />}
        {route === 'files' && <FilesView hosts={hosts} selected={selected} />}
        {route === 'audit' && <AuditView />}
      </main>

      <PageMenu items={pageMenu} />

      {shellHost && <TerminalView host={shellHost} onClose={() => setShellHost(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
