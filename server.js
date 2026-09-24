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
const cors = require('cors');
const app = express();
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;