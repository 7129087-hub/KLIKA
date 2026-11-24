require('dotenv').config();
const express = require('express');

const { adminAuth } = require('./middleware/auth');
const voiceRouter = require('./routes/voice');
const adminRouter = require('./routes/admin');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded bodies
app.use(express.json());

app.get('/', (req, res) => res.redirect('/admin'));

app.use('/voice', voiceRouter);
app.use('/admin', adminAuth, adminRouter);

app.use((req, res) => res.status(404).send('Not found'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Phone survey server listening on port ${port}`);
});
