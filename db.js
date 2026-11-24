const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/survey.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sequential',
    current_question_position INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    digit TEXT NOT NULL,
    label TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS call_sessions (
    call_sid TEXT PRIMARY KEY,
    survey_id INTEGER NOT NULL,
    current_position INTEGER NOT NULL DEFAULT 0,
    from_number TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    call_sid TEXT,
    from_number TEXT,
    digit TEXT NOT NULL,
    option_label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_questions_survey ON questions(survey_id, position);
  CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
  CREATE INDEX IF NOT EXISTS idx_votes_survey ON votes(survey_id);
  CREATE INDEX IF NOT EXISTS idx_votes_question ON votes(question_id);
`);

// ---------- surveys ----------
function listSurveys() {
  return db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM questions q WHERE q.survey_id = s.id) AS question_count,
      (SELECT COUNT(*) FROM votes v WHERE v.survey_id = s.id) AS vote_count
    FROM surveys s ORDER BY s.created_at DESC
  `).all();
}

function getSurvey(id) {
  return db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
}

function getActiveSurvey() {
  return db.prepare('SELECT * FROM surveys WHERE is_active = 1 LIMIT 1').get();
}

function createSurvey(name, mode) {
  const info = db.prepare('INSERT INTO surveys (name, mode) VALUES (?, ?)').run(name, mode);
  return info.lastInsertRowid;
}

function setSurveyMode(id, mode) {
  db.prepare('UPDATE surveys SET mode = ?, current_question_position = 0 WHERE id = ?').run(mode, id);
}

function renameSurvey(id, name) {
  db.prepare('UPDATE surveys SET name = ? WHERE id = ?').run(name, id);
}

function activateSurvey(id) {
  const tx = db.transaction((id) => {
    db.prepare('UPDATE surveys SET is_active = 0').run();
    db.prepare('UPDATE surveys SET is_active = 1 WHERE id = ?').run(id);
  });
  tx(id);
}

function deleteSurvey(id) {
  db.prepare('DELETE FROM surveys WHERE id = ?').run(id);
}

function setCurrentQuestionPosition(surveyId, position) {
  db.prepare('UPDATE surveys SET current_question_position = ? WHERE id = ?').run(position, surveyId);
}

function resetVotes(surveyId) {
  const tx = db.transaction((surveyId) => {
    db.prepare('DELETE FROM votes WHERE survey_id = ?').run(surveyId);
    db.prepare('DELETE FROM call_sessions WHERE survey_id = ?').run(surveyId);
  });
  tx(surveyId);
}

// ---------- questions ----------
function listQuestions(surveyId) {
  return db.prepare('SELECT * FROM questions WHERE survey_id = ? ORDER BY position ASC').all(surveyId);
}

function getQuestion(id) {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
}

function getQuestionByPosition(surveyId, position) {
  return db.prepare('SELECT * FROM questions WHERE survey_id = ? AND position = ?').get(surveyId, position);
}

function addQuestion(surveyId, text, optionPairs) {
  const nextPos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM questions WHERE survey_id = ?').get(surveyId).p;
  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO questions (survey_id, position, text) VALUES (?, ?, ?)').run(surveyId, nextPos, text);
    const questionId = info.lastInsertRowid;
    const insertOpt = db.prepare('INSERT INTO options (question_id, digit, label) VALUES (?, ?, ?)');
    for (const [digit, label] of optionPairs) {
      insertOpt.run(questionId, digit, label);
    }
    return questionId;
  });
  return tx();
}

function deleteQuestion(id) {
  const q = getQuestion(id);
  if (!q) return;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    // close the gap in positions
    db.prepare('UPDATE questions SET position = position - 1 WHERE survey_id = ? AND position > ?')
      .run(q.survey_id, q.position);
  });
  tx();
}

// ---------- options ----------
function listOptions(questionId) {
  return db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY id ASC').all(questionId);
}

// ---------- call sessions ----------
function getOrCreateSession(callSid, surveyId, fromNumber) {
  let session = db.prepare('SELECT * FROM call_sessions WHERE call_sid = ?').get(callSid);
  if (!session) {
    db.prepare('INSERT INTO call_sessions (call_sid, survey_id, current_position, from_number) VALUES (?, ?, 0, ?)')
      .run(callSid, surveyId, fromNumber);
    session = db.prepare('SELECT * FROM call_sessions WHERE call_sid = ?').get(callSid);
  }
  return session;
}

function advanceSession(callSid, position) {
  db.prepare('UPDATE call_sessions SET current_position = ? WHERE call_sid = ?').run(position, callSid);
}

function completeSession(callSid) {
  db.prepare("UPDATE call_sessions SET completed_at = datetime('now') WHERE call_sid = ?").run(callSid);
}

// ---------- votes ----------
function recordVote({ surveyId, questionId, callSid, fromNumber, digit, optionLabel }) {
  db.prepare(`
    INSERT INTO votes (survey_id, question_id, call_sid, from_number, digit, option_label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(surveyId, questionId, callSid, fromNumber, digit, optionLabel);
}

function resultsForSurvey(surveyId) {
  const questions = listQuestions(surveyId);
  return questions.map((q) => {
    const options = listOptions(q.id);
    const counts = db.prepare('SELECT option_label, COUNT(*) AS c FROM votes WHERE question_id = ? GROUP BY option_label')
      .all(q.id);
    const countByLabel = Object.fromEntries(counts.map((r) => [r.option_label, r.c]));
    const optionResults = options.map((o) => ({
      digit: o.digit,
      label: o.label,
      count: countByLabel[o.label] || 0,
    }));
    const total = optionResults.reduce((sum, o) => sum + o.count, 0);
    return { id: q.id, position: q.position, text: q.text, options: optionResults, total };
  });
}

function votesForExport(surveyId) {
  return db.prepare(`
    SELECT s.name AS survey_name, q.position AS question_position, q.text AS question_text,
           v.digit, v.option_label, v.call_sid, v.from_number, v.created_at
    FROM votes v
    JOIN questions q ON q.id = v.question_id
    JOIN surveys s ON s.id = v.survey_id
    WHERE v.survey_id = ?
    ORDER BY v.created_at ASC
  `).all(surveyId);
}

module.exports = {
  db,
  listSurveys, getSurvey, getActiveSurvey, createSurvey, setSurveyMode, renameSurvey,
  activateSurvey, deleteSurvey, setCurrentQuestionPosition, resetVotes,
  listQuestions, getQuestion, getQuestionByPosition, addQuestion, deleteQuestion,
  listOptions,
  getOrCreateSession, advanceSession, completeSession,
  recordVote, resultsForSurvey, votesForExport,
};
