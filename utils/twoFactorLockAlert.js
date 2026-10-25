const prisma = require('../config/prisma');
const { sendMail } = require('../config/mailer');

// Tache 1.4b : e-mail d'alerte quand un verrou de la 2e etape 2FA est pose.
// Contenu des mails : jamais d'adresse IP, de code, de jeton ni de lien.

// Une colonne de User par portee du verrou : la date de la derniere alerte envoyee.
const ALERT_COLUMN = {
  ip: 'twoFactorAlertIpAt',
  compte: 'twoFactorAlertAccountAt'
};
const ALERT_WINDOW_MINUTES = 60;

// Reserve le droit d'envoyer UNE alerte de cette portee pour ce compte, en une seule
// instruction : "mets la date de maintenant, sauf si une alerte date de moins d'une heure".
// Si 10 requetes arrivent en meme temps, la base n'en laisse passer qu'une (count === 1).
// Renvoie true si CETTE requete a gagne la reservation et doit envoyer le mail.
async function reserveAlert(userId, portee, windowMinutes = ALERT_WINDOW_MINUTES) {
  const column = ALERT_COLUMN[portee];
  if (!column) throw new Error('Portee inconnue : ' + portee);
  const now = new Date();
  const limit = new Date(now.getTime() - windowMinutes * 60 * 1000);
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ [column]: null }, { [column]: { lt: limit } }]
    },
    data: { [column]: now }
  });
  return result.count === 1;
}

// Date au format francais, heure de Paris (jamais le format americain).
function formatParisDate(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

// Fonction pure : fabrique les mails a envoyer, sans toucher a la base ni au reseau.
// portee 'ip' : un seul mail, pour le titulaire.
// portee 'compte' : le titulaire, plus les responsables actifs de sa societe.
function buildAlertMessages({ portee, user, managers = [], quand, maxIp, maxAccount, lockMinutes }) {
  const heure = formatParisDate(quand);
  const prenom = user.firstName || '';
  const salut = prenom ? 'Bonjour ' + prenom + ',' : 'Bonjour,';
  const subject = 'FlexCong\u00e9s : alerte de s\u00e9curit\u00e9 sur votre compte';

  if (portee === 'ip') {
    return [{
      to: user.email,
      subject,
      text: `${salut}\n\nUn code de v\u00e9rification incorrect a \u00e9t\u00e9 saisi ${maxIp} fois de suite sur votre compte FlexCong\u00e9s, apr\u00e8s la saisie correcte de votre mot de passe.\n\nPar pr\u00e9caution, la v\u00e9rification est bloqu\u00e9e pendant ${lockMinutes} minutes pour cette connexion.\n\nSi c'\u00e9tait vous, ignorez ce message. Sinon, quelqu'un conna\u00eet votre mot de passe : connectez-vous \u00e0 FlexCong\u00e9s d\u00e8s que possible et changez-le.\n\nHeure : ${heure} (heure de Paris).`
    }];
  }

  if (portee === 'compte') {
    const nom = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const messages = [{
      to: user.email,
      subject,
      text: `${salut}\n\n${maxAccount} codes de v\u00e9rification incorrects ont \u00e9t\u00e9 saisis sur votre compte FlexCong\u00e9s, depuis plusieurs connexions, apr\u00e8s la saisie correcte de votre mot de passe.\n\nPar pr\u00e9caution, la v\u00e9rification est bloqu\u00e9e pendant ${lockMinutes} minutes pour votre compte, quelle que soit la connexion.\n\nIl est peu probable que ce soit vous : quelqu'un conna\u00eet votre mot de passe. Changez-le d\u00e8s que possible (si la connexion est bloqu\u00e9e, utilisez la fonction de mot de passe oubli\u00e9).\n\nHeure : ${heure} (heure de Paris).`
    }];
    for (const manager of managers) {
      messages.push({
        to: manager.email,
        subject: 'FlexCong\u00e9s : alerte de s\u00e9curit\u00e9 sur un compte de votre \u00e9quipe',
        text: `Bonjour,\n\nLe compte de ${nom} a re\u00e7u ${maxAccount} codes de v\u00e9rification incorrects, depuis plusieurs connexions, apr\u00e8s la saisie correcte de son mot de passe.\n\nLe compte est bloqu\u00e9 pendant ${lockMinutes} minutes. Pr\u00e9venez la personne et conseillez-lui de changer son mot de passe.\n\nHeure : ${heure} (heure de Paris).`
      });
    }
    return messages;
  }

  throw new Error('Portee inconnue : ' + portee);
}

// Appelee par la route quand un verrou vient d'etre pose.
// Ne leve jamais d'erreur : une alerte en panne ne doit pas changer la reponse a l'utilisateur.
// Les requetes en base sont attendues ; l'envoi reseau ne l'est pas.
async function sendLockAlert(user, portee, { maxIp, maxAccount, lockMinutes }) {
  try {
    const reserved = await reserveAlert(user.id, portee);
    if (!reserved) return false;

    let managers = [];
    if (portee === 'compte') {
      managers = await prisma.user.findMany({
        where: { companyId: user.companyId, role: 'manager', isActive: true, id: { not: user.id } },
        select: { email: true }
      });
    }

    const messages = buildAlertMessages({
      portee, user, managers, quand: new Date(), maxIp, maxAccount, lockMinutes
    });
    for (const m of messages) {
      Promise.resolve(sendMail(m.to, m.subject, m.text))
        .catch(err => console.error("Erreur envoi alerte 2FA :", err.message));
    }
    return true;
  } catch (error) {
    console.error("Erreur alerte 2FA :", error.message);
    return false;
  }
}

module.exports = { reserveAlert, buildAlertMessages, sendLockAlert, formatParisDate };