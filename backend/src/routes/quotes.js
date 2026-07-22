
const express = require('express');
const router = express.Router();
const Quote = require('../models/Quote');

router.post('/', async (req, res) => {
  try {
    const quote = await Quote.create(req.body);
    res.status(201).json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const quotes = await Quote.findAll();
    res.json(quotes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const quote = await Quote.update(req.params.id, req.body);
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

