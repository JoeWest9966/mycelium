// Icons, inline. The panel has no icon dependency on purpose: four 16px glyphs
// are not worth 300 kB of tree-shaken library, and a stroke-based set stays
// legible at the 20px the dock uses.

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

export function RefreshIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

export function CheckAllIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3 7.5 5.5 10 10 5" />
      <path d="M3 16.5 5.5 19 10 14" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  )
}

export function ClearSelectionIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m8.5 8.5 7 7" />
      <path d="m15.5 8.5-7 7" />
    </svg>
  )
}

export function TerminalIcon({ size = 20 }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="m7 9.5 2.5 2.5L7 14.5" />
      <path d="M12.5 15h4.5" />
    </svg>
  )
}
