import { ArrowLeftRight } from 'lucide-react'

/**
 * Market strip. Figures are static reference values — there is no live
 * market feed yet — so the strip says INDICATIVE rather than implying live data.
 */
const ROWS: [string, string, number][] = [
  ['USD/ZAR', '18.42', -0.3],
  ['EUR/ZAR', '20.05', 0.1],
  ['GBP/ZAR', '23.71', -0.2],
  ['JSE ALSI', '79 420', 0.6],
  ['BRENT', '$84.10', 0.4],
  ['GOLD', '$2 016', 0.2],
  ['REPO', '8.25%', 0],
  ['PRIME', '11.75%', 0],
]

export function Ticker() {
  const items = [...ROWS, ...ROWS]
  return (
    <div className="flex h-[34px] items-stretch overflow-hidden rounded-full" style={{ background: '#08080a', border: '1px solid var(--line)' }}>
      <div className="z-10 flex shrink-0 items-center gap-2 rounded-full px-4 text-[10.5px] font-bold tracking-[0.12em]" style={{ background: 'var(--acc)', color: 'var(--accInk)' }} title="Indicative reference figures — not a live feed">
        MARKETS <ArrowLeftRight size={12} />
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="ticker-track flex w-max items-center gap-9 whitespace-nowrap py-2 pl-6 text-[12.5px]">
          {items.map(([k, v, ch], i) => (
            <span key={i} className="flex items-center gap-2" style={{ color: '#d8d6cc' }}>
              <span className="font-medium" style={{ color: '#a7a598' }}>{k}</span>
              <span className="font-semibold text-white">{v}</span>
              <span style={{ color: ch > 0 ? 'var(--tlG)' : ch < 0 ? 'var(--tlR)' : '#8a8778' }}>{ch > 0 ? '+' : ''}{ch.toFixed(1)}%</span>
            </span>
          ))}
        </div>
      </div>
      <div className="hidden shrink-0 items-center px-4 text-[9.5px] font-semibold tracking-[0.14em] md:flex" style={{ color: '#8a8778' }}>INDICATIVE</div>
    </div>
  )
}
