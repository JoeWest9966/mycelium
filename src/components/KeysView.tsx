import { useCallback, useEffect, useState } from 'react'
import { createEnrollToken, listEnrollTokens, revokeEnrollToken } from '../api/client'
import type { EnrollTokenInfo } from '../api/types'

type Mode = 'once' | 'reusable'

/**
 * Install commands.
 *
 * A one-shot key burns on first use (24h). A reusable key lives 30 days and is
 * counted, not burned — it is a standing key to the fleet, so it is listed,
 * copyable again later, and revocable when it leaks.
 */
export default function KeysView() {
  const [mode, setMode] = useState<Mode>('once')
  const [label, setLabel] = useState('')
  const [cmd, setCmd] = useState<string | null>(null)
  const [expires, setExpires] = useState<number | null>(null)
  const [keys, setKeys] = useState<EnrollTokenInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const loadKeys = useCallback(async () => {
    try {
      const all = await listEnrollTokens()
      setKeys(all.filter((k) => k.reusable))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await createEnrollToken(
        mode === 'reusable' ? { reusable: true, label: label.trim() } : { ttl_sec: 86400 },
      )
      setCmd(res.install_cmd)
      setExpires(res.expires_at)
      if (mode === 'reusable') {
        setLabel('')
        await loadKeys()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: string) => {
    try {
      await revokeEnrollToken(token)
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      setError('clipboard blocked by the browser; select the command manually')
    }
  }

  const dead = (k: EnrollTokenInfo) => k.revoked || k.expires_at * 1000 < Date.now()

  return (
    <section className="panel keys" aria-label="Install commands">
      <div className="panel-head">
        <h2 className="panel-title">Install commands</h2>
        <div className="seg" role="tablist" aria-label="Key type">
          <button
            className={`seg-btn${mode === 'once' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'once'}
            onClick={() => setMode('once')}
          >
            One-shot
          </button>
          <button
            className={`seg-btn${mode === 'reusable' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'reusable'}
            onClick={() => setMode('reusable')}
          >
            Reusable · 30 days
          </button>
        </div>
      </div>

      <div className="keys-body">
        <p className="hint dim">
          {mode === 'once'
            ? 'Runs once, expires in 24 hours. Use this for a single new machine.'
            : 'Enrolls as many machines as you like for 30 days. Save it somewhere safe.'}
        </p>

        <div className="keys-form">
          {mode === 'reusable' && (
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="name, e.g. homelab"
              maxLength={64}
              aria-label="Key name"
            />
          )}
          <button className="btn btn-primary" onClick={() => void generate()} disabled={busy}>
            {busy ? '…' : mode === 'once' ? 'Generate' : 'Create another key'}
          </button>
        </div>

        {cmd && (
          <>
            <pre className="install-cmd">{cmd}</pre>
            <div className="keys-form">
              <span className="dim mono">
                {expires ? `expires ${new Date(expires * 1000).toLocaleString()}` : ''}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => void copy(cmd, 'current')}>
                {copied === 'current' ? 'copied' : 'Copy command'}
              </button>
            </div>
          </>
        )}

        {mode === 'reusable' && (
          <div className="key-list-wrap">
            <div className="key-list-head">
              <span>Saved reusable keys</span>
              <button className="btn btn-ghost btn-sm" onClick={() => void loadKeys()}>
                Refresh
              </button>
            </div>
            <div className="key-list">
              {keys.length === 0 && <p className="dim">No reusable keys yet.</p>}
              {keys.map((k) => (
                <div className={`key-row${dead(k) ? ' dead' : ''}`} key={k.token}>
                  <div className="key-info">
                    <div className="key-name">{k.label || 'unnamed'}</div>
                    <div className="dim">
                      {k.uses} uses ·{' '}
                      {k.revoked
                        ? 'revoked'
                        : k.expires_at * 1000 < Date.now()
                          ? 'expired'
                          : `expires ${new Date(k.expires_at * 1000).toLocaleDateString()}`}
                      {k.tags.length > 0 && ` · [${k.tags.join(', ')}]`}
                    </div>
                  </div>
                  <div className="key-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={dead(k)}
                      onClick={() => {
                        void copy(k.install_cmd, k.token)
                        setCmd(k.install_cmd)
                        setExpires(k.expires_at)
                      }}
                    >
                      {copied === k.token ? 'copied' : 'Copy'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger-ghost"
                      disabled={k.revoked}
                      onClick={() => void revoke(k.token)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="keys-error">{error}</div>}
      </div>
    </section>
  )
}
