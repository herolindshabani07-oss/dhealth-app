const Anthropic = require('@anthropic-ai/sdk');

/* Supabase (anon key është publik — përdoret vetëm për të verifikuar token-in e user-it) */
const SUPABASE_URL  = 'https://ppcvzvvlnaxiljjmdihk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwY3Z6dnZsbmF4aWxqam1kaWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjM1MjYsImV4cCI6MjA5MTkzOTUyNn0.iS1Fb80nxf6t5zsTk5loiNoPpg2kEj7_nCifWQZHJTo';

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  /* ════ SIGURI: vetëm user të kyçur (token i vlefshëm Supabase) mund të përdorin AI-në ════ */
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    }
    const verify = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token }
    });
    if (!verify.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session' }) };
    }
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authorization check failed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: body.model || 'claude-sonnet-4-5',
      max_tokens: body.max_tokens || 1000,
      system: body.system || 'You are D Health AI Doctor.',
      messages: body.messages || []
    });

    return { statusCode: 200, headers, body: JSON.stringify(response) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
