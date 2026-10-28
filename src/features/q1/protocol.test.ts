import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../domain/seed'
import { buildQ1Context, contextTurn, parseQ1Answer } from './protocol'

const T = '2026-10-26'

describe('Q1 context sent to Claude', () => {
  const book = buildSeed(T)
  const ctx = buildQ1Context(book, T, { name: 'Tester', role: 'admin' }, 'dashboard')
  const wire = contextTurn(ctx)

  it('never carries ID numbers, bank details, contact details, addresses or salaries', () => {
    for (const c of book.clients) {
      for (const v of [c.idNumber, c.accountNo, c.phone, c.email, c.address]) if (v) expect(wire).not.toContain(v)
      if (c.netSalary) expect(wire).not.toContain(`"netSalary"`)
    }
    expect(wire).not.toMatch(/idNumber|accountNo|branchCode|signature|"phone"|"email"|"address"|grossSalary/)
  })

  it('does carry what Q1 needs to answer about the book', () => {
    const l = book.loans.find((x) => x.status === 'issued')!
    expect(wire).toContain(l.ref)
    expect(wire).toContain(book.clients[0].name)
    expect(ctx.totals.collectionOutstanding).toBeGreaterThan(0)
    expect(ctx.attention.some((a) => a.kind === 'stale')).toBe(true)
  })
})

describe('parsing Claude’s answer', () => {
  it('reads clean JSON', () => {
    expect(parseQ1Answer('{"answer":"Two loans due.","actions":[{"kind":"open_loan","ref":"ECL-076","page":null,"label":"Open ECL-076"}]}')).toEqual({
      answer: 'Two loans due.',
      actions: [{ kind: 'open_loan', ref: 'ECL-076', page: null, label: 'Open ECL-076' }],
    })
  })
  it('tolerates a fenced reply and drops unknown action kinds and pages', () => {
    const r = parseQ1Answer('Here you go:\n```json\n{"answer":"Ok","actions":[{"kind":"delete_everything","ref":null,"page":null,"label":"x"},{"kind":"go","ref":null,"page":"nowhere","label":"Go"}]}\n```')
    expect(r.actions).toEqual([{ kind: 'go', ref: null, page: null, label: 'Go' }])
  })
  it('falls back to the raw text when it is not JSON', () => {
    expect(parseQ1Answer('Just text')).toEqual({ answer: 'Just text', actions: [] })
  })
})
