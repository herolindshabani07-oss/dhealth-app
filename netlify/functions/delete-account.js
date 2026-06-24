/* GDPR — full account deletion.
   Deletes all of the user's data rows + the auth account.
   Requires env var SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard -> Settings -> API -> service_role). */

const SUPABASE_URL  = 'https://ppcvzvvlnaxiljjmdihk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwY3Z6dnZsbmF4aWxqam1kaWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjM1MjYsImV4cCI6MjA5MTkzOTUyNn0.iS1Fb80nxf6t5zsTk5loiNoPpg2kEj7_nCifWQZHJTo';

/* tables keyed by patient_id */
const PATIENT_TABLES = ['vitals','medical_profiles','daily_activity','daily_scores','therapy_alarms','meals','documents','reports','appointments'];

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  /* 1) Verify the caller's Supabase session and get their user id */
  let uid;
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    const verify = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token } });
    if (!verify.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session' }) };
    const u = await verify.json();
    uid = u && u.id;
    if (!uid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No user id' }) };
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authorization check failed' }) };
  }

  /* 2) Need the service-role key to delete data + the auth account */
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Server not configured for account deletion', code: 'no_service_key' }) };
  }
  const svc = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE };

  /* 3) Delete all data rows for this user */
  try {
    for (const t of PATIENT_TABLES) {
      await fetch(SUPABASE_URL + '/rest/v1/' + t + '?patient_id=eq.' + uid, { method: 'DELETE', headers: Object.assign({ Prefer: 'return=minimal' }, svc) });
    }
    /* profiles keyed by id; messages by sender/receiver */
    await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + uid, { method: 'DELETE', headers: Object.assign({ Prefer: 'return=minimal' }, svc) });
    await fetch(SUPABASE_URL + '/rest/v1/messages?sender_id=eq.' + uid, { method: 'DELETE', headers: Object.assign({ Prefer: 'return=minimal' }, svc) });
    await fetch(SUPABASE_URL + '/rest/v1/messages?receiver_id=eq.' + uid, { method: 'DELETE', headers: Object.assign({ Prefer: 'return=minimal' }, svc) });
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Data deletion failed: ' + e.message }) };
  }

  /* 4) Delete the auth account itself */
  try {
    const del = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + uid, { method: 'DELETE', headers: svc });
    if (!del.ok && del.status !== 404) {
      const txt = await del.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Auth deletion failed', detail: txt }) };
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Auth deletion error: ' + e.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: uid }) };
};
