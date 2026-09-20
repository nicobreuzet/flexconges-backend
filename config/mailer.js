const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendMail(to, subject, text) {
  if (process.env.NODE_ENV === 'test') {
    return; // on n'envoie rien pendant les tests automatisés
  }

  const info = await transporter.sendMail({
    from: '"FlexCongés" <noreply@flexconges.com>',
    to,
    subject,
    text
  });

  console.log('📧 Email envoyé, aperçu ici :', nodemailer.getTestMessageUrl(info));
}

module.exports = { sendMail };