import { useState } from 'react'
import type { Run } from '../App'

type Props = {
  runs: Run[]
  busy: boolean
  hasSelection: boolean
  onRun: (command: string) => void
  onCancel: (execId: string) => void
}

export default function RunPanel({ runs, busy, hasSelection, onRun, onCancel }: Props) {
  const [command, setCommand] = useState('')

  const submit = () => {
    if (!command.trim() || busy) return
    onRun(command)
    setCommand('')
  }

  // A run is cancellable while any of its jobs is still in flight. Once every
  // host reported, the button is noise.
  const isLive = (r: Run) =>
    !r.cancelled && r.jobs.some((j) => j.status === 'running' || j.status === 'pending')

  return (
    <section className="panel" aria-label="Run command">
      <div className="panel-head">
        <h2 className="panel-title">Run</h2>
      </div>

      <div className="run-bar">
        <input
          className="command-input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="systemctl restart nginx"
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn-primary" onClick={submit} disabled={busy || !command.trim()}>
          {busy ? '…' : 'Run'}
        </button>
      </div>
      <p className="hint dim">
        {hasSelection ? 'Runs on the selected hosts.' : 'Nothing selected — runs on every host.'}
      </p>

      <div className="results">
        {runs.map((run) => (
          <div className="run" key={run.execId}>
            <div className="run-head">
              <span className="mono cmd">$ {run.command}</span>
              {run.cancelled && <span className="pill fail">cancelled</span>}
              {isLive(run) && (
                <button className="btn btn-small btn-ghost" onClick={() => onCancel(run.execId)}>
                  Cancel
                </button>
              )}
            </div>
            {run.jobs.map((job) => (
              <div className="job" key={job.jobId}>
                <div className="job-head">
                  <span className="job-host">{job.hostname}</span>
                  <Pill status={job.status} code={job.code} />
                </div>
                {job.error && <div className="job-error">{job.error}</div>}
                {job.out && <pre className="job-out">{job.out}</pre>}
                {job.err && <pre className="job-out stderr">{job.err}</pre>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {runs.length === 0 && (
        <div className="empty">
          <p>Nothing running yet.</p>
          <p className="dim">Run a command and the output lands here.</p>
        </div>
      )}
    </section>
  )
}

function Pill({ status, code }: { status: string; code: number | null }) {
  if (status === 'done') {
    const ok = code === 0
    return <span className={`pill ${ok ? 'ok' : 'fail'}`}>{code === null ? 'done' : `exit ${code}`}</span>
  }
  if (status === 'failed') return <span className="pill fail">failed</span>
  if (status === 'running') return <span className="pill running">running</span>
  return <span className="pill">pending</span>
}
