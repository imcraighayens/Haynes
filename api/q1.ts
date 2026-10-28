/**
 * POST /api/q1 — Q1's answers from Claude, on Vercel.
 *
 * The Anthropic key lives only here (ANTHROPIC_API_KEY, a server env var —
 * never VITE_-prefixed, so it is never bundled into the browser). Callers
 * must be signed in to Supabase as an active team member: the function
 * checks the bearer token against Supabase and the schema's is_staff() before
 * spending anything. The browser sends the minimised book snapshot built by
 * buildQ1Context (no ID numbers, bank details or contact details).
 */
import Anthropic from '@anthropic-ai/sdk'
import { parseQ1Answer, Q1_ANSWER_SCHEMA, Q1_MODEL, Q1_SYSTEM, type Q1Turn } from '../src/features/q1/protocol'

const MAX_BODY = 600_000
const MAX_TURNS = 12

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

async function isStaff(token: string): Promise<boolean> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !anon) return false
  const r = await fetch(`${url}/rest/v1/rpc/is_staff`, {
    method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  return r.ok && (await r.json()) === true
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' })
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthenticated' })
  if (!(await isStaff(token))) return json(403, { error: 'forbidden', message: 'Sign in as an active team member to use Q1.' })

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'too_large' })
  let body: { question?: unknown; history?: unknown; context?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'bad_json' })
  }
  const question = String(body.question ?? '').trim().slice(0, 2000)
  if (!question) return json(400, { error: 'empty_question' })
  const history = (Array.isArray(body.history) ? (body.history as Q1Turn[]) : [])
    .filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-MAX_TURNS)
    .map((t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.content.slice(0, 4000) }))

  const client = new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: Q1_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: Q1_SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: Q1_ANSWER_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        // Consecutive user turns are read as one: the book snapshot leads the conversation.
        { role: 'user', content: `BOOK DATA (current, JSON):\n${JSON.stringify(body.context ?? {})}` },
        ...history,
        { role: 'user', content: question },
      ],
    })
    if (response.stop_reason === 'refusal') return json(200, { answer: 'I can’t help with that one. Try rephrasing, or ask about the book.', actions: [], model: response.model })
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return json(200, { ...parseQ1Answer(text), model: response.model, truncated: response.stop_reason === 'max_tokens' })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json(429, { error: 'rate_limited' })
    if (e instanceof Anthropic.AuthenticationError) return json(503, { error: 'not_configured', message: 'The server’s Anthropic key was rejected.' })
    if (e instanceof Anthropic.APIError) return json(502, { error: 'upstream', status: e.status })
    return json(500, { error: 'server' })
  }
}
