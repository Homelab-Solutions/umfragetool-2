// Umfragetool-2: lokales, datenschutzorientiertes Umfragetool.
// Anonymitaet: Antworten werden ausschliesslich mit surveyId + Antworten gespeichert.
// Es werden KEINE IPs, User-Agents, Cookies, Session-IDs oder sonstige Teilnehmermerkmale
// erfasst; Access-Logging schreibt nur Methode/Route/Status (ohne Body, ohne Personenbezug).
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const Store = require('./lib/store');
const { seed } = require('./lib/seed');
const U = require('./lib/util');

const PORT = Number(process.env.PORT) || 3009;
const store = new Store(path.join(__dirname, 'data', 'store.json'));
seed(store);

const app = express();
app.disable('x-powered-by');
// Kein IP-/Header-Logging. Nur minimales Status-Logging ohne Inhalte.
app.use((req, res, next) => {
  res.on('finish', () => {
    if (!req.path.startsWith('/api/answers')) {
      console.log('[access]', req.method, req.path, res.statusCode);
    }
  });
  next();
});

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// ---------- Hilfsfunktionen ----------
function publicSurvey(s) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    startAt: s.startAt,
    endAt: s.endAt,
    status: U.statusOf(s),
    statusLabel: U.statusLabel(U.statusOf(s)),
    estimatedSeconds: U.estimateSeconds(s),
    questions: s.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      description: q.description,
      required: q.required,
      options: (q.options || []).map((o) => ({ id: o.id, label: o.label }))
    }))
  };
}

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireOwner(req, res, next) {
  const s = store.data.surveys.find((x) => x.id === req.params.id || x.id === (req.body && req.body.surveyId));
  if (!s) return res.status(404).send('Umfrage nicht gefunden.');
  if (s.ownerId !== req.session.userId) return res.status(403).send('Kein Zugriff: Nur der Ersteller darf diese Umfrage verwalten.');
  req.survey = s;
  next();
}

function validateSurveyPayload(body) {
  const errors = [];
  const title = String(body.title || '').trim();
  if (!title) errors.push('Titel fehlt.');
  if (title.length > 200) errors.push('Titel zu lang (max. 200 Zeichen).');
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) errors.push('Start- oder Endzeit fehlt/ungueltig.');
  else if (endAt <= startAt) errors.push('Das Ende muss nach dem Start liegen.');
  const questions = [];
  const rawQs = Array.isArray(body.questions) ? body.questions : [];
  if (rawQs.length === 0) errors.push('Mindestens eine Frage erforderlich.');
  if (rawQs.length > 50) errors.push('Maximal 50 Fragen.');
  const seen = new Set();
  for (const rq of rawQs) {
    const text = String(rq.text || '').trim();
    if (!text) errors.push('Fragetext fehlt.');
    if (seen.has(rq.id)) errors.push('Doppelte Fragen-ID.');
    seen.add(rq.id);
    const type = String(rq.type || '');
    if (!['single', 'multiple', 'dropdown', 'rating', 'text'].includes(type)) errors.push('Unbekannter Fragetyp.');
    const options = ['single', 'multiple', 'dropdown'].includes(type)
      ? (Array.isArray(rq.options) ? rq.options : []).map((o) => ({ id: String(o.id), label: String(o.label || '').trim() })).filter((o) => o.label)
      : [];
    if (['single', 'multiple', 'dropdown'].includes(type) && options.length < 2) errors.push('Auswahlfragen brauchen mindestens 2 Optionen.');
    questions.push({
      id: String(rq.id || crypto.randomUUID()),
      type,
      text: text.slice(0, 500),
      description: String(rq.description || '').trim().slice(0, 1000),
      required: rq.required === 'on' || rq.required === true || rq.required === 'true',
      options: options.map((o) => ({ id: o.id || crypto.randomUUID(), label: o.label.slice(0, 200) }))
    });
  }
  return { errors, title, description: String(body.description || '').trim().slice(0, 2000), startAt, endAt, questions };
}

