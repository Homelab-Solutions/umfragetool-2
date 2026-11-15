// Einfacher, persistenter JSON-Speicher (lokal, datenschutzfreundlich: alles bleibt auf diesem Host).
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { users: [], surveys: [], responses: [] };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          surveys: Array.isArray(parsed.surveys) ? parsed.surveys : [],
          responses: Array.isArray(parsed.responses) ? parsed.responses : []
        };
      }
    } catch (err) {
      // Defekte Datei nicht laden; kommentiere ins Log ohne personenbezogene Inhalte.
      console.error('[store] Konnte Datenspeicher nicht lesen, starte mit leerem Speicher:', err.message);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = Store;
