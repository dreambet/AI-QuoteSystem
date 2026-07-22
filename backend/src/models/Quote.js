
const db = require('../db');

class Quote {
  static create(data) {
    return new Promise((resolve, reject) => {
      const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
      const now = new Date().toISOString();
      const {
        partName, partNumber, material, length, width, height, diameter,
        quantity, deliveryDate, precision
      } = data;

      const stmt = db.prepare(`
        INSERT INTO quotes (
          id, partName, partNumber, material, length, width, height, diameter,
          quantity, deliveryDate, precision, status, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id, partName, partNumber || '', material, length || 0, width || 0, height || 0, diameter || 0,
        quantity, deliveryDate || '', precision || '', 'draft', now, now,
        function(err) {
          if (err) reject(err);
          else resolve({ id, ...data, status: 'draft', createdAt: now, updatedAt: now });
        }
      );
    });
  }

  static findAll() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM quotes ORDER BY createdAt DESC', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => Quote._parseRow(row)));
      });
    });
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM quotes WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else if (!row) resolve(null);
        else resolve(Quote._parseRow(row));
      });
    });
  }

  static update(id, data) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const fields = [];
      const values = [];

      Object.keys(data).forEach(key => {
        if (key !== 'id' && key !== 'createdAt') {
          fields.push(`${key} = ?`);
          values.push(typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key]);
        }
      });
      fields.push('updatedAt = ?');
      values.push(now);
      values.push(id);

      const stmt = db.prepare(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`);
      stmt.run(values, function(err) {
        if (err) reject(err);
        else resolve(Quote.findById(id));
      });
    });
  }

  static _parseRow(row) {
    return {
      ...row,
      calculation: row.calculation ? JSON.parse(row.calculation) : null,
      aiReview: row.aiReview ? JSON.parse(row.aiReview) : null,
      manualReview: row.manualReview ? JSON.parse(row.manualReview) : null
    };
  }
}

module.exports = Quote;

