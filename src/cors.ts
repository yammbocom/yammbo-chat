// cors.ts
// Allow-list-based CORS for the chat widget. Only sites in the allow list
// (set via wrangler vars) can call this endpoint.

export function buildCorsHeaders(request: Request, allowedOrigins: string): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const isAllowed = allowed.includes(origin) || allowed.includes('*');

  return {
    'access-control-allow-origin': isAllowed ? origin : 'null',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

export function handlePreflight(request: Request, allowedOrigins: string): Response {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(request, allowedOrigins),
  });
}
