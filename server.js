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
const cors = require('cors');
const app = express();

// Derrière Render, l'adresse du visiteur est la 3e en partant de l'application :
// visiteur -> Cloudflare -> relais interne Render -> application.
// Mesuré en production le 3/10/2026 (si l'IP du journal redevient 10.x ou 172.x, revoir ce nombre).
app.set('trust proxy', 3);
const PORT = process.env.PORT || 3000;

app.use(cors()); // autorise toutes les origines (pratique en développement)
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Bienvenue sur l\'API FlexCongés !');
});

app.use('/', authRoutes);
app.use('/', usersRoutes);
app.use('/', leaveRequestsRoutes);
app.use('/', balancesRoutes);
app.use('/', holidaysRoutes);
app.use('/', leaveTypesRoutes);
app.use('/', companyRoutes);
app.use('/', teamsRoutes);
app.use('/', twoFactorRoutes);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;