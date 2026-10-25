require('dotenv').config();

const express = require('express');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const leaveRequestsRoutes = require('./routes/leaveRequests');
const balancesRoutes = require('./routes/balances');
const holidaysRoutes = require('./routes/holidays');
const leaveTypesRoutes = require('./routes/leaveTypes');
const companyRoutes = require('./routes/company');
const teamsRoutes = require('./routes/teams');
const twoFactorRoutes = require('./routes/twoFactor');
const sessionsRoutes = require('./routes/sessions');
const cors = require('cors');
const helmet = require('helmet');
const app = express();

// Derrière Render, l'adresse du visiteur est la 3e en partant de l'application :
// visiteur -> Cloudflare -> relais interne Render -> application.
// Mesuré en production le 3/10/2026 (si l'IP du journal redevient 10.x ou 172.x, revoir ce nombre).
app.set('trust proxy', 3);
const PORT = process.env.PORT || 3000;

app.use(helmet()); // en-tetes de securite (nosniff, anti-clickjacking, HSTS...), retire X-Powered-By
app.use(cors()); // autorise toutes les origines (pratique en développement)
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bienvenue sur l\'API FlexCongés !');
});

// Limites anti-force-brute (voir middlewares/rateLimit.js)
const { authIpLimiter, loginEmailLimiter, forgotPasswordIpLimiter, registerIpLimiter } = require('./middlewares/rateLimit');
app.use(['/login', '/reset-password'], authIpLimiter);
app.use('/login', loginEmailLimiter); // ignore /login/verify-2fa (pas d'e-mail dans la requête)
app.use('/forgot-password', forgotPasswordIpLimiter);
app.use('/register', registerIpLimiter);

app.use('/', authRoutes);
app.use('/', usersRoutes);
app.use('/', leaveRequestsRoutes);
app.use('/', balancesRoutes);
app.use('/', holidaysRoutes);
app.use('/', leaveTypesRoutes);
app.use('/', companyRoutes);
app.use('/', teamsRoutes);
app.use('/', twoFactorRoutes);
app.use('/', sessionsRoutes);

// Filet de securite : toute erreur non geree (JSON mal forme, route sans try/catch...)
// renvoie du JSON generique, jamais de trace ni de message technique.
const { sendError } = require('./utils/httpErrors');
app.use((err, req, res, next) => sendError(req, res, err));

if (require.main === module) {
  // Démarrage refusé sans clé de chiffrement 2FA valide : mieux vaut un déploiement qui
  // échoue tout de suite (Render garde alors l'ancienne version en ligne) qu'un serveur
  // qui découvre le problème à la première connexion 2FA.
  try {
    require('./utils/twoFactorCrypto').assertKeyConfigured();
  } catch (error) {
    console.error(`Démarrage refusé : ${error.message}`);
    process.exit(1);
  }
  app.listen(PORT, () => {
    // Purge du journal d'audit (> 12 mois) : uniquement au vrai demarrage, jamais dans les tests
    require('./utils/auditPurge').startAuditPurge();
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;