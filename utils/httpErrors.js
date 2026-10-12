// Reponse d erreur unique pour les cas INATTENDUS.
// Cote client : jamais de message technique (noms de tables, de champs, traces...).
// Cote logs : le nom de l erreur, son code et la 1re ligne du message, JAMAIS les valeurs
// (un message Prisma peut contenir les donnees envoyees, par exemple un hash de mot de passe).

function firstLine(message) {
  const line = String(message || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.slice(0, 200);
}

function sendError(req, res, error) {
  const name = (error && error.name) || 'Error';
  const code = (error && error.code) || '';
  console.error(
    'Erreur ' + ((req && req.method) || '?') + ' ' + ((req && req.path) || '?') + ' : ' +
    name + (code ? ' ' + code : '') + ' - ' + firstLine(error && error.message)
  );

  if (res.headersSent) return;

  const status = Number(error && error.status);
  if (status >= 400 && status < 500 && error.expose) {
    return res.status(status).json({ error: 'Requ\u00eate invalide.' }); // ex : JSON mal forme
  }
  if (code === 'P2002') return res.status(409).json({ error: 'Cette valeur existe d\u00e9j\u00e0.' });
  if (code === 'P2025') return res.status(404).json({ error: '\u00c9l\u00e9ment introuvable.' });
  if (code === 'P2003') return res.status(409).json({ error: "Op\u00e9ration impossible : cet \u00e9l\u00e9ment est li\u00e9 \u00e0 d'autres donn\u00e9es." });
  if (name === 'PrismaClientValidationError' || name === 'RangeError' || name === 'SyntaxError') {
    return res.status(400).json({ error: 'Donn\u00e9es invalides.' });
  }
  return res.status(500).json({ error: 'Erreur interne du serveur.' });
}

module.exports = { sendError };