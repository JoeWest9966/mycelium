/**
 * Pages are addresses.
 *
 * Every page has a URL — /warehouse, /files, /keys, /audit — so it can be
 * bookmarked, pasted to someone, and reloaded. The earlier version kept the
 * current page in React state only, which meant the address bar said "/" no
 * matter where you were: a reload always dropped you back on Fleet, and there was
 * nothing to link to.
 *
 * No router library. The whole mechanism is pushState, popstate and a lookup
 * table, and this app has three runtime dependencies that I would like to keep.
 */

export type View = 'fleet' | 'warehouse' | 'files' | 'keys' | 'audit'

/** The address each page lives at. Fleet is the root because it is the front door. */
export const PATHS: Record<View, string> = {
  fleet: '/',
  warehouse: '/warehouse',
  files: '/files',
  keys: '/keys',
  audit: '/audit',
}

/**
 * Path -> page, or null when the address means nothing.
 *
 * null is deliberate: silently showing Fleet at /wangpan would be a page that
 * lies about where you are, and the operator would never find out that the link
 * they saved is broken.
 */
export function viewForPath(pathname: string): View | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  for (const [view, path] of Object.entries(PATHS)) {
    if (path === clean) return view as View
  }
  return null
}
