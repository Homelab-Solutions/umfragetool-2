const crypto = require('crypto');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Schwer erratbarer, zufaelliger Link-Token (48 Hex-Zeichen).
function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Zufaelliges Umfrage-Passwort (12 Zeichen, ohne verwechselbare Zeichen).
function generateSurveyPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

function strongRandomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function statusOf(survey, now) {
  const t = (now || new Date()).getTime();
  if (t < Date.parse(survey.startAt)) return 'upcoming';
  if (t > Date.parse(survey.endAt)) return 'closed';
  return 'active';
}

function statusLabel(status) {
  return { upcoming: 'Noch nicht gestartet', active: 'Aktiv', closed: 'Abgelaufen' }[status] || status;
}

// Geschaetzte Ausfuelldauer: 2 Minuten Grundzeit + 20 Sekunden pro Frage.
function estimateSeconds(survey) {
  return 120 + 20 * ((survey.questions || []).length);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

// Aggregation NUR der Antwortwerte - keine Teilnehmermetadaten.
function aggregate(survey, responses) {
  const out = { surveyId: survey.id, title: survey.title, total: responses.length, questions: [] };
  for (const q of survey.questions) {
    const answers = responses
      .map((r) => (r.answers || []).find((a) => a.questionId === q.id))
      .filter((a) => a !== undefined);
    if (q.type === 'single' || q.type === 'dropdown') {
      const counts = (q.options || []).map((o) => ({ optionId: o.id, label: o.label, count: 0 }));
      for (const a of answers) {
        const c = counts.find((c) => c.optionId === a.value);
        if (c) c.count += 1;
      }
      out.questions.push({ id: q.id, type: q.type, text: q.text, kind: 'choice', counts });
    } else if (q.type === 'multiple') {
      const counts = (q.options || []).map((o) => ({ optionId: o.id, label: o.label, count: 0 }));
      for (const a of answers) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) {
          const c = counts.find((c) => c.optionId === v);
          if (c) c.count += 1;
        }
      }
      out.questions.push({ id: q.id, type: q.type, text: q.text, kind: 'choice', multi: true, counts });
    } else if (q.type === 'rating') {
      const vals = answers.map((a) => Number(a.value)).filter((v) => Number.isInteger(v) && v >= 1 && v <= 10);
      const buckets = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), count: 0 }));
      for (const v of vals) buckets[v - 1].count += 1;
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      out.questions.push({ id: q.id, type: q.type, text: q.text, kind: 'rating', buckets, avg, count: vals.length });
    } else {
      out.questions.push({
        id: q.id,
        type: q.type,
        text: q.text,
        kind: 'text',
        texts: answers.map((a) => String(a.value == null ? '' : a.value))
      });
    }
  }
  return out;
}

module.exports = {
  escapeHtml,
  randomToken,
  generateSurveyPassword,
  strongRandomPassword,
  statusOf,
  statusLabel,
  estimateSeconds,
  fmtDate,
  aggregate
};
