import Anthropic from '@anthropic-ai/sdk';

/* Supabase (anon key është publik — përdoret vetëm për të verifikuar token-in e user-it) */
const SUPABASE_URL  = 'https://ppcvzvvlnaxiljjmdihk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwY3Z6dnZsbmF4aWxqam1kaWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjM1MjYsImV4cCI6MjA5MTkzOTUyNn0.iS1Fb80nxf6t5zsTk5loiNoPpg2kEj7_nCifWQZHJTo';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/* Netlify Functions v2 (ESM) — mbështet edhe streaming (text/plain) edhe përgjigje të plotë JSON.
   Thirrjet ekzistuese (pa stream) marrin SAKTË të njëjtën përgjigje JSON si më parë. */
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  /* ════ SIGURI: vetëm user të kyçur (token i vlefshëm Supabase) mund të përdorin AI-në ════ */
  try {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Authentication required' }, 401);
    const verify = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token }
    });
    if (!verify.ok) return json({ error: 'Invalid or expired session' }, 401);
  } catch (e) {
    return json({ error: 'Authorization check failed' }, 401);
  }

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Bad request body' }, 400); }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model:      body.model || 'claude-sonnet-4-5',
    max_tokens: body.max_tokens || 1000,
    system:     body.system || 'You are D Health AI Doctor.',
    messages:   body.messages || []
  };
  if (body.tools) params.tools = body.tools;

  /* ════ STREAMING: dërgon tekstin token-pas-token (text/plain) → raportet e gjata
     s'kapin kurrë limitin 10s, përdoruesi e sheh raportin tek shfaqet ════ */
  if (body.stream) {
    try {
      const anthropicStream = await client.messages.create({ ...params, stream: true });
      const encoder = new TextEncoder();
      const rs = new ReadableStream({
        async start(controller) {
          try {
            for await (const ev of anthropicStream) {
              if (ev && ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
                controller.enqueue(encoder.encode(ev.delta.text));
              }
            }
          } catch (e) {
            /* mbylle pa ndotur raportin — pjesa e marrë mbetet e dukshme */
          }
          controller.close();
        }
      });
      return new Response(rs, { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' } });
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }

  /* ════ JO-STREAM (backward-compatible — identik me sjelljen e mëparshme) ════ */
  try {
    const response = await client.messages.create(params);
    return json(response, 200);
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
