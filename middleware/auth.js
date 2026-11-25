const basicAuth = require('basic-auth');

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).send('ADMIN_PASSWORD is not set on the server.');
  }
  const creds = basicAuth(req);
  if (!creds || creds.name !== 'admin' || creds.pass !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

function voiceAuth(req, res, next) {
  const expected = process.env.VOICE_WEBHOOK_SECRET;
  if (expected && req.query.key !== expected) {
    return res.status(403).send('Forbidden');
  }
  next();
}

module.exports = { adminAuth, voiceAuth };
