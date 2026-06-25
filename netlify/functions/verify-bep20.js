/* D Health — verify a BEP20 (BNB Smart Chain) USDT/USDC payment on-chain,
   record it, and activate Premium. Premium is granted ONLY here (server-side),
   never from the browser — RLS blocks clients from setting profiles.plan.

   Required env vars (Netlify → Site settings → Environment variables):
     SUPABASE_SERVICE_ROLE_KEY   (already set — service_role key)
     ETHERSCAN_API_KEY           (free from etherscan.io → API Keys; BscScan data is
                                  now served via Etherscan API V2 with chainid=56.
                                  Legacy name BSCSCAN_API_KEY is also accepted.)
   Optional env vars:
     BSC_API_BASE     default https://api.etherscan.io/v2/api
     BSC_CHAIN_ID     default 56  (BNB Smart Chain)
     PAY_PRICE_PREMIUM default 1.39  (set LOW e.g. 0.5 for the mini-test, then restore)
     PAY_MIN_CONF      default 3     (block confirmations required)
     ADMIN_EMAIL       default herolind30@gmail.com  (payment notification)
     RESEND_API_KEY    (already set for welcome-email) — enables the notification email
     WELCOME_FROM      sender, e.g. "D Health <noreply@dhealth.app>"
*/

const SUPABASE_URL  = 'https://ppcvzvvlnaxiljjmdihk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwY3Z6dnZsbmF4aWxqam1kaWhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjM1MjYsImV4cCI6MjA5MTkzOTUyNn0.iS1Fb80nxf6t5zsTk5loiNoPpg2kEj7_nCifWQZHJTo';

/* Our Binance BEP20 receiving address (public — safe). Same address for both tokens. */
const RECEIVER = '0x7baae749cbd2626d7826e3e5e036f5cd79524588'.toLowerCase();

