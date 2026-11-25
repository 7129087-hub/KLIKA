const express = require('express');
const db = require('../db');

const router = express.Router();

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Form fields can arrive duplicated (?x=a&x=b); always treat as a single string.
function field(v) {
  return String(Array.isArray(v) ? v[0] ?? '' : v ?? '');
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --series-1: #2a78d6;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --good: #0ca30c;
    --critical: #d03b3b;
    --border: rgba(11,11,11,0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #f0efec;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --series-1: #3987e5;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --good: #0ca30c;
      --critical: #e66767;
      --border: rgba(255,255,255,0.10);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: var(--page); color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5;
  }
  a { color: var(--series-1); }
  h1 { font-size: 22px; margin: 0 0 16px; }
  h2 { font-size: 18px; margin: 0 0 12px; }
  h3 { font-size: 15px; margin: 0; }
  .card {
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
    padding: 18px; margin-bottom: 16px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: right; padding: 8px 6px; border-bottom: 1px solid var(--gridline); }
  th { color: var(--text-secondary); font-weight: 600; }
  .muted { color: var(--muted); font-size: 13px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pill {
    display: inline-block; font-size: 12px; padding: 2px 10px; border-radius: 999px;
    border: 1px solid var(--border); color: var(--text-secondary);
  }
  .pill.active { color: #fff; background: var(--good); border-color: var(--good); }
  button, input[type=submit] {
    font: inherit; padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
    background: var(--surface-1); color: var(--text-primary); cursor: pointer;
  }
  button.primary { background: var(--series-1); color: #fff; border-color: var(--series-1); }
  button.danger { color: var(--critical); border-color: var(--critical); }
  input[type=text], select, textarea {
    font: inherit; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--border);
    background: var(--page); color: var(--text-primary); width: 100%;
  }
  textarea { min-height: 90px; font-family: ui-monospace, monospace; direction: ltr; text-align: left; }
  label { font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 4px; }
  form.inline { display: inline; }
  .qcard { border-top: 1px solid var(--gridline); padding-top: 14px; margin-top: 14px; }
  .qcard:first-child { border-top: none; margin-top: 0; padding-top: 0; }
  .qhead { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .bar-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 10px; align-items: center; margin: 6px 0; }
  .bar-track { background: var(--gridline); border-radius: 4px; height: 18px; overflow: hidden; }
  .bar-fill { background: var(--series-1); height: 100%; border-radius: 4px; transition: width .4s ease; }
  .bar-value { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
  details.table-view { margin-top: 8px; }
  details.table-view summary { cursor: pointer; color: var(--series-1); font-size: 13px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  nav.top { margin-bottom: 20px; }
  .fieldset { border: 1px solid var(--gridline); border-radius: 8px; padding: 14px; margin-bottom: 10px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function surveyRowHtml(s) {
  const activePill = s.is_active ? '<span class="pill active">פעיל בקו הטלפון</span>' : '<span class="pill">לא פעיל</span>';
  const modeLabel = s.mode === 'live' ? 'הצבעה חיה' : 'סקר רציף';
  return `
  <tr>
    <td><a href="/admin/survey/${s.id}">${esc(s.name)}</a></td>
    <td>${modeLabel}</td>
    <td>${s.question_count}</td>
    <td>${s.vote_count}</td>
    <td>${activePill}</td>
    <td class="row">
      ${s.is_active ? '' : `<form class="inline" method="post" action="/admin/survey/${s.id}/activate"><button class="primary">הפעל</button></form>`}
      <a href="/admin/survey/${s.id}/export.csv">CSV</a>
      <form class="inline" method="post" action="/admin/survey/${s.id}/delete" onsubmit="return confirm('למחוק את הסקר לצמיתות, כולל כל התוצאות?')">
        <button class="danger">מחק</button>
      </form>
    </td>
  </tr>`;
}

router.get('/', (req, res) => {
  const surveys = db.listSurveys();
  const rows = surveys.map(surveyRowHtml).join('') || `<tr><td colspan="6" class="muted">אין עדיין סקרים.</td></tr>`;
  const body = `
    <h1>ניהול סקר טלפוני</h1>
    <div class="card">
      <h2>הסקרים שלי</h2>
      <table>
        <thead><tr><th>שם</th><th>סוג</th><th>שאלות</th><th>הצבעות</th><th>סטטוס</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">רק סקר אחד יכול להיות "פעיל בקו הטלפון" בו-זמנית — זה הסקר שמתקשרים חדשים ישמעו.</p>
    </div>
    <div class="card">
      <h2>יצירת סקר חדש</h2>
      <form method="post" action="/admin/surveys">
        <div class="fieldset">
          <label>שם הסקר</label>
          <input type="text" name="name" required placeholder="לדוגמה: סקר שביעות רצון">
        </div>
        <div class="fieldset">
          <label>סוג הסקר</label>
          <select name="mode">
            <option value="sequential">סקר רציף — כל מתקשר עובר לבדו על כל השאלות</option>
            <option value="live">הצבעה חיה — כולם מצביעים על אותה שאלה פעילה (כמו קליקרים בכנס)</option>
          </select>
        </div>
        <button class="primary">צור סקר</button>
      </form>
    </div>
  `;
  res.send(layout('ניהול סקר טלפוני', body));
});

router.post('/surveys', (req, res) => {
  const name = field(req.body.name).trim() || 'סקר ללא שם';
  const mode = field(req.body.mode) === 'live' ? 'live' : 'sequential';
  const id = db.createSurvey(name, mode);
  res.redirect(`/admin/survey/${id}`);
});

router.post('/survey/:id/activate', (req, res) => {
  db.activateSurvey(Number(req.params.id));
  res.redirect(`/admin/survey/${req.params.id}`);
});

router.post('/survey/:id/delete', (req, res) => {
  db.deleteSurvey(Number(req.params.id));
  res.redirect('/admin');
});

router.post('/survey/:id/rename', (req, res) => {
  db.renameSurvey(Number(req.params.id), field(req.body.name).trim() || 'סקר ללא שם');
  res.redirect(`/admin/survey/${req.params.id}`);
});

router.post('/survey/:id/mode', (req, res) => {
  const mode = field(req.body.mode) === 'live' ? 'live' : 'sequential';
  db.setSurveyMode(Number(req.params.id), mode);
  res.redirect(`/admin/survey/${req.params.id}`);
});

router.post('/survey/:id/questions', (req, res) => {
  const surveyId = Number(req.params.id);
  const text = field(req.body.text).trim();
  const optionsRaw = field(req.body.options).trim();
  if (!text || !optionsRaw) return res.redirect(`/admin/survey/${surveyId}`);
  const pairs = optionsRaw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const idx = line.indexOf('=');
    if (idx === -1) return null;
    const digit = line.slice(0, idx).trim();
    const label = line.slice(idx + 1).trim();
    if (!digit || !label) return null;
    return [digit, label];
  }).filter(Boolean);
  if (pairs.length > 0) {
    db.addQuestion(surveyId, text, pairs);
  }
  res.redirect(`/admin/survey/${surveyId}`);
});

router.post('/survey/:id/questions/:qid/delete', (req, res) => {
  db.deleteQuestion(Number(req.params.qid));
  res.redirect(`/admin/survey/${req.params.id}`);
});

router.post('/survey/:id/position', (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = db.getSurvey(surveyId);
  if (survey) {
    const questions = db.listQuestions(surveyId);
    const maxPos = Math.max(0, questions.length - 1);
    let pos = survey.current_question_position;
    const direction = field(req.body.direction);
    if (direction === 'next') pos = Math.min(maxPos, pos + 1);
    if (direction === 'prev') pos = Math.max(0, pos - 1);
    db.setCurrentQuestionPosition(surveyId, pos);
  }
  res.redirect(`/admin/survey/${surveyId}`);
});

router.post('/survey/:id/reset-votes', (req, res) => {
  db.resetVotes(Number(req.params.id));
  res.redirect(`/admin/survey/${req.params.id}`);
});

function chartHtml(q, opts) {
  opts = opts || {};
  const rows = q.options.map((o) => {
    const pct = q.total > 0 ? Math.round((o.count / q.total) * 1000) / 10 : 0;
    return `
      <div class="bar-row">
        <div>${esc(o.digit)}. ${esc(o.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-value">${o.count} (${pct}%)</div>
      </div>`;
  }).join('');
  const tableRows = q.options.map((o) => {
    const pct = q.total > 0 ? Math.round((o.count / q.total) * 1000) / 10 : 0;
    return `<tr><td>${esc(o.digit)}</td><td>${esc(o.label)}</td><td>${o.count}</td><td>${pct}%</td></tr>`;
  }).join('');
  const badge = opts.live ? ' <span class="pill active">פעילה כעת</span>' : '';
  return `
    <div class="qcard" data-question-id="${q.id}">
      <div class="qhead">
        <h3>שאלה ${q.position + 1}: ${esc(q.text)}${badge}</h3>
        <span class="muted">${q.total} הצבעות</span>
      </div>
      <div class="chart">${rows}</div>
      <details class="table-view">
        <summary>הצג כטבלה</summary>
        <table>
          <thead><tr><th>מקש</th><th>אפשרות</th><th>מספר</th><th>אחוז</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </details>
    </div>`;
}

router.get('/survey/:id', (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = db.getSurvey(surveyId);
  if (!survey) return res.status(404).send('הסקר לא נמצא');
  const questions = db.listQuestions(surveyId);
  const results = db.resultsForSurvey(surveyId);

  const questionListHtml = questions.map((q) => {
    const opts = db.listOptions(q.id);
    const optLines = opts.map((o) => `<span class="muted">${esc(o.digit)}=${esc(o.label)}</span>`).join('  ');
    return `
      <div class="qcard">
        <div class="qhead">
          <h3>שאלה ${q.position + 1}: ${esc(q.text)}</h3>
          <form class="inline" method="post" action="/admin/survey/${surveyId}/questions/${q.id}/delete" onsubmit="return confirm('למחוק שאלה זו?')">
            <button class="danger">מחק שאלה</button>
          </form>
        </div>
        <div>${optLines}</div>
      </div>`;
  }).join('') || '<p class="muted">עדיין לא נוספו שאלות.</p>';

  const chartsHtml = results.map((q) => chartHtml(q, { live: survey.mode === 'live' && q.position === survey.current_question_position })).join('')
    || '<p class="muted">אין עדיין נתונים להצגה.</p>';

  const liveControls = survey.mode === 'live' ? `
    <div class="row" style="margin-bottom:14px">
      <form class="inline" method="post" action="/admin/survey/${surveyId}/position"><input type="hidden" name="direction" value="prev"><button>&larr; שאלה קודמת</button></form>
      <span class="muted">שאלה פעילה כעת: ${survey.current_question_position + 1} מתוך ${Math.max(questions.length, 1)}</span>
      <form class="inline" method="post" action="/admin/survey/${surveyId}/position"><input type="hidden" name="direction" value="next"><button>שאלה הבאה &rarr;</button></form>
    </div>` : '';

  const body = `
    <nav class="top"><a href="/admin">&rarr; כל הסקרים</a></nav>
    <h1>${esc(survey.name)} ${survey.is_active ? '<span class="pill active">פעיל בקו הטלפון</span>' : '<span class="pill">לא פעיל</span>'}</h1>

    <div class="card">
      <div class="grid-2">
        <form method="post" action="/admin/survey/${surveyId}/rename">
          <label>שם הסקר</label>
          <div class="row"><input type="text" name="name" value="${esc(survey.name)}"><button>שנה שם</button></div>
        </form>
        <form method="post" action="/admin/survey/${surveyId}/mode">
          <label>סוג הסקר</label>
          <div class="row">
            <select name="mode">
              <option value="sequential" ${survey.mode === 'sequential' ? 'selected' : ''}>סקר רציף</option>
              <option value="live" ${survey.mode === 'live' ? 'selected' : ''}>הצבעה חיה</option>
            </select>
            <button>עדכן</button>
          </div>
        </form>
      </div>
      <div class="row" style="margin-top:12px">
        ${survey.is_active ? '' : `<form class="inline" method="post" action="/admin/survey/${surveyId}/activate"><button class="primary">הפוך לסקר הפעיל בקו</button></form>`}
        <a href="/admin/survey/${surveyId}/export.csv"><button>ייצוא CSV</button></a>
        <form class="inline" method="post" action="/admin/survey/${surveyId}/reset-votes" onsubmit="return confirm('לאפס את כל התוצאות של הסקר הזה?')">
          <button class="danger">איפוס תוצאות</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h2>שאלות</h2>
      ${questionListHtml}
      <div class="qcard">
        <h3>הוספת שאלה</h3>
        <form method="post" action="/admin/survey/${surveyId}/questions">
          <div class="fieldset">
            <label>טקסט השאלה</label>
            <input type="text" name="text" required placeholder="לדוגמה: כמה הייתם ממליצים לחבר?">
          </div>
          <div class="fieldset">
            <label>אפשרויות — שורה אחת לכל אפשרות, בפורמט מקש=טקסט</label>
            <textarea name="options" placeholder="1=מאוד מרוצה&#10;2=מרוצה&#10;3=לא מרוצה"></textarea>
          </div>
          <button class="primary">הוסף שאלה</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h2>תוצאות</h2>
      ${liveControls}
      <div id="charts">${chartsHtml}</div>
      <p class="muted">הדף מתעדכן אוטומטית כל 4 שניות.</p>
    </div>

    <script>
      async function refresh() {
        try {
          const r = await fetch('/admin/survey/${surveyId}/api/results');
          const data = await r.json();
          const container = document.getElementById('charts');
          if (!data.questions.length) return;
          data.questions.forEach((q) => {
            const card = container.querySelector('[data-question-id="' + q.id + '"]');
            if (!card) return;
            card.querySelector('.muted').textContent = q.total + ' הצבעות';
            const rows = card.querySelectorAll('.bar-row');
            q.options.forEach((o, i) => {
              const row = rows[i];
              if (!row) return;
              const pct = q.total > 0 ? Math.round((o.count / q.total) * 1000) / 10 : 0;
              row.querySelector('.bar-fill').style.width = pct + '%';
              row.querySelector('.bar-value').textContent = o.count + ' (' + pct + '%)';
            });
          });
        } catch (e) { /* ignore transient errors */ }
      }
      setInterval(refresh, 4000);
    </script>
  `;
  res.send(layout(survey.name, body));
});

router.get('/survey/:id/api/results', (req, res) => {
  const results = db.resultsForSurvey(Number(req.params.id));
  res.json({ questions: results });
});

router.get('/survey/:id/export.csv', (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = db.getSurvey(surveyId);
  if (!survey) return res.status(404).send('הסקר לא נמצא');
  const rows = db.votesForExport(surveyId);
  const header = ['survey_name', 'question_position', 'question_text', 'digit', 'option_label', 'call_sid', 'from_number', 'created_at'];
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => csvEscape(r[h])).join(','));
  }
  const csv = '﻿' + lines.join('\n'); // BOM so Excel opens Hebrew correctly
  // HTTP headers must be ASCII, so the plain filename is a safe fallback and
  // filename* (RFC 5987) carries the real, possibly-Hebrew name for browsers that use it.
  const safeFallback = `survey-${surveyId}-results.csv`;
  const encodedName = encodeURIComponent(`${survey.name}-results.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodedName}`);
  res.send(csv);
});

module.exports = router;
