// Icons, inline. The panel has no icon dependency on purpose: five 20px glyphs
// are not worth 300 kB of tree-shaken library.

type Props = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

/** Fleet — two machines in a rack. */
export function FleetIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="3.5" width="18" height="7" rx="2" />
      <rect x="3" y="13.5" width="18" height="7" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  )
}

/** Warehouse — stacked shelves. */
export function WarehouseIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M4.5 10v9.5h15V10" />
      <path d="M9.5 19.5v-5h5v5" />
    </svg>
  )
}

/** Files — a folder. */
export function FilesIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  )
}

/** Install — a key. */
export function KeyIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="8" cy="8" r="4.2" />
      <path d="m11 11 8.5 8.5" />
      <path d="m16 16 2-2" />
    </svg>
  )
}

/** Audit — a log. */
export function AuditIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M5 4.5h11l3.5 3.5v11.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
      <path d="M8 10h8M8 13.5h8M8 17h5" />
    </svg>
  )
}
