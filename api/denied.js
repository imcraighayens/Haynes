// CDN rewrites send non-staff hosts here instead of /ledger and the staff APIs.
// 404, no body details, no cookie.
export default function handler(_req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end('Not found');
}
