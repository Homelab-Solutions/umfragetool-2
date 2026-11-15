// Bootstrap: Legt beim allerersten Start GENAU EIN initiales Admin-Konto an.
// Das zufaellige Passwort wird nur bei dieser einmaligen Erstellung ins Anwendungslog
// geschrieben und danach nie wieder geloggt oder gespeichert.
const bcrypt = require('bcryptjs');
const { strongRandomPassword } = require('./util');

function seed(store) {
  const hasAdmin = store.data.users.some((u) => u.role === 'admin');
  if (!hasAdmin) {
    const username = 'admin';
    const password = strongRandomPassword();
    store.data.users.push({
      id: require('crypto').randomUUID(),
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    store.save();
    console.log('[bootstrap] Initial admin account created (one-time). username: ' + username);
    console.log('[bootstrap] One-time password (shown ONLY here, never logged again): ' + password);
  }
  // Weitere Konten entstehen ueber die Registrierung (/register). Es gibt keine Zugangsdaten-Datei im Projekt.
}

module.exports = { seed };
