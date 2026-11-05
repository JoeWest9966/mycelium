// Copying to the clipboard is more fragile than it looks.
//
// navigator.clipboard only exists in a "secure context" — https, or localhost.
// This panel is routinely served over plain http on a tailnet address, where the
// API is simply undefined, and calling it throws. The old code caught that and
// blamed the browser, which sent people hunting for a permission setting that
// was never the problem.
//
// So: try the modern API when it is actually there, fall back to the ancient
// execCommand path (which works on insecure origins), and only admit defeat when
// both are gone.
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied by permission or policy — try the fallback rather than giving up.
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  // Keep it out of sight without using display:none, which makes it unselectable
  // in some browsers and therefore uncopyable.
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  document.body.appendChild(area)
  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

// What to tell the user when a copy attempt failed, given why.
export function copyFailureReason(): string {
  if (!window.isSecureContext) {
    return 'this page is served over http, so the browser hides the clipboard API — the fallback copy was refused too; select the text and copy it by hand'
  }
  return 'the browser refused clipboard access; select the text and copy it by hand'
}
