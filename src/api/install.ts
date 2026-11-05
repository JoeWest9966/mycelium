// One-click install.
//
// The browser asks the panel's own host to install hypha on a warehouse machine.
// The credential stays on that host: it goes straight from the warehouse's
// loopback API into one ssh, and the only thing that comes back here is the
// installer's output. There is deliberately no endpoint that hands this page a
// password.

import type { Host } from './types'

export const INSTALL_PATH = '/api/warehouse/install'

export type InstallEvent =
  | { step: 'secret' | 'token' | 'presence'; message: string }
  | { step: 'ssh'; message: string }
  | { step: 'log'; stream: 'out' | 'err'; line: string }
  | { step: 'done'; name: string; host: Host | null }
  | { step: 'error'; message: string; hint?: string | null; at?: string }

/**
 * Streams one install. Returns when the stream ends; the caller keeps whatever
 * it saw. Throws only when the transport itself breaks — protocol errors arrive
 * as an {step:'error'} event, because after the first byte the response is a 200.
 */
export async function installMachine(
  name: string,
  onEvent: (event: InstallEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(INSTALL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ name }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${INSTALL_PATH} answered ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.body) throw new Error(`${INSTALL_PATH} returned no body`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line. A partial frame stays in buf.
    let idx = buf.indexOf('\n\n')
    while (idx !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as InstallEvent)
        } catch {
          // A malformed frame is not worth killing an install over.
        }
      }
      idx = buf.indexOf('\n\n')
    }
  }
}
