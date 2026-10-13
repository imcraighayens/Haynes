// CORS + JSON helpers shared by the Quik1 edge functions.
const ALLOWED = (Deno.env.get('QUIK1_ALLOWED_ORIGINS') ?? 'capacitor://localhost,http://localhost,https://localhost')
  .split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  return {
    'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'content-type': 'application/json' } });
}

/** A failure the app can show: `code` maps to a toast in the client. */
export class AppError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
    if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof AppError) return json(req, { error: e.code }, e.status);
      console.error(e);
      return json(req, { error: 'SERVER_ERROR' }, 500);
    }
  };
}
