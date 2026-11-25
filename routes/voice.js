const express = require('express');
const twilio = require('twilio');
const db = require('../db');
const { voiceAuth } = require('../middleware/auth');

const router = express.Router();
const VoiceResponse = twilio.twiml.VoiceResponse;

const VOICE_LANGUAGE = 'he-IL';
const VOICE_NAME = 'Polly.Ayelet'; // Amazon Polly Hebrew voice, available in Twilio
const MAX_ATTEMPTS = 2;

function actionUrl(path, params) {
  const key = process.env.VOICE_WEBHOOK_SECRET;
  const qs = new URLSearchParams(params || {});
  if (key) qs.set('key', key);
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

function questionPrompt(question, options) {
  const optionsText = options.map((o) => `הקש ${o.digit} עבור ${o.label}.`).join(' ');
  return `${question.text}. ${optionsText}`;
}

function sayNoSurvey(res) {
  const vr = new VoiceResponse();
  vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'מצטערים, אין כרגע סקר פעיל. נסו שוב מאוחר יותר.');
  vr.hangup();
  res.type('text/xml').send(vr.toString());
}

function sayNotReady(res) {
  const vr = new VoiceResponse();
  vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'הסקר עדיין לא מוכן. נסו שוב מאוחר יותר.');
  vr.hangup();
  res.type('text/xml').send(vr.toString());
}

function gatherQuestion({ res, question, options, actionPath, actionParams, prefix }) {
  const vr = new VoiceResponse();
  const gather = vr.gather({
    numDigits: 1,
    timeout: 8,
    action: actionUrl(actionPath, actionParams),
    method: 'POST',
  });
  const text = (prefix ? prefix + ' ' : '') + questionPrompt(question, options);
  gather.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, text);
  // Falls through here only if no input was received at all.
  vr.redirect({ method: 'POST' }, actionUrl(actionPath, { ...actionParams, attempt: Number(actionParams.attempt || 1) + 1 }));
  res.type('text/xml').send(vr.toString());
}

// Entry point: Twilio calls this when someone dials the number.
router.post('/incoming', voiceAuth, (req, res) => {
  const survey = db.getActiveSurvey();
  if (!survey) return sayNoSurvey(res);

  if (survey.mode === 'live') {
    const question = db.getQuestionByPosition(survey.id, survey.current_question_position);
    if (!question) return sayNotReady(res);
    const options = db.listOptions(question.id);
    if (options.length === 0) return sayNotReady(res);
    return gatherQuestion({
      res,
      question,
      options,
      actionPath: '/voice/live-vote',
      actionParams: { survey_id: survey.id, question_id: question.id, attempt: 1 },
    });
  }

  // sequential mode
  const firstQuestion = db.getQuestionByPosition(survey.id, 0);
  if (!firstQuestion) return sayNotReady(res);
  const options = db.listOptions(firstQuestion.id);
  db.getOrCreateSession(req.body.CallSid, survey.id, req.body.From);
  return gatherQuestion({
    res,
    question: firstQuestion,
    options,
    actionPath: '/voice/sequential-answer',
    actionParams: { survey_id: survey.id, question_id: firstQuestion.id, attempt: 1 },
  });
});

// One call = one vote on whichever question is currently "live" for the room.
router.post('/live-vote', voiceAuth, (req, res) => {
  const surveyId = Number(req.query.survey_id);
  const questionId = Number(req.query.question_id);
  const attempt = Number(req.query.attempt || 1);
  const digits = req.body.Digits;

  const question = db.getQuestion(questionId);
  const options = db.listOptions(questionId);
  const matched = options.find((o) => o.digit === digits);

  if (matched) {
    db.recordVote({
      surveyId,
      questionId,
      callSid: req.body.CallSid,
      fromNumber: req.body.From,
      digit: matched.digit,
      optionLabel: matched.label,
    });
    const vr = new VoiceResponse();
    vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'תודה, הקול שלך נרשם בהצלחה. יום טוב.');
    vr.hangup();
    return res.type('text/xml').send(vr.toString());
  }

  if (attempt <= MAX_ATTEMPTS && question) {
    return gatherQuestion({
      res,
      question,
      options,
      actionPath: '/voice/live-vote',
      actionParams: { survey_id: surveyId, question_id: questionId, attempt: attempt + 1 },
      prefix: 'הבחירה שהוקשה אינה תקינה.',
    });
  }

  const vr = new VoiceResponse();
  vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'לא התקבלה בחירה תקינה. תודה ולהתראות.');
  vr.hangup();
  res.type('text/xml').send(vr.toString());
});

// Sequential mode: each caller walks their own path through every question.
router.post('/sequential-answer', voiceAuth, (req, res) => {
  const surveyId = Number(req.query.survey_id);
  const questionId = Number(req.query.question_id);
  const attempt = Number(req.query.attempt || 1);
  const digits = req.body.Digits;
  const callSid = req.body.CallSid;

  const question = db.getQuestion(questionId);
  const options = db.listOptions(questionId);
  const matched = options.find((o) => o.digit === digits);

  if (!matched) {
    if (attempt <= MAX_ATTEMPTS && question) {
      return gatherQuestion({
        res,
        question,
        options,
        actionPath: '/voice/sequential-answer',
        actionParams: { survey_id: surveyId, question_id: questionId, attempt: attempt + 1 },
        prefix: 'הבחירה שהוקשה אינה תקינה.',
      });
    }
    db.completeSession(callSid);
    const vr = new VoiceResponse();
    vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'לא התקבלה תשובה תקינה. תודה ולהתראות.');
    vr.hangup();
    return res.type('text/xml').send(vr.toString());
  }

  db.recordVote({
    surveyId,
    questionId,
    callSid,
    fromNumber: req.body.From,
    digit: matched.digit,
    optionLabel: matched.label,
  });

  const nextPosition = question.position + 1;
  const nextQuestion = db.getQuestionByPosition(surveyId, nextPosition);

  if (nextQuestion) {
    db.advanceSession(callSid, nextPosition);
    const nextOptions = db.listOptions(nextQuestion.id);
    return gatherQuestion({
      res,
      question: nextQuestion,
      options: nextOptions,
      actionPath: '/voice/sequential-answer',
      actionParams: { survey_id: surveyId, question_id: nextQuestion.id, attempt: 1 },
    });
  }

  db.completeSession(callSid);
  const vr = new VoiceResponse();
  vr.say({ language: VOICE_LANGUAGE, voice: VOICE_NAME }, 'תודה רבה! סיימת את הסקר כולו.');
  vr.hangup();
  res.type('text/xml').send(vr.toString());
});

module.exports = router;
