import { useCallback, useRef, type ReactNode } from 'react'

/**
 * The page menu: the dock at the bottom of the window that switches pages.
 *
 * It lives at the bottom because that is where a hand already is, and because
 * the top of the window is for state you read (how many hosts, which version)
 * rather than things you click.
 *
 * It is a slot: the caller hands it a list, the component lays it out and draws
 * the dock. Named for its job rather than its position — it is a bottom dock
 * today and would still be `PageMenu` if it moved; `BottomBar` would be a lie the
 * day it did.
 */

export type PageMenuItem = {
  /** Stable identity; also the React key. */
  key: string
  /** Tooltip and aria-label. One short sentence: this text has ~40px above an icon. */
  title: string
  icon: ReactNode
  /**
   * Real address of the page. Present means this item renders as a link, so the
   * middle mouse button, ⌘-click and "copy link address" all behave the way a
   * page switcher is expected to behave.
   */
  href?: string
  onClick: () => void
  /** Toggled state, for things like "select all" that have an off position. */
  active?: boolean
  disabled?: boolean
  /**
   * Items with a different group draw a divider before them. Two groups is the
   * current shape (things you read vs things that change state); more is fine.
   */
  group?: string
}

const MAX_SCALE = 1.45
// How far away the pointer starts growing an icon, in px.
const REACH = 110

export default function PageMenu({ items }: { items: PageMenuItem[] }) {
  const dock = useRef<HTMLDivElement | null>(null)
  const slots = useRef(new Map<string, HTMLDivElement>())
  const frame = useRef(0)

  /**
   * The magnify effect, without a spring library.
   *
   * The bounce in the reference comes from per-icon springs; here it is one
   * mouse-distance curve plus a CSS transition. The difference is invisible at
   * 20px icons and it keeps the panel dependency-free — this app has exactly
   * three runtime dependencies and I would like to keep it that way.
   */
  const magnify = useCallback((clientX: number | null) => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      for (const [, el] of slots.current) {
        if (clientX === null || reduce) {
          el.style.setProperty('--scale', '1')
          continue
        }
        const rect = el.getBoundingClientRect()
        const distance = Math.abs(clientX - (rect.left + rect.width / 2))
        const t = Math.max(0, 1 - distance / REACH)
        el.style.setProperty('--scale', (1 + (MAX_SCALE - 1) * t * t).toFixed(3))
      }
    })
  }, [])

  if (items.length === 0) return null

  return (
    <div className="page-menu-wrap">
      <div
        className="page-menu"
        ref={dock}
        role="navigation"
        aria-label="Views"
        onMouseMove={(e) => magnify(e.clientX)}
        onMouseLeave={() => magnify(null)}
        onBlur={() => magnify(null)}
      >
        {items.map((item, i) => {
          const previous = items[i - 1]
          const divider = previous !== undefined && item.group !== previous.group
          return (
            <div className="page-menu-cell" key={item.key}>
              {divider && <span className="page-menu-divider" aria-hidden="true" />}
              <div
                className="page-menu-slot"
                ref={(el) => {
                  if (el) slots.current.set(item.key, el)
                  else slots.current.delete(item.key)
                }}
              >
                {item.href ? (
                  <a
                    className={`page-menu-item${item.active ? ' active' : ''}`}
                    href={item.href}
                    onClick={(e) => {
                      // Modified clicks keep their native meaning: open in a new
                      // tab, new window, download. Only an ordinary left click is
                      // ours to intercept.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                      e.preventDefault()
                      item.onClick()
                    }}
                    aria-label={item.title}
                    aria-current={item.active ? 'page' : undefined}
                  >
                    {item.icon}
                    <span className="page-menu-tip">{item.title}</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className={`page-menu-item${item.active ? ' active' : ''}`}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    aria-label={item.title}
                    aria-current={item.active ? 'page' : undefined}
                  >
                    {item.icon}
                    <span className="page-menu-tip">{item.title}</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
