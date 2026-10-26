import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useTheme } from '../../store/theme'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import { DEFAULT_CLAUSES, DEFAULT_SETTINGS } from '../../domain/factories'
import { parseMoney } from '../../domain/format'
import type { Settings } from '../../domain/types'
import { Button } from '../../ui/Button'
import { Eyebrow, Field, Input, Segmented, Textarea } from '../../ui/bits'

type Draft = Omit<Settings, 'defaultReturnRatePct' | 'defaultCollectionFee' | 'protectionFee'> & {
  defaultReturnRatePct: string
  defaultCollectionFee: string
  protectionFee: string
}

const LABELS: Partial<Record<keyof Settings, string>> = {
  orgName: 'org name', orgLegalName: 'legal name', ncrRegNo: 'NCR reg no', companyRegNo: 'company reg no', tagline: 'tagline',
  address: 'address', contactEmail: 'contact email', contactPhone: 'contact phone', website: 'website', defaultReturnRatePct: 'default return rate',
  defaultCollectionFee: 'collection fee', protectionFee: 'protection fee', maskPii: 'PII masking', contractIntro: 'contract intro', contractClauses: 'contract clauses',
}

export function LedgerSettings() {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const { theme, toggle } = useTheme()
  const editable = !!user && can(user.role, 'settings.manage')
  const s = book.settings
  const initial = useMemo<Draft>(() => ({ ...s, defaultReturnRatePct: String(s.defaultReturnRatePct), defaultCollectionFee: String(s.defaultCollectionFee), protectionFee: String(s.protectionFee) }), [s])
  const [d, setD] = useState<Draft>(initial)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  const rate = parseMoney(d.defaultReturnRatePct), fee = parseMoney(d.defaultCollectionFee), tpf = parseMoney(d.protectionFee)
  const errors = {
    orgName: !d.orgName.trim() ? 'Required' : null,
    rate: !(rate >= 0 && rate <= 500) ? 'Enter a percentage' : null,
    fee: !(fee >= 0) ? 'Enter an amount' : null,
    tpf: !(tpf >= 0) ? 'Enter an amount' : null,
  }
  const valid = Object.values(errors).every((e) => !e)
  const next: Settings = {
    ...s,
    orgName: d.orgName.trim(),
    orgLegalName: d.orgLegalName.trim(),
    ncrRegNo: d.ncrRegNo.trim(),
    companyRegNo: d.companyRegNo.trim(),
    tagline: d.tagline.trim(),
    address: d.address.trim(),
    contactEmail: d.contactEmail.trim(),
    contactPhone: d.contactPhone.trim(),
    website: d.website.trim(),
    defaultReturnRatePct: rate,
    defaultCollectionFee: fee,
    protectionFee: tpf,
    maskPii: d.maskPii,
    contractIntro: d.contractIntro,
    contractClauses: d.contractClauses.map((c) => c.trim()).filter(Boolean),
  }
  const changed = (Object.keys(LABELS) as (keyof Settings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(s[k]))

  const save = () => {
    if (!valid || !changed.length) return
    const patch = Object.fromEntries(changed.map((k) => [k, next[k]])) as Partial<Settings>
    commit((b) => ops.updateSettings(b, patch, actor, `Changed ${changed.map((k) => LABELS[k]).join(', ')}`), 'Settings saved')
  }

  const clauses = d.contractClauses
  const moveClause = (i: number, dir: -1 | 1) => {
    const c = clauses.slice()
    const j = i + dir
    if (j < 0 || j >= c.length) return
    ;[c[i], c[j]] = [c[j], c[i]]
    set('contractClauses', c)
  }

  return (
    <div className="flex flex-col gap-4">
      {!editable && <div className="text-[12.5px]" style={{ color: 'var(--amber)' }}>Read-only — only an Admin can change settings.</div>}
      <fieldset disabled={!editable} className="contents">
        <section className="panel grid gap-4 p-6 md:grid-cols-3">
          <Eyebrow className="md:col-span-3">Organisation</Eyebrow>
          <Field label="Trading name" error={errors.orgName}><Input value={d.orgName} onChange={(e) => set('orgName', e.target.value)} /></Field>
          <Field label="Legal name"><Input value={d.orgLegalName} onChange={(e) => set('orgLegalName', e.target.value)} /></Field>
          <Field label="NCR registration no" hint="Printed on agreements and letters"><Input value={d.ncrRegNo} onChange={(e) => set('ncrRegNo', e.target.value)} placeholder="NCRCP…" /></Field>
          <Field label="Company registration no"><Input value={d.companyRegNo} onChange={(e) => set('companyRegNo', e.target.value)} placeholder="2023/000000/07" /></Field>
          <Field label="Tagline" hint="Under the logo on paid-up letters"><Input value={d.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
          <Field label="Website"><Input value={d.website} onChange={(e) => set('website', e.target.value)} placeholder="ecoloan.co.za" /></Field>
          <Field label="Physical address" className="md:col-span-3"><Input value={d.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Client queries email"><Input type="email" value={d.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
          <Field label="Client queries WhatsApp"><Input inputMode="tel" value={d.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+27 …" /></Field>
        </section>

        <section className="panel grid gap-4 p-6 md:grid-cols-3">
          <Eyebrow className="md:col-span-3">Pricing defaults</Eyebrow>
          <Field label="Default return rate (%)" error={errors.rate} hint="Simple, per advance. Applied to new loans."><Input inputMode="decimal" value={d.defaultReturnRatePct} onChange={(e) => set('defaultReturnRatePct', e.target.value)} /></Field>
          <Field label="Collection fee per debit (R)" error={errors.fee} hint="Added to each debit order instalment"><Input inputMode="decimal" value={d.defaultCollectionFee} onChange={(e) => set('defaultCollectionFee', e.target.value)} /></Field>
          <Field label="Protection fee on quotes (R / month)" error={errors.tpf} hint="Shown on settlement quotations; 0 to omit"><Input inputMode="decimal" value={d.protectionFee} onChange={(e) => set('protectionFee', e.target.value)} /></Field>
          <p className="text-[11.5px] md:col-span-3" style={{ color: 'var(--dim)' }}>Confirm rates and fees against the NCA caps with your compliance officer before changing them.</p>
        </section>

        <section className="panel flex flex-col gap-4 p-6">
          <Eyebrow>Privacy &amp; appearance</Eyebrow>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold">Mask ID and bank numbers</div>
              <div className="text-[12px]" style={{ color: 'var(--mut)' }}>Shows ••••••• 0086 until someone with permission reveals them. Reveals are logged.</div>
            </div>
            <Segmented value={d.maskPii ? 'on' : 'off'} onChange={(v) => set('maskPii', v === 'on')} options={[{ value: 'on', label: 'Masked' }, { value: 'off', label: 'Visible' }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold">Theme</div>
              <div className="text-[12px]" style={{ color: 'var(--mut)' }}>Saved on this device.</div>
            </div>
            <Segmented value={theme} onChange={(v) => v !== theme && toggle()} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </div>
        </section>

        <section className="panel flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Master credit agreement</Eyebrow>
            <span className="text-[11.5px]" style={{ color: 'var(--dim)' }}>Placeholders: {'{org}'} {'{client}'} {'{id}'} {'{rate}'}</span>
          </div>
          <Field label="Introduction"><Textarea value={d.contractIntro} onChange={(e) => set('contractIntro', e.target.value)} className="min-h-[96px]" /></Field>
          <div className="flex flex-col gap-2">
            {clauses.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-2.5 w-6 shrink-0 text-right text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{i + 1}.</span>
                <Textarea value={c} onChange={(e) => set('contractClauses', clauses.map((x, j) => (j === i ? e.target.value : x)))} className="!min-h-[52px]" aria-label={`Clause ${i + 1}`} />
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" onClick={() => moveClause(i, -1)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]" aria-label={`Move clause ${i + 1} up`}><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => moveClause(i, 1)} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]" aria-label={`Move clause ${i + 1} down`}><ArrowDown size={13} /></button>
                </div>
                <button type="button" onClick={() => set('contractClauses', clauses.filter((_, j) => j !== i))} className="mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--hover)]" style={{ color: 'var(--red)' }} aria-label={`Remove clause ${i + 1}`}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="soft" size="sm" icon={<Plus size={13} />} onClick={() => set('contractClauses', [...clauses, ''])}>Add clause</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setD((x) => ({ ...x, contractIntro: DEFAULT_SETTINGS.contractIntro, contractClauses: DEFAULT_CLAUSES }))}>Restore default wording</Button>
          </div>
        </section>
      </fieldset>

      {editable && (
        <div className="sticky bottom-4 z-10 mr-16 flex flex-wrap items-center justify-end gap-3 rounded-full px-4 py-3" style={{ background: 'var(--glass)', border: '1px solid var(--glassLine)', backdropFilter: 'blur(18px)', boxShadow: 'var(--shadow)' }}>
          <span className="mr-auto text-[12px]" style={{ color: 'var(--mut)' }}>{changed.length ? `${changed.length} unsaved change${changed.length > 1 ? 's' : ''}` : 'All changes saved'}</span>
          <Button variant="ghost" size="sm" disabled={!changed.length} onClick={() => setD(initial)}>Discard</Button>
          <Button variant="primary" size="sm" disabled={!changed.length || !valid} onClick={save}>Save settings</Button>
        </div>
      )}
    </div>
  )
}
