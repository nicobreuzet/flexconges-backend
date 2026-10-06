const rateLimit = require('express-rate-limit');

// En test (Jest) on désactive les limites, sauf si un test les réactive explicitement
// avec ENABLE_RATE_LIMIT_IN_TESTS=1. Sinon les tests, qui se connectent tous depuis la
// même IP avec les mêmes e-mails, se bloqueraient entre eux.
const skipInTests = () =>
  process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== '1';

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function emailKey(req) {
  return String((req.body && req.body.email) || '').trim().toLowerCase();
}

// 1) Par adresse IP : seules les connexions ÉCHOUÉES comptent (une réussite ne consomme rien).
const authIpLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: 'Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes.' }
});

// 2) Par e-mail : protège un compte précis, même si l'attaquant change d'adresse IP.
const loginEmailLimiter = rateLimit({
  windowMs: FIFTEEN_MIN,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: emailKey,
  skip: (req) => skipInTests() || !emailKey(req),
  message: { error: 'Trop de tentatives pour ce compte. Réessayez dans 15 minutes.' }
});

// 3) Routes qui envoient un e-mail ou créent un compte : on limite tout, même les succès.
const sensitiveIpLimiter = rateLimit({
  windowMs: ONE_HOUR,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: 'Trop de demandes depuis cette adresse. Réessayez plus tard.' }
});

module.exports = { authIpLimiter, loginEmailLimiter, sensitiveIpLimiter };