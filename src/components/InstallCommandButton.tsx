import { useState } from 'react'
import { createEnrollToken } from '../api/client'
import { copyFailureReason, copyText } from '../lib/clipboard'

type Props = {
  onNotify: (message: string) => void
}

/**
 * Copies a one-shot install command.
 *
 * Installing a machine is one action, so it is one click: mint a token, put the
 * command on the clipboard, say so. It used to be a page you had to visit and
 * then click again inside.
 *
 * The token is one-shot and dies in 24 hours on purpose. A command that gets
 * copied and forgotten then leaves nothing able to enroll a machine, and one
 * pasted into a chat log is worthless after a single use. A standing key is a
 * different decision — it lives on the Keys page, where you can see the list and
 * revoke one.
 */
export default function InstallCommandButton({ onNotify }: Props) {
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState<string | null>(null)

  const copy = async () => {
    setBusy(true)
    try {
      const res = await createEnrollToken({ ttl_sec: 86400 })
      if (await copyText(res.install_cmd)) {
        setManual(null)
        onNotify('install command copied · runs once, expires in 24h')
      } else {
        // The clipboard is the only delivery channel, so a failed copy means the
        // command is gone unless it is shown. Saying "copied" here would be a lie
        // the operator only discovers on the new machine.
        setManual(res.install_cmd)
        onNotify(copyFailureReason())
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const selectAll = (el: HTMLElement) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => void copy()}
        disabled={busy}
        title="Copy a one-shot install command"
      >
        {busy ? '…' : 'Install'}
      </button>
      {manual && (
        <div className="install-fallback" role="status">
          <div className="install-fallback-head">
            <span className="dim">copy failed — select this and copy it yourself</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setManual(null)}>
              Dismiss
            </button>
          </div>
          <pre className="install-cmd" onClick={(e) => selectAll(e.currentTarget)}>
            {manual}
          </pre>
        </div>
      )}
    </>
  )
}
