import { useCallback, useRef, type ReactNode } from 'react'

/**
 * The page menu: a dock at the bottom of the window holding the actions that
 * belong to *this* view.
 *
 * The axis is worth stating once, because the two bars look alike:
 *
 *   nav (top)      switches between pages   — Fleet / Warehouse / Files / Install / Audit
 *   page menu      what you can do *here*   — supplied by the current view
 *
 * The page menu is a slot, not a component that knows things. Views hand it
 * items; when a view hands it nothing, the dock does not render. That is the
 * whole design: adding a page's menu is a list literal in that page, not an edit
 * to this file.
 *
 * Named for its job, not its position. It is a bottom dock today and would still
 * be called PageMenu if it moved to the side — `BottomBar` would become a lie.
 */

export type PageMenuItem = {
  /** Stable identity; also the React key. */
  key: string
  /** Tooltip and aria-label. One short sentence: this text has ~40px above an icon. */
  title: string
  icon: ReactNode
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
        role="toolbar"
        aria-label="Page actions"
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
                <button
                  type="button"
                  className={`page-menu-item${item.active ? ' active' : ''}`}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  aria-label={item.title}
                  aria-pressed={item.active === undefined ? undefined : item.active}
                >
                  {item.icon}
                  <span className="page-menu-tip">{item.title}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
