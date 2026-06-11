/* Netlify function: dërgon email mirëseardhjeje përmes Resend.
   Env vars: RESEND_API_KEY (kërkohet), WELCOME_FROM (opsional, p.sh. "D Health <noreply@dhealth.app>") */

exports.handler = async function(event){
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body  = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim();
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'email required' }) };

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };

    const from = process.env.WELCOME_FROM || 'D Health <onboarding@resend.dev>';
    const name = String(body.name || email.split('@')[0]).replace(/[<>]/g, '').slice(0, 60);

    const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;background:#0F1535;border-radius:18px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#3B7DD8,#8B6FE8);padding:30px;text-align:center;">
    <div style="font-size:34px;font-weight:800;color:#fff;letter-spacing:1px;">D&nbsp;Health</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">Sh&euml;ndeti yt, i monitoruar me kujdes</div>
  </div>
  <div style="padding:30px 26px;color:#E8EDF7;">
    <h2 style="font-size:21px;color:#fff;margin:0 0 12px;">Mir&euml; se erdhe, ${name}! &#127881;</h2>
    <p style="font-size:14px;line-height:1.7;color:rgba(232,237,247,0.85);margin:0 0 18px;">
      Llogaria jote n&euml; <strong>D Health</strong> u krijua me sukses. Tani mund t&euml;:
    </p>
    <div style="background:rgba(255,255,255,0.06);border-radius:14px;padding:16px 18px;margin:0 0 22px;">
      <div style="font-size:14px;color:#E8EDF7;line-height:2;">
        &#10084;&#65039; Monitorosh tensionin, pulsin, glukoz&euml;n &amp; SpO2<br>
        &#129302; Marr&euml;sh analiz&euml; AI t&euml; plot&euml; t&euml; sh&euml;ndetit<br>
        &#128138; Ndjek&euml;sh terapin&euml; dhe analizat laboratorike<br>
        &#128197; Rezervosh termine me Dr. Herolind Shabani
      </div>
    </div>
    <div style="text-align:center;margin:0 0 22px;">
      <a href="https://relaxed-pegasus-1e887c.netlify.app" style="display:inline-block;background:linear-gradient(135deg,#2DC8A0,#3B7DD8);color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 34px;border-radius:14px;">Hap D Health &#8594;</a>
    </div>
    <p style="font-size:12px;color:rgba(232,237,247,0.45);margin:0;line-height:1.6;">
      Ke nevoj&euml; p&euml;r ndihm&euml;? Thjesht p&euml;rgjigju k&euml;tij email-i.
    </p>
  </div>
  <div style="background:#0A0F26;padding:16px;text-align:center;font-size:11px;color:rgba(232,237,247,0.4);">&copy; 2026 D Health &middot; Dr. Herolind Shabani</div>
</div>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Mirë se erdhe në D Health! 🎉',
        html
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: (data && data.message) || 'send failed', data }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: data.id }) };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
