
const express = require('express');
const cors = require('cors');
const quotesRouter = require('./routes/quotes');
const uploadRouter = require('./routes/upload');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/quotes', quotesRouter);
app.use('/api/upload', uploadRouter);

module.exports = app;

