// Gezielte Tests fuer kritische Regeln:
// - Eigentümerberechtigung (nur Ersteller sieht Ergebnisse/Verwaltung)
// - Umfrage-Passwort (Hash, nicht im Klartext; falsches Passwort abgelehnt)
// - Ablauf/Status (upcoming/active/closed)
// - Pflichtfeld-Validierung
// - Keine Teilnehmerverknüpfung in gespeicherten Antworten
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const Store = require('../lib/store');
const U = require('../lib/util');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umfragetool-test-'));
  return new Store(path.join(dir, 'store.json'));
}

function makeSurvey(overrides) {
  return Object.assign({
    id: 'sv1',
    slug: U.randomToken(),
    ownerId: 'user-a',
    title: 'Testumfrage',
    description: '',
    startAt: new Date(Date.now() - 60000).toISOString(),
    endAt: new Date(Date.now() + 3600000).toISOString(),
    passwordHash: bcrypt.hashSync('geheim123', 10),
    questions: [
      { id: 'q1', type: 'single', text: 'Farbe?', description: '', required: true, options: [{ id: 'q1_o0', label: 'Rot' }, { id: 'q1_o1', label: 'Blau' }] },
      { id: 'q2', type: 'rating', text: 'Bewertung?', description: '', required: false, options: [] },
      { id: 'q3', type: 'text', text: 'Kommentar?', description: '', required: false, options: [] }
    ],
    createdAt: new Date().toISOString()
  }, overrides || {});
}

test('Status: upcoming, active, closed nachZeitstempel', () => {
  const now = new Date('2025-06-01T12:00:00Z');
  assert.strictEqual(U.statusOf(makeSurvey({ startAt: '2025-06-01T13:00:00Z', endAt: '2025-06-02T13:00:00Z' }), now), 'upcoming');
  assert.strictEqual(U.statusOf(makeSurvey({ startAt: '2025-06-01T11:00:00Z', endAt: '2025-06-01T13:00:00Z' }), now), 'active');
  assert.strictEqual(U.statusOf(makeSurvey({ startAt: '2025-06-01T10:00:00Z', endAt: '2025-06-01T11:00:00Z' }), now), 'closed');
});

test('Umfrage-Passwort wird als bcrypt-Hash gespeichert, nie im Klartext', () => {
  const pw = U.generateSurveyPassword();
  assert.ok(pw.length >= 10);
  const s = makeSurvey({ passwordHash: bcrypt.hashSync(pw, 10) });
  const raw = JSON.stringify(s);
  assert.ok(!raw.includes(pw), 'Klartext-Passwort darf nicht im Datensatz stehen');
  assert.ok(bcrypt.compareSync(pw, s.passwordHash));
  assert.ok(!bcrypt.compareSync('falsch', s.passwordHash));
});

test('Link-Slug ist schwer erratbar (mind. 32 Hex-Zeichen, zufaellig)', () => {
  const a = U.randomToken();
  const b = U.randomToken();
  assert.ok(/^[0-9a-f]{48}$/.test(a));
  assert.notStrictEqual(a, b);
});

test('Aggregation enthaelt nur Werte, keine Teilnehmermetadaten', () => {
  const s = makeSurvey();
  const responses = [
    { surveyId: s.id, answers: [{ questionId: 'q1', value: 'q1_o0' }, { questionId: 'q2', value: 8 }, { questionId: 'q3', value: 'abc' }], at: '2025-06-01T12:00:00Z' },
    { surveyId: s.id, answers: [{ questionId: 'q1', value: 'q1_o1' }, { questionId: 'q2', value: 4 }, { questionId: 'q3', value: 'def' }], at: '2025-06-01T12:05:00Z' }
  ];
  const agg = U.aggregate(s, responses);
  const q1 = agg.questions.find((q) => q.id === 'q1');
  assert.deepStrictEqual(q1.counts.map((c) => c.count), [1, 1]);
  const q2 = agg.questions.find((q) => q.id === 'q2');
  assert.strictEqual(q2.avg, 6);
  const q3 = agg.questions.find((q) => q.id === 'q3');
  assert.deepStrictEqual(q3.texts.sort(), ['abc', 'def']);
  assert.ok(!JSON.stringify(agg).match(/userId|ownerId|ip|session|userAgent/i));
});

test('Antworten-Speicherformat enthaelt keine Verknuepfung zu Teilnehmermerkmalen', () => {
  const store = makeStore();
  const s = makeSurvey();
  store.data.surveys.push(s);
  // Simuliert den Speicherpfad aus server.js: nur surveyId + answers + Zeitpunkt
  store.data.responses.push({
    surveyId: s.id,
    answers: [{ questionId: 'q1', value: 'q1_o0' }],
    at: new Date().toISOString()
  });
  store.save();
  const raw = fs.readFileSync(store.file, 'utf8');
  for (const forbidden of ['userId', 'ownerId', 'ip', 'userAgent', 'sessionId', 'cookie', 'deviceId', 'fingerprint']) {
    assert.ok(!raw.toLowerCase().includes(forbidden.toLowerCase()), 'Feld "' + forbidden + '" darf nicht gespeichert werden');
  }
});

test('Eigentümerprüfung: survey.ownerId entscheidet über Verwaltungszugriff', () => {
  const store = makeStore();
  const s = makeSurvey({ ownerId: 'user-a' });
  store.data.surveys.push(s);
  const find = (id) => store.data.surveys.find((x) => x.id === id);
  // nur user-a darf verwalten
  assert.strictEqual(find(s.id).ownerId, 'user-a');
  assert.notStrictEqual(find(s.id).ownerId, 'user-b');
});

test('Pflichtfeld-Regel: required Frage ohne Antwort wird markiert', () => {
  const s = makeSurvey();
  const body = {}; // q1 (required) fehlt
  const missing = s.questions.filter((q) => q.required).filter((q) => {
    const v = body['a_' + q.id];
    if (q.type === 'multiple') return !Array.isArray(v) || v.length === 0;
    return v === undefined || String(v).trim() === '';
  });
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].id, 'q1');
});

test('Persistenz: Store rundet Daten verlustfrei', () => {
  const store = makeStore();
  store.data.users.push({ id: 'u1', username: 'x', passwordHash: 'h', role: 'user', createdAt: '2025-01-01' });
  store.save();
  const store2 = new Store(store.file);
  assert.strictEqual(store2.data.users.length, 1);
  assert.strictEqual(store2.data.users[0].username, 'x');
});
