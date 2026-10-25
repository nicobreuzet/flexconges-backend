const crypto = require('crypto');
const prisma = require('../config/prisma');
const { normalizeEmail } = require('./normalizeEmail');

// Un lien d'invitation reste valable 7 jours.
const INVITATION_VALID_DAYS = 7;

// Un jeton est 32 octets aleatoires ecrits en hexadecimal minuscule (64 caracteres).
const TOKEN_FORMAT = /^[0-9a-f]{64}$/;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Renvoie le jeton (a donner a la personne) et son empreinte (la seule chose gardee en base).
function generateInvitationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: sha256Hex(token) };
}

// Renvoie l'empreinte d'un jeton, ou null si la valeur n'a pas le format d'un de nos jetons.
function hashInvitationToken(value) {
  if (typeof value !== 'string' || !TOKEN_FORMAT.test(value)) return null;
  return sha256Hex(value);
}

// Cree une invitation pour une adresse. Le jeton en clair n'existe QUE dans la valeur renvoyee.
async function createInvitation(rawEmail, { days = INVITATION_VALID_DAYS, now = new Date() } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error('Adresse e-mail invalide');
  if (!Number.isInteger(days) || days <= 0) throw new Error('Dur\u00e9e invalide');

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const invitation = await prisma.companyInvitation.create({
    data: { tokenHash, email, expiresAt }
  });
  return { token, invitation };
}

// Construit le lien a donner a la personne invitee. Le jeton est dans le FRAGMENT (apres #) :
// un fragment n'est jamais envoye au serveur, donc il n'apparait ni dans ses journaux ni dans l'en-tete Referer.
function buildInvitationLink(frontUrl, token) {
  let url;
  try {
    if (typeof frontUrl !== 'string') throw new Error('type');
    url = new URL(frontUrl);
  } catch (e) {
    throw new Error('Adresse du front invalide');
  }
  const httpsOk = url.protocol === 'https:';
  const localOk = url.protocol === 'http:' && url.hostname === 'localhost';
  if ((!httpsOk && !localOk) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Adresse du front invalide');
  }
  if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) throw new Error('Jeton invalide');
  return url.origin + '/#invitation=' + token;
}

// Prepare une invitation pour une NOUVELLE adresse : refuse si un compte existe deja (le cabinet
// ne pourrait pas etre cree), compte les autres invitations encore valides, puis cree la nouvelle.
async function inviteNewCompany(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error('Adresse e-mail invalide');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('Un compte existe d\u00e9j\u00e0 pour cette adresse');
  const autresValides = await prisma.companyInvitation.count({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } }
  });
  const { token, invitation } = await createInvitation(email);
  return { token, invitation, autresValides };
}

module.exports = {
  INVITATION_VALID_DAYS,
  generateInvitationToken,
  hashInvitationToken,
  createInvitation,
  buildInvitationLink,
  inviteNewCompany
};