/* BEP20 token contracts on BNB Smart Chain. NOTE: on BSC both use 18 decimals. */
const TOKENS = {
  USDT: { contract: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
  USDC: { contract: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 }
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function toUnits(amount, decimals){
  var parts = String(amount).split('.');
  var whole = parts[0] || '0';
  var frac  = (parts[1] || '').slice(0, decimals);
  while (frac.length < decimals) frac += '0';
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(frac || '0');
}
function fromUnits(value, decimals){
  var s = value.toString().padStart(decimals + 1, '0');
  var whole = s.slice(0, s.length - decimals);
  var frac  = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? (whole + '.' + frac) : whole;
}
function addr32(topic){ return ('0x' + String(topic).slice(-40)).toLowerCase(); }

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  /* 1) Verify the caller's session → user id + email (no guessing who paid) */
  let uid, userEmail;
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
    const verify = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + token } });
    if (!verify.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session' }) };
    const u = await verify.json();
    uid = u && u.id; userEmail = u && u.email;
    if (!uid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No user id' }) };
  } catch (e) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authorization check failed' }) };
  }

  /* 2) Parse + validate input */
  let txHash, asset, plan;
  try {
    const b = JSON.parse(event.body || '{}');
    txHash = String(b.tx_hash || '').trim().toLowerCase();
    asset  = String(b.asset || 'USDT').trim().toUpperCase();
    plan   = String(b.plan || 'premium').trim().toLowerCase();
  } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad request body' }) }; }

  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid transaction hash', code: 'bad_hash' }) };
  const TOKEN = TOKENS[asset];
  if (!TOKEN) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported asset (USDT/USDC only)', code: 'bad_asset' }) };

  /* 3) Config / secrets — BscScan data is served via Etherscan API V2 (chainid=56). */
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APIKEY  = process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY;
  if (!SERVICE) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Server not configured (service key)', code: 'no_service_key' }) };
  if (!APIKEY)  return { statusCode: 503, headers, body: JSON.stringify({ error: 'Server not configured (Etherscan/BscScan key)', code: 'no_bscscan_key' }) };

  const API_BASE = process.env.BSC_API_BASE || 'https://api.etherscan.io/v2/api';
  const CHAIN_ID = process.env.BSC_CHAIN_ID || '56';     // 56 = BNB Smart Chain
  const CHAIN_Q  = '?chainid=' + CHAIN_ID;
  const PRICE    = Number(process.env.PAY_PRICE_PREMIUM || 1.39);
  const MIN_CONF = Number(process.env.PAY_MIN_CONF || 3);
  const required = toUnits(PRICE, TOKEN.decimals);
  const svc = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };

  /* 4) Dedup — reject a tx_hash that was already claimed */
  try {
    const dup = await fetch(SUPABASE_URL + '/rest/v1/payments?tx_hash=eq.' + txHash + '&select=id,status,user_id', { headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE } });
    const rows = await dup.json().catch(() => []);
    if (Array.isArray(rows) && rows.length) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'This transaction was already used', code: 'tx_used' }) };
    }
  } catch (e) { /* non-fatal — unique constraint still protects */ }

  /* 5) Read the transaction receipt from BscScan */
  let receipt;
  try {
    const r = await fetch(API_BASE + CHAIN_Q + '&module=proxy&action=eth_getTransactionReceipt&txhash=' + txHash + '&apikey=' + APIKEY);
    const j = await r.json();
    receipt = j && j.result;
    if (!receipt) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Transaction not found yet — wait for confirmation and retry', code: 'tx_pending' }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Chain lookup failed: ' + e.message }) };
  }
  if (receipt.status !== '0x1') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Transaction failed on-chain', code: 'tx_failed' }) };

  /* 6) Confirmations */
  try {
    const bn = await fetch(API_BASE + CHAIN_Q + '&module=proxy&action=eth_blockNumber&apikey=' + APIKEY);
    const bj = await bn.json();
    const current = parseInt(bj.result, 16);
    const txBlock = parseInt(receipt.blockNumber, 16);
    const conf = current - txBlock + 1;
    if (conf < MIN_CONF) return { statusCode: 425, headers, body: JSON.stringify({ error: 'Not enough confirmations yet (' + conf + '/' + MIN_CONF + ') — retry in a moment', code: 'low_conf', confirmations: conf }) };
  } catch (e) { /* non-fatal — proceed if receipt is success */ }

  /* 7) Find the matching Transfer: right token → our address → amount >= price */
  let matched = null;
  const logs = receipt.logs || [];
  for (const lg of logs) {
    if (String(lg.address).toLowerCase() !== TOKEN.contract) continue;
    if (!lg.topics || lg.topics.length < 3) continue;
    if (String(lg.topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    if (addr32(lg.topics[2]) !== RECEIVER) continue;        // "to" must be our address
    const value = BigInt(lg.data);
    if (value >= required) { matched = { value, from: addr32(lg.topics[1]) }; break; }
  }
  if (!matched) {
    return { statusCode: 400, headers, body: JSON.stringify({
      error: 'No matching ' + asset + ' payment of ≥ ' + PRICE + ' to the expected address was found in this transaction',
      code: 'no_match'
    }) };
  }

  const amountHuman = fromUnits(matched.value, TOKEN.decimals);

  /* 8) Record the payment (service_role bypasses RLS) */
  let payRow;
  try {
    const ins = await fetch(SUPABASE_URL + '/rest/v1/payments', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=representation' }, svc),
      body: JSON.stringify({
        user_id: uid, email: userEmail, method: 'crypto', asset: asset, network: 'BEP20',
        amount: Number(amountHuman), tx_hash: txHash, status: 'confirmed', plan: plan,
        confirmed_at: new Date().toISOString(),
        raw: { from: matched.from, to: RECEIVER, contract: TOKEN.contract, block: receipt.blockNumber }
      })
    });
    if (ins.status === 409) return { statusCode: 409, headers, body: JSON.stringify({ error: 'This transaction was already used', code: 'tx_used' }) };
    if (!ins.ok) { const t = await ins.text(); return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not record payment', detail: t }) }; }
    const arr = await ins.json().catch(() => []); payRow = Array.isArray(arr) ? arr[0] : arr;
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Record payment error: ' + e.message }) };
  }

  /* 9) Activate Premium on the profile */
  try {
    await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + uid, {
      method: 'PATCH',
      headers: Object.assign({ Prefer: 'return=minimal' }, svc),
      body: JSON.stringify({ plan: plan })
    });
  } catch (e) { /* payment recorded; profile patch best-effort, logged below */ }

  /* 10) Notify admin (best-effort, non-blocking) */
  try {
    const RESEND = process.env.RESEND_API_KEY;
    if (RESEND) {
      const admin = process.env.ADMIN_EMAIL || 'herolind30@gmail.com';
      const from  = process.env.WELCOME_FROM || 'D Health <onboarding@resend.dev>';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [admin],
          subject: '💰 New payment — ' + amountHuman + ' ' + asset + ' (' + (userEmail || uid) + ')',
          html: '<div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto">' +
                '<h2 style="color:#15a06a">💰 Payment confirmed</h2>' +
                '<table style="font-size:14px;line-height:1.9">' +
                '<tr><td><b>User</b></td><td>' + (userEmail || uid) + '</td></tr>' +
                '<tr><td><b>Amount</b></td><td>' + amountHuman + ' ' + asset + ' (BEP20)</td></tr>' +
                '<tr><td><b>Plan</b></td><td>' + plan + '</td></tr>' +
                '<tr><td><b>Tx</b></td><td><a href="https://bscscan.com/tx/' + txHash + '">' + txHash.slice(0, 18) + '…</a></td></tr>' +
                '</table><p style="color:#888;font-size:12px">D Health · Payments</p></div>'
        })
      });
    }
  } catch (e) { /* notification is non-critical */ }

  return { statusCode: 200, headers, body: JSON.stringify({
    ok: true, status: 'confirmed', asset, network: 'BEP20',
    amount: amountHuman, tx_hash: txHash, plan, payment_id: payRow && payRow.id
  }) };
};
