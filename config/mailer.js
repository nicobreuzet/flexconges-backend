// Envoi d'e-mails via l'API HTTP de Brevo.
// Aucune dépendance : fetch est intégré à Node (18 et plus).
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 10000;

// Lit MAIL_FROM : "Nom <adresse@domaine>" ou simplement "adresse@domaine".
function parseFrom(raw) {
  const value = String(raw || '').trim();
  const m = value.match(/^"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (m) return { name: m[1].trim() || 'FlexCongés', email: m[2] };
  if (/^[^<>\s]+@[^<>\s]+$/.test(value)) return { name: 'FlexCongés', email: value };
  throw new Error('MAIL_FROM invalide (attendu : Nom <adresse@domaine>)');
}

// Appel réel à Brevo. Ne met JAMAIS la clé dans un message d'erreur.
async function deliver(apiKey, to, subject, text) {
  const sender = parseFrom(process.env.MAIL_FROM);
  let res;
  try {
    res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    throw new Error('Brevo injoignable : ' + (err && err.name ? err.name : 'erreur réseau'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      const d = await res.json();
      detail = [d.code, d.message].filter(Boolean).join(' - ');
    } catch (e) { /* corps illisible : on garde juste le code HTTP */ }
    throw new Error(`Brevo a refusé l'envoi (HTTP ${res.status})${detail ? ' : ' + detail : ''}`);
  }
}

async function sendMail(to, subject, text) {
  if (process.env.NODE_ENV === 'test') {
    return; // on n'envoie rien pendant les tests automatisés
  }
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BREVO_API_KEY manquante : e-mail non envoyé');
    }
    console.warn('BREVO_API_KEY absente : e-mail non envoyé (mode développement)');
    return;
  }
  await deliver(apiKey, to, subject, text);
}

module.exports = { sendMail, deliver, parseFrom };