function htmlPage(title, body, nav, extraHead) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${U.escapeHtml(title)} · Umfragetool</title>
<style>
:root{--bg:#f4f6f8;--card:#fff;--ink:#1d2733;--muted:#5b6b7b;--accent:#2f6fed;--accent2:#1f56c4;--ok:#1d8a4e;--warn:#b3261e;--line:#d9e0e8}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.45}
header{background:#16202b;color:#fff;padding:.7rem 1rem;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center}
header a{color:#cfe0ff;text-decoration:none;font-size:.92rem}
header .brand{font-weight:700;color:#fff;margin-right:auto}
main{max-width:860px;margin:1.2rem auto;padding:0 .9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.1rem;margin-bottom:1rem;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h1{font-size:1.3rem;margin:.2rem 0 .6rem}
h2{font-size:1.05rem;margin:1rem 0 .5rem}
label{display:block;font-weight:600;margin:.7rem 0 .25rem;font-size:.95rem}
input[type=text],input[type=password],input[type=datetime-local],textarea,select{width:100%;padding:.5rem .6rem;border:1px solid var(--line);border-radius:7px;font:inherit;background:#fff}
textarea{min-height:4.5rem}
.btn{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:7px;padding:.55rem 1rem;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--accent2)}
.btn.secondary{background:#e7ecf3;color:var(--ink)}
.btn.danger{background:var(--warn)}
.btn.small{padding:.3rem .6rem;font-size:.85rem}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.muted{color:var(--muted);font-size:.88rem}
.notice{border-radius:8px;padding:.6rem .8rem;margin:.6rem 0;font-size:.95rem}
.notice.ok{background:#e5f5ec;color:var(--ok)}
.notice.err{background:#fdecea;color:var(--warn)}
.notice.info{background:#e8effd;color:#1f56c4}
.badge{display:inline-block;padding:.15rem .55rem;border-radius:999px;font-size:.78rem;font-weight:700;background:#e7ecf3;color:#33414f;margin-left:.4rem}
.badge.active{background:#dff2e6;color:var(--ok)}
.badge.closed{background:#fdecea;color:var(--warn)}
.badge.upcoming{background:#fff4d6;color:#8a6100}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
.bar-wrap{background:#e7ecf3;border-radius:6px;height:20px;overflow:hidden;min-width:120px}
.bar{background:var(--accent);height:100%}
.progress{height:12px;background:#e7ecf3;border-radius:6px;overflow:hidden;margin:.4rem 0}
.progress>div{background:var(--accent);height:100%}
.q{border:1px solid var(--line);border-radius:8px;padding:.7rem .9rem;margin:.6rem 0;background:#fbfcfe}
.q .opts label{font-weight:400;display:flex;gap:.45rem;align-items:flex-start;margin:.3rem 0}
.q .opts input{margin-top:.25rem}
footer{max-width:860px;margin:1rem auto 2rem;padding:0 .9rem;color:var(--muted);font-size:.82rem}
.flash{color:var(--warn);font-size:.85rem;margin-top:.2rem}
code{background:#eef1f5;padding:.05rem .3rem;border-radius:4px}
</style>
${extraHead || ''}
</head>
<body>
<header>
  <span class="brand">📋 Umfragetool</span>
  <a href="/">Start</a>
  <a href="/surveys/new">Neue Umfrage</a>
  <a href="/my">Meine Umfragen</a>
  ${nav}
</header>
<main>
${body}
</main>
<footer>
  Datenschutz: Antworten werden nicht mit Personen, IP-Adressen, Cookies oder Geräten verknüpft. Mehrfachteilnahmen sind möglich und werden nicht verhindert.
  Diese App schützt die Anonymität innerhalb der Anwendung; ein vorgeschalteter Proxy/Load-Balancer kann serverseitig eigene Zugriffslogs führen.
</footer>
</body>
</html>`;
}

function navFor(user) {
  return user
    ? `<span class="muted" style="color:#9fb4cf">${U.escapeHtml(user.username)}</span><a href="/logout">Abmelden</a>`
    : `<a href="/login">Anmelden</a><a href="/register">Registrieren</a>`;
}

function page(title, body, user, extraHead) {
  return htmlPage(title, body, navFor(user), extraHead);
}

// ---------- Oeffentliche Seiten ----------
app.get('/', (req, res) => {
  const active = store.data.surveys.filter((s) => U.statusOf(s) === 'active').length;
  res.send(page('Start', `
    <div class="card">
      <h1>Lokales Umfragetool</h1>
      <p class="muted">Erstelle Umfragen, teile den Link und sieh Ergebnisse live als Balkendiagramme.
      Antworten sind anonym – sie werden weder Accounts noch IP-Adressen, Cookies oder Geräten zugeordnet.</p>
      <p>Derzeit <strong>${active}</strong> aktive Umfrage(n).</p>
      <p class="row"><a class="btn" href="/register">Kostenlos registrieren</a> <a class="btn secondary" href="/login">Anmelden</a></p>
    </div>
  `, req.session.user));
});

app.get('/register', (req, res) => {
  res.send(page('Registrieren', `
    <div class="card" style="max-width:420px;margin:auto">
      <h1>Registrieren</h1>
      <form method="post" action="/register">
        <label for="u">Benutzername</label>
        <input type="text" id="u" name="username" required minlength="3" maxlength="40">
        <label for="p">Passwort</label>
        <input type="password" id="p" name="password" required minlength="8">
        <p class="muted">Nur angemeldete Benutzer können Umfragen erstellen.</p>
        <button class="btn" type="submit">Konto erstellen</button>
      </form>
      <p class="muted">Schon dabei? <a href="/login">Anmelden</a></p>
    </div>
  `, req.session.user));
});

app.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3 || username.length > 40) return res.status(400).send(page('Fehler', '<div class="card"><p class="notice err">Benutzername: 3–40 Zeichen.</p><p><a href="/register">Zurück</a></p></div>', req.session.user));
  if (password.length < 8) return res.status(400).send(page('Fehler', '<div class="card"><p class="notice err">Passwort: mindestens 8 Zeichen.</p><p><a href="/register">Zurück</a></p></div>', req.session.user));
  if (store.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).send(page('Fehler', '<div class="card"><p class="notice err">Benutzername bereits vergeben.</p><p><a href="/register">Zurück</a></p></div>', req.session.user));
  }
  const user = { id: crypto.randomUUID(), username, passwordHash: bcrypt.hashSync(password, 10), role: 'user', createdAt: new Date().toISOString() };
  store.data.users.push(user);
  store.save();
  req.session.userId = user.id;
  res.redirect('/my');
});

app.get('/login', (req, res) => {
  res.send(page('Anmelden', `
    <div class="card" style="max-width:420px;margin:auto">
      <h1>Anmelden</h1>
      <form method="post" action="/login">
        <label for="u">Benutzername</label>
        <input type="text" id="u" name="username" required>
        <label for="p">Passwort</label>
        <input type="password" id="p" name="password" required>
        <button class="btn" type="submit">Anmelden</button>
      </form>
      <p class="muted">Neu hier? <a href="/register">Registrieren</a></p>
    </div>
  `, req.session.user));
});

app.post('/login', (req, res) => {
  const user = store.data.users.find((u) => u.username.toLowerCase() === String(req.body.username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.passwordHash)) {
    return res.status(401).send(page('Fehler', '<div class="card"><p class="notice err">Anmeldedaten falsch.</p><p><a href="/login">Erneut versuchen</a></p></div>', req.session.user));
  }
  req.session.userId = user.id;
  res.redirect('/my');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Umfrage-Verwaltung (nur Ersteller) ----------
app.get('/my', requireLogin, (req, res) => {
  const mine = store.data.surveys.filter((s) => s.ownerId === req.session.userId);
  const rows = mine.map((s) => {
    const st = U.statusOf(s);
    const n = store.data.responses.filter((r) => r.surveyId === s.id).length;
    return `<tr>
      <td><a href="/s/${s.slug}">${U.escapeHtml(s.title)}</a></td>
      <td><span class="badge ${st}">${U.statusLabel(st)}</span></td>
      <td>${U.fmtDate(s.startAt)} → ${U.fmtDate(s.endAt)}</td>
      <td>${n}</td>
      <td class="row">
        <a class="btn small secondary" href="/manage/${s.id}">Verwalten</a>
        <a class="btn small" href="/manage/${s.id}/results">Ergebnisse</a>
        <a class="btn small secondary" href="/s/${s.slug}">Öffnen</a>
      </td>
    </tr>`;
  }).join('');
  res.send(page('Meine Umfragen', `
    <div class="card">
      <h1>Meine Umfragen</h1>
      <p><a class="btn" href="/surveys/new">+ Neue Umfrage erstellen</a></p>
      ${mine.length ? `<table><thead><tr><th>Titel</th><th>Status</th><th>Laufzeit</th><th>Antworten</th><th>Aktionen</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Noch keine Umfragen. Erstelle deine erste Umfrage.</p>'}
    </div>
  `, req.session.user));
});

app.get('/surveys/new', requireLogin, (req, res) => {
  const now = new Date(Date.now() + 60000);
  const end = new Date(Date.now() + 7 * 86400000);
  const toLocal = (d) => d.toISOString().slice(0, 16);
  res.send(page('Neue Umfrage', `
    <div class="card">
      <h1>Neue Umfrage</h1>
      <form method="post" action="/surveys" id="surveyForm">
        <label for="title">Titel *</label>
        <input type="text" id="title" name="title" required maxlength="200">
        <label for="description">Beschreibung (optional)</label>
        <textarea id="description" name="description" maxlength="2000"></textarea>
        <div class="row">
          <div style="flex:1;min-width:200px"><label for="startAt">Start *</label><input type="datetime-local" id="startAt" name="startAt" value="${toLocal(now)}" required></div>
          <div style="flex:1;min-width:200px"><label for="endAt">Ende *</label><input type="datetime-local" id="endAt" name="endAt" value="${toLocal(end)}" required></div>
        </div>
        <label>Umfrage-Passwort</label>
        <div class="row">
          <label style="font-weight:400;margin:0"><input type="radio" name="pwMode" value="auto" checked> Automatisch erzeugen</label>
          <label style="font-weight:400;margin:0"><input type="radio" name="pwMode" value="custom"> Selbst festlegen</label>
        </div>
        <div id="customPw" style="display:none;margin-top:.4rem">
          <input type="text" name="customPassword" placeholder="Eigenes Passwort (min. 4 Zeichen)" minlength="4" maxlength="100">
        </div>
        <h2>Fragen</h2>
        <div id="questions"></div>
        <p class="row">
          <button type="button" class="btn secondary small" data-add="single">+ Einfachauswahl</button>
          <button type="button" class="btn secondary small" data-add="multiple">+ Mehrfachauswahl</button>
          <button type="button" class="btn secondary small" data-add="dropdown">+ Dropdown</button>
          <button type="button" class="btn secondary small" data-add="rating">+ Bewertung 1–10</button>
          <button type="button" class="btn secondary small" data-add="text">+ Freitext</button>
        </p>
        <button class="btn" type="submit">Umfrage erstellen</button>
      </form>
    </div>
    <script>
    (function(){
      var qIndex = 0;
      var container = document.getElementById('questions');
      var typeLabels = {single:'Einfachauswahl',multiple:'Mehrfachauswahl',dropdown:'Dropdown',rating:'Bewertung 1–10',text:'Freitext'};
      document.querySelectorAll('[data-add]').forEach(function(btn){
        btn.addEventListener('click', function(){ addQuestion(btn.getAttribute('data-add')); });
      });
      function addQuestion(type){
        qIndex++;
        var qid = 'q' + qIndex;
        var box = document.createElement('div');
        box.className = 'q';
        box.dataset.qid = qid;
        var optsHtml = '';
        if (type !== 'rating' && type !== 'text') {
          optsHtml = '<div class="opts-list"><label>Antwortoptionen (eine pro Zeile, mind. 2):</label><textarea name="questions['+qid+'][optionsText]" rows="3" placeholder="Option A\\nOption B"></textarea></div>';
        }
        box.innerHTML =
          '<div class="row" style="justify-content:space-between"><strong>'+typeLabels[type]+'</strong>'+
          '<span class="row"><button type="button" class="btn small secondary" data-up>▲</button><button type="button" class="btn small secondary" data-down>▼</button><button type="button" class="btn small danger" data-del>Entfernen</button></span></div>'+
          '<input type="hidden" name="questions['+qid+'][id]" value="'+qid+'">'+
          '<input type="hidden" name="questions['+qid+'][type]" value="'+type+'">'+
          '<label>Fragetext *</label><input type="text" name="questions['+qid+'][text]" required maxlength="500">'+
          '<label>Beschreibung (optional)</label><input type="text" name="questions['+qid+'][description]" maxlength="1000">'+
          optsHtml+
          (type==='rating' ? '<p class="muted">Skala 1 (schlecht) bis 10 (sehr gut).</p>' : '')+
          '<label style="font-weight:400"><input type="checkbox" name="questions['+qid+'][required]"> Pflichtfeld</label>';
        container.appendChild(box);
        box.querySelector('[data-del]').addEventListener('click', function(){ container.removeChild(box); });
        box.querySelector('[data-up]').addEventListener('click', function(){ if (box.previousSibling) container.insertBefore(box, box.previousSibling); });
        box.querySelector('[data-down]').addEventListener('click', function(){ if (box.nextSibling) container.insertBefore(box.nextSibling, box); });
      }
      var cp = document.getElementById('customPw');
      document.querySelectorAll('input[name=pwMode]').forEach(function(r){
        r.addEventListener('change', function(){ cp.style.display = r.value === 'custom' && r.checked ? 'block' : 'none'; });
      });
      addQuestion('single');
    })();
    </script>
  `, req.session.user));
});

app.post('/surveys', requireLogin, (req, res) => {
  const body = req.body;
  // Fragen aus flachen Feldern einsammeln (Reihenfolge der Felder bleibt erhalten)
  const qMap = {};
  const qOrder = [];
  for (const key of Object.keys(body)) {
    const m = key.match(/^questions\[(.+?)\]\[(id|type|text|description|required|optionsText)\]$/);
    if (m) {
      if (!(m[1] in qMap)) qOrder.push(m[1]);
      qMap[m[1]] = qMap[m[1]] || {};
      qMap[m[1]][m[2]] = body[key];
    }
  }
  const questions = qOrder.map((k) => {
    const q = qMap[k];
    const optsText = String(q.optionsText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return {
      id: q.id, type: q.type, text: q.text, description: q.description || '',
      required: q.required === 'on',
      options: optsText.map((label, i) => ({ id: k + '_o' + i, label }))
    };
  });
  const payload = {
    title: body.title, description: body.description, startAt: body.startAt, endAt: body.endAt,
    questions
  };
  const v = validateSurveyPayload(payload);
  if (v.errors.length) {
    return res.status(400).send(page('Fehler', `<div class="card"><p class="notice err">${v.errors.map(U.escapeHtml).join('<br>')}</p><p><a href="/surveys/new">Zurück</a></p></div>`, req.session.user));
  }
  const pwMode = body.pwMode === 'custom' ? 'custom' : 'auto';
  const plainPw = pwMode === 'custom' ? String(body.customPassword || '') : U.generateSurveyPassword();
  if (pwMode === 'custom' && plainPw.length < 4) {
    return res.status(400).send(page('Fehler', '<div class="card"><p class="notice err">Eigenes Passwort: mindestens 4 Zeichen.</p><p><a href="/surveys/new">Zurück</a></p></div>', req.session.user));
  }
  const slug = U.randomToken();
  const survey = {
    id: crypto.randomUUID(),
    slug,
    ownerId: req.session.userId,
    title: v.title,
    description: v.description,
    startAt: v.startAt.toISOString(),
    endAt: v.endAt.toISOString(),
    passwordHash: bcrypt.hashSync(plainPw, 10),
    questions: v.questions,
    createdAt: new Date().toISOString()
  };
  store.data.surveys.push(survey);
  store.save();
  res.send(page('Umfrage erstellt', `
    <div class="card">
      <p class="notice ok">Umfrage „${U.escapeHtml(survey.title)}“ wurde erstellt.</p>
      <p>Teilbarer Link (schwer erratbar):</p>
      <p><code>/s/${U.escapeHtml(slug)}</code></p>
      ${pwMode === 'auto' ? `<p>Automatisch erzeugtes Umfrage-Passwort (wird nur jetzt einmal angezeigt): <code>${U.escapeHtml(plainPw)}</code></p>` : '<p>Umfrage-Passwort: das von dir selbst festgelegte Passwort.</p>'}
      <p class="muted">Das Passwort wird nur als Hash gespeichert und nicht erneut angezeigt.</p>
      <p class="row"><a class="btn" href="/manage/${survey.id}">Verwalten</a><a class="btn secondary" href="/manage/${survey.id}/results">Ergebnisse</a><a class="btn secondary" href="/my">Meine Umfragen</a></p>
    </div>
  `, req.session.user));
});

app.get('/manage/:id', requireLogin, requireOwner, (req, res) => {
  const s = req.survey;
  const st = U.statusOf(s);
  const qs = s.questions.map((q, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${U.escapeHtml(q.text)}${q.required ? ' <span class="muted">*</span>' : ''}</td>
      <td>${{ single: 'Einfachauswahl', multiple: 'Mehrfachauswahl', dropdown: 'Dropdown', rating: 'Bewertung 1–10', text: 'Freitext' }[q.type] || q.type}</td>
      <td>${(q.options || []).map((o) => U.escapeHtml(o.label)).join(', ') || '—'}</td>
    </tr>`).join('');
  res.send(page('Verwalten', `
    <div class="card">
      <h1>${U.escapeHtml(s.title)} <span class="badge ${st}">${U.statusLabel(st)}</span></h1>
      <p class="muted">${U.escapeHtml(s.description || '')}</p>
      <p class="muted">Laufzeit: ${U.fmtDate(s.startAt)} → ${U.fmtDate(s.endAt)} · Link: <code>/s/${U.escapeHtml(s.slug)}</code></p>
      <p class="muted">Nach Ablauf wird die Umfrage automatisch geschlossen; Ergebnisse bleiben bis zur Löschung durch dich erhalten.</p>
      <p class="row">
        <a class="btn" href="/manage/${s.id}/results">Ergebnisse ansehen</a>
        <a class="btn secondary" href="/s/${U.escapeHtml(s.slug)}">Teilnehmeransicht</a>
      </p>
      <form method="post" action="/manage/${s.id}/delete" onsubmit="return confirm('Umfrage inkl. aller Antworten löschen?');">
        <button class="btn danger" type="submit">Umfrage löschen</button>
      </form>
    </div>
    <div class="card">
      <h2>Fragen (${s.questions.length})</h2>
      <table><thead><tr><th>#</th><th>Text</th><th>Typ</th><th>Optionen</th></tr></thead><tbody>${qs}</tbody></table>
    </div>
  `, req.session.user));
});

app.post('/manage/:id/delete', requireLogin, requireOwner, (req, res) => {
  store.data.surveys = store.data.surveys.filter((s) => s.id !== req.survey.id);
  store.data.responses = store.data.responses.filter((r) => r.surveyId !== req.survey.id);
  store.save();
  res.redirect('/my');
});

app.get('/manage/:id/results', requireLogin, requireOwner, (req, res) => {
  const s = req.survey;
  const rs = store.data.responses.filter((r) => r.surveyId === s.id);
  const agg = U.aggregate(s, rs);
  const blocks = agg.questions.map((q) => {
    if (q.kind === 'choice') {
      const max = Math.max(1, ...q.counts.map((c) => c.count));
      const bars = q.counts.map((c) => `
        <div style="margin:.35rem 0">
          <div class="row" style="justify-content:space-between"><span>${U.escapeHtml(c.label)}</span><span class="muted">${c.count}</span></div>
          <div class="bar-wrap"><div class="bar" style="width:${Math.round((c.count / max) * 100)}%"></div></div>
        </div>`).join('');
      return `<div class="q"><h2>${U.escapeHtml(q.text)}</h2>${bars}</div>`;
    }
    if (q.kind === 'rating') {
      const max = Math.max(1, ...q.buckets.map((b) => b.count));
      const bars = q.buckets.map((b) => `
        <div class="row" style="gap:.4rem">
          <span style="width:1.4rem;text-align:right">${b.label}</span>
          <div class="bar-wrap" style="flex:1"><div class="bar" style="width:${Math.round((b.count / max) * 100)}%"></div></div>
          <span class="muted" style="width:2rem">${b.count}</span>
        </div>`).join('');
      return `<div class="q"><h2>${U.escapeHtml(q.text)}</h2><p class="muted">Ø ${q.avg === null ? '—' : q.avg.toFixed(2)} · ${q.count} Bewertung(en)</p>${bars}</div>`;
    }
    const items = q.texts.length
      ? `<ul>${q.texts.map((t) => `<li>${U.escapeHtml(t)}</li>`).join('')}</ul>`
      : '<p class="muted">Noch keine Freitextantworten.</p>';
    return `<div class="q"><h2>${U.escapeHtml(q.text)}</h2>${items}</div>`;
  }).join('');
  res.send(page('Ergebnisse', `
    <div class="card">
      <h1>Ergebnisse: ${U.escapeHtml(s.title)} <span class="badge ${U.statusOf(s)}">${U.statusLabel(U.statusOf(s))}</span></h1>
      <p class="muted">Nur aggregierte Ergebnisse – ${agg.total} Antwort(en), keine Einzelzuordnung zu Personen. Diese Seite ist nur für dich als Ersteller sichtbar. Live-Aktualisierung alle 10 Sekunden.</p>
      <meta http-equiv="refresh" content="10">
    </div>
    ${blocks || '<div class="card"><p class="muted">Es liegen noch keine Antworten vor.</p></div>'}
  `, req.session.user));
});

// ---------- Oeffentliche Teilnahme (anonym) ----------
function findSurveyBySlug(slug) {
  return store.data.surveys.find((s) => s.slug === String(slug || ''));
}

app.get('/s/:slug', (req, res) => {
  const s = findSurveyBySlug(req.params.slug);
  if (!s) return res.status(404).send(page('Nicht gefunden', '<div class="card"><p class="notice err">Diese Umfrage existiert nicht (mehr).</p></div>', req.session.user));
  const st = U.statusOf(s);
  const est = Math.ceil(U.estimateSeconds(s) / 60);
  if (st !== 'active') {
    return res.send(page('Status', `
      <div class="card">
        <h1>${U.escapeHtml(s.title)}</h1>
        <p class="notice ${st === 'closed' ? 'err' : 'info'}">Diese Umfrage ist <strong>${U.statusLabel(st)}</strong> und kann derzeit nicht ausgefüllt werden.</p>
        <p class="muted">Laufzeit: ${U.fmtDate(s.startAt)} → ${U.fmtDate(s.endAt)}</p>
      </div>`, req.session.user));
  }
  // Passwort-Gate
  const gateKey = 'pwok_' + s.id;
  if (!req.session[gateKey]) {
    return res.send(page('Passwort', `
      <div class="card" style="max-width:460px;margin:auto">
        <h1>${U.escapeHtml(s.title)}</h1>
        <p class="muted">${U.escapeHtml(s.description || '')}</p>
        <p class="notice info">Geschätzte Dauer: ca. <strong>${est} Min.</strong> · ${s.questions.length} Frage(n) · Anonym: Antworten werden nicht mit Personen verknüpft; Mehrfachteilnahmen sind möglich.</p>
        <form method="post" action="/s/${U.escapeHtml(s.slug)}/unlock">
          <label for="pw">Umfrage-Passwort</label>
          <input type="password" id="pw" name="password" required autofocus>
          ${req.query.err ? '<p class="flash">Passwort falsch.</p>' : ''}
          <button class="btn" type="submit">Umfrage öffnen</button>
        </form>
      </div>`, req.session.user));
  }
  res.redirect('/s/' + s.slug + '/take');
});

app.post('/s/:slug/unlock', (req, res) => {
  const s = findSurveyBySlug(req.params.slug);
  if (!s) return res.status(404).send('Nicht gefunden.');
  const st = U.statusOf(s);
  if (st !== 'active') return res.redirect('/s/' + s.slug);
  if (!bcrypt.compareSync(String(req.body.password || ''), s.passwordHash)) {
    return res.redirect('/s/' + s.slug + '?err=1');
  }
  // Nur eine anonyme Freigabe-Markierung in der Session – keine Teilnehmerkennung,
  // die Session ist weder mit einem Account noch mit der gespeicherten Antwort verknüpft.
  req.session['pwok_' + s.id] = true;
  res.redirect('/s/' + s.slug + '/take');
});

app.get('/s/:slug/take', (req, res) => {
  const s = findSurveyBySlug(req.params.slug);
  if (!s) return res.status(404).send('Nicht gefunden.');
  const st = U.statusOf(s);
  if (st !== 'active') return res.redirect('/s/' + s.slug);
  if (!req.session['pwok_' + s.id]) return res.redirect('/s/' + s.slug);
  const estSec = U.estimateSeconds(s);
  const qs = s.questions.map((q, i) => {
    let field = '';
    if (q.type === 'single') {
      field = (q.options || []).map((o) => `<label><input type="radio" name="a_${q.id}" value="${U.escapeHtml(o.id)}"> ${U.escapeHtml(o.label)}</label>`).join('');
    } else if (q.type === 'multiple') {
      field = (q.options || []).map((o) => `<label><input type="checkbox" name="a_${q.id}" value="${U.escapeHtml(o.id)}"> ${U.escapeHtml(o.label)}</label>`).join('');
    } else if (q.type === 'dropdown') {
      field = `<select name="a_${q.id}"><option value="">— bitte wählen —</option>${(q.options || []).map((o) => `<option value="${U.escapeHtml(o.id)}">${U.escapeHtml(o.label)}</option>`).join('')}</select>`;
    } else if (q.type === 'rating') {
      field = `<div class="row" style="gap:.3rem;flex-wrap:wrap">${Array.from({ length: 10 }, (_, k) => `<label style="font-weight:400;margin:0"><input type="radio" name="a_${q.id}" value="${k + 1}"> ${k + 1}</label>`).join('')}</div><p class="muted">1 = schlecht, 10 = sehr gut</p>`;
    } else {
      field = `<textarea name="a_${q.id}" rows="3" maxlength="2000"></textarea>`;
    }
    return `<div class="q" data-q="${i + 1}" data-total="${s.questions.length}">
      <p class="muted" style="margin:0 0 .2rem">Frage ${i + 1} von ${s.questions.length}</p>
      <h2 style="margin:.1rem 0 .3rem">${U.escapeHtml(q.text)}${q.required ? ' *' : ''}</h2>
      ${q.description ? `<p class="muted">${U.escapeHtml(q.description)}</p>` : ''}
      <div class="opts">${field}</div>
    </div>`;
  }).join('');
  res.send(page('Umfrage ausfüllen', `
    <div class="card">
      <h1>${U.escapeHtml(s.title)}</h1>
      <p class="muted">${U.escapeHtml(s.description || '')}</p>
      <div class="row" style="justify-content:space-between"><span id="progLabel" class="muted">Frage 1 von ${s.questions.length}</span><span id="timeLabel" class="muted"></span></div>
      <div class="progress"><div id="progBar" style="width:0%"></div></div>
      <p class="muted">Geschätzte Gesamtdauer: ca. ${Math.ceil(estSec / 60)} Min. · Anonym – Mehrfachteilnahme möglich.</p>
    </div>
    <form method="post" action="/s/${U.escapeHtml(s.slug)}/submit" id="takeForm">
      ${qs}
      <div class="card"><button class="btn" type="submit">Antworten absenden</button></div>
    </form>
    <script>
    (function(){
      var total = ${s.questions.length};
      var estTotal = ${estSec};
      var boxes = Array.prototype.slice.call(document.querySelectorAll('.q'));
      var label = document.getElementById('progLabel');
      var bar = document.getElementById('progBar');
      var timeLabel = document.getElementById('timeLabel');
      var start = Date.now();
      function answered(b){
        var inputs = b.querySelectorAll('input,select,textarea');
        for (var i=0;i<inputs.length;i++){ var el = inputs[i]; if (el.type==='checkbox'||el.type==='radio'){ if (el.checked) return true; } else if (String(el.value||'').trim()!=='') return true; }
        return false;
      }
      function update(){
        var n = boxes.filter(answered).length;
        label.textContent = 'Beantwortet: ' + n + ' von ' + total + ' Fragen';
        bar.style.width = Math.round((n/total)*100) + '%';
        var per = total>0 ? estTotal/total : 0;
        var rem = Math.max(0, Math.round((total-n)*per));
        timeLabel.textContent = 'Verbleibende geschätzte Zeit: ca. ' + (rem < 1 ? 1 : rem) + ' s';
        setTimeout(update, 1000);
      }
      update();
    })();
    </script>
  `, req.session.user));
});

app.post('/s/:slug/submit', (req, res) => {
  const s = findSurveyBySlug(req.params.slug);
  if (!s) return res.status(404).send('Nicht gefunden.');
  const st = U.statusOf(s);
  if (st !== 'active') return res.redirect('/s/' + s.slug);
  if (!req.session['pwok_' + s.id]) return res.redirect('/s/' + s.slug);

  // Pflichtfeld-Validierung
  const missing = s.questions.filter((q) => q.required).filter((q) => {
    const v = req.body['a_' + q.id];
    if (q.type === 'multiple') return !Array.isArray(v) || v.length === 0;
    return v === undefined || String(v).trim() === '';
  });
  if (missing.length) {
    return res.status(400).send(page('Pflichtfelder', `
      <div class="card"><p class="notice err">Bitte beantworte alle Pflichtfelder (${missing.length} offen).</p>
      <p><a class="btn" href="/s/${U.escapeHtml(s.slug)}/take">Zurück zur Umfrage</a></p></div>`, req.session.user));
  }

  // ANONYME Speicherung: nur surveyId + Antworten. Weder Nutzer-ID noch IP, Cookie,
  // Session-ID, User-Agent oder sonstiges Teilnehmermerkmal – auch nicht als Hash.
  const answers = [];
  for (const q of s.questions) {
    let value = req.body['a_' + q.id];
    if (q.type === 'multiple') {
      const allowed = new Set((q.options || []).map((o) => o.id));
      value = (Array.isArray(value) ? value : [value]).filter((v) => allowed.has(v));
    } else if (['single', 'dropdown'].includes(q.type)) {
      const allowed = new Set((q.options || []).map((o) => o.id));
      value = allowed.has(value) ? value : null;
    } else if (q.type === 'rating') {
      const n = Number(value);
      value = Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
    } else {
      value = String(value || '').trim().slice(0, 2000);
    }
    answers.push({ questionId: q.id, value });
  }
  store.data.responses.push({ surveyId: s.id, answers, at: new Date().toISOString() });
  store.save();
  // Antwortinhalte werden weder geloggt noch an den Client zurückgegeben.
  console.log('[answers] Neue anonyme Antwort fuer Umfrage-ID (Inhalt wird nicht protokolliert).');
  res.send(page('Danke!', `
    <div class="card" style="max-width:460px;margin:auto">
      <p class="notice ok"><strong>Vielen Dank!</strong> Deine Antwort wurde anonym übermittelt.</p>
      <p class="muted">Sie ist nicht mit deiner Person, IP-Adresse, deinem Gerät oder Cookie verknüpft. Mehrfachteilnahmen sind erlaubt.</p>
      <p><a class="btn" href="/s/${U.escapeHtml(s.slug)}/take">Erneut teilnehmen</a> <a class="btn secondary" href="/">Startseite</a></p>
    </div>`, req.session.user));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[umfragetool-2] Laeuft auf 0.0.0.0:' + PORT);
});

module.exports = { app, store };
