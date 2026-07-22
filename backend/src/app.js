
const express = require('express');
const cors = require('cors');
const quotesRouter = require('./routes/quotes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/quotes', quotesRouter);

module.exports = app;

