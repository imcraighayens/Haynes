import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

export type ButtonVariant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'blue' | 'soft'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  block?: boolean
}

/**
 * Console button. Labels are uppercase like the prototype:
 * primary = lime pill (NEW LOAN), dark = black pill (LOG PETTY CASH),
 * blue = outlined blue (BULK UPLOAD), outline = hairline (ARRANGE).
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'outline', size = 'md', icon, block, className, children, style, ...rest },
  ref,
) {
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: 'var(--acc)', color: 'var(--accInk)', border: '1px solid transparent' },
    dark: { background: '#0b0b0a', color: '#f5f4ee', border: '1px solid var(--line2)' },
    outline: { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line2)' },
    ghost: { background: 'transparent', color: 'var(--mut)', border: '1px solid transparent' },
    danger: { background: 'var(--red)', color: '#fff', border: '1px solid transparent' },
    blue: { background: 'rgba(30,40,160,.35)', color: '#c9d2ff', border: '1px solid rgba(120,140,255,.55)' },
    soft: { background: 'var(--panel3)', color: 'var(--ink)', border: '1px solid var(--line)' },
  }
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold uppercase tracking-[0.02em] transition',
        'hover:brightness-110 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' && 'h-8 px-3.5 text-[11px]',
        size === 'md' && 'h-10 px-4 text-[12px]',
        size === 'lg' && 'h-12 px-6 text-[13px]',
        block && 'w-full',
        className,
      )}
      style={{ ...styles[variant], ...style }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx('inline-flex h-10 w-10 items-center justify-center rounded-full transition hover:brightness-125', className)}
      style={{ background: 'var(--panel)', border: '1px solid var(--line2)', color: 'var(--ink)' }}
      {...rest}
    >
      {children}
    </button>
  )
}
