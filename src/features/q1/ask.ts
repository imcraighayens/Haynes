/**
 * Where Q1's answers come from, in order:
 *  1. preview — inside a claude.ai Artifact viewer, the page's `sample`
 *     capability asks Claude on the viewer's own Claude account.
 *  2. server  — the deployed console calls POST /api/q1 (Vercel), which holds
 *     the Anthropic key and checks the Supabase sign-in.
 *  3. offline — neither is available: the deterministic answers in brain.ts,
 *     clearly labelled as not AI.
 */
import { supabase } from '../../lib/supabase'
import { contextTurn, parseQ1Answer, Q1_SYSTEM, type Q1Answer, type Q1Context, type Q1Turn } from './protocol'

export type Q1Source = 'preview' | 'server' | 'offline'

type SampleFn = ((input: { role: 'user' | 'assistant'; content: string }[], opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: (input: { role: 'user' | 'assistant'; content: string }[], opts?: Record<string, unknown>) => Promise<unknown>
}

declare global {
  interface Window {
    claude?: { use?: (name: string) => Promise<unknown> }
  }
}

let samplePromise: Promise<SampleFn | null> | null = null
function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    samplePromise =
      typeof window !== 'undefined' && window.claude?.use
        ? window.claude.use('sample').then((s) => (s as SampleFn | null) ?? null, () => null)
        : Promise.resolve(null)
  }
  return samplePromise
}

/** Server availability is learned from the first call (404 = no function deployed). */
let serverState: 'unknown' | 'up' | 'down' = 'unknown'
let serverWhy = ''

export async function q1Source(): Promise<Q1Source> {
  if (await getSample()) return 'preview'
  if (serverState === 'down') return 'offline'
  return supabase ? 'server' : 'offline'
}

export function offlineReason(): string {
  return serverWhy || (supabase ? '' : 'No database is connected, so the AI service has no secure sign-in to check.')
}

export class Q1Unavailable extends Error {}

export interface AskResult extends Q1Answer {
  source: Q1Source
  model?: string
}

export async function askQ1(question: string, history: Q1Turn[], ctx: Q1Context, signal?: AbortSignal): Promise<AskResult> {
  const sample = await getSample()
  if (sample) {
    // Memoryless call: instructions + book + the page-kept conversation, ending on the question.
    const turns = [
      { role: 'user' as const, content: `${Q1_SYSTEM}\n\n${contextTurn(ctx)}` },
      ...history.slice(-12),
      { role: 'user' as const, content: question },
    ]
    try {
      const raw = await sample.json(turns, { cache: false, modelTier: 'default', signal })
      return { ...parseQ1Answer(raw), source: 'preview' }
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'cancelled') throw e
      if (code === 'invalid_json') return { ...parseQ1Answer((e as { text?: string }).text ?? ''), source: 'preview' }
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared') {
        samplePromise = Promise.resolve(null)
        throw new Q1Unavailable('Claude is not allowed for this page — answering offline.')
      }
      if (code === 'rate_limited') throw new Error('Q1 is being asked too often right now — try again in a minute.')
      throw new Error('Q1 could not reach Claude just now. Try again.')
    }
  }

  if (supabase && serverState !== 'down') {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Q1Unavailable('Sign in again to use Q1.')
    const r = await fetch('/api/q1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ question, history: history.slice(-12), context: ctx }),
      signal,
    })
    if (r.status === 404 || r.status === 405) {
      serverState = 'down'
      serverWhy = 'The AI service is not deployed on this host (it runs on Vercel).'
      throw new Q1Unavailable(serverWhy)
    }
    const body = (await r.json().catch(() => ({}))) as Partial<AskResult> & { error?: string; message?: string }
    if (r.status === 503) {
      serverState = 'down'
      serverWhy = body.message || 'The AI service is not configured yet.'
      throw new Q1Unavailable(serverWhy)
    }
    if (r.status === 403 || r.status === 401) throw new Q1Unavailable(body.message || 'Your account is not allowed to use Q1.')
    if (r.status === 429) throw new Error('Q1 is busy — try again in a minute.')
    if (!r.ok) throw new Error('Q1 could not answer just now. Try again.')
    serverState = 'up'
    return { ...parseQ1Answer(body), source: 'server', model: body.model }
  }

  throw new Q1Unavailable(offlineReason())
}
