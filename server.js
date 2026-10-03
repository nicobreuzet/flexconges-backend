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

// Derrière le proxy de Render, sans ceci req.ip serait l'adresse du proxy et non celle du visiteur
app.set('trust proxy', 1);
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