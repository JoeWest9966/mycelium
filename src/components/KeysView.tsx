import { useCallback, useEffect, useState } from 'react'
import { createEnrollToken, listEnrollTokens, revokeEnrollToken } from '../api/client'
import { copyFailureReason, copyText } from '../lib/clipboard'
import type { EnrollTokenInfo } from '../api/types'

/**
 * Standing enroll keys.
 *
 * The one-shot install command lives in the topbar Install button — that is the
 * path for a new machine, and it leaves nothing behind. This page is the other
 * decision: a key that enrolls as many machines as you like for 30 days. That
 * one is worth having, but it should be created on purpose, listed, and
 * revocable when it leaks.
 */
export default function KeysView() {
  const [label, setLabel] = useState('')
  const [keys, setKeys] = useState<EnrollTokenInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await createEnrollToken({ reusable: true, label: label.trim() })
      setLabel('')
      await loadKeys()
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
    if (!(await copyText(text))) {
      setError(copyFailureReason())
      return
    }
    setError(null)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }

  const dead = (k: EnrollTokenInfo) => k.revoked || k.expires_at * 1000 < Date.now()

  return (
    <section className="panel keys" aria-label="Enroll keys">
      <div className="panel-head">
        <h2 className="panel-title">Enroll keys</h2>
      </div>

      <div className="keys-body">
        <p className="hint dim">
          Enrolls as many machines as you like for 30 days. For a single machine use{' '}
          <strong>Install</strong> up top — that one is a one-shot command and expires in 24 hours.
        </p>

        <div className="keys-form">
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="name, e.g. homelab"
            maxLength={64}
            aria-label="Key name"
          />
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
            {busy ? '…' : 'Create key'}
          </button>
        </div>

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
                    onClick={() => void copy(k.install_cmd, k.token)}
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

        {error && <div className="keys-error">{error}</div>}
      </div>
    </section>
  )
}
