require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// Database Configuration
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;
let db;

if (isProduction) {
  // Use PostgreSQL for Cloud (Supabase/Render)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  db = {
    all: (sql, params, cb) => pool.query(sql, params).then(res => cb(null, res.rows)).catch(cb),
    run: (sql, params, cb) => pool.query(sql, params).then(res => cb.call({ lastID: res.insertId }, null)).catch(cb),
    get: (sql, params, cb) => pool.query(sql, params).then(res => cb(null, res.rows[0])).catch(cb)
  };

  // Create tables for Postgres
  const initDb = async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      type TEXT NOT NULL,
      year_month TEXT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS debts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      due_date TEXT,
      debt_type TEXT NOT NULL
    )`);
    console.log('PostgreSQL Tables Ready');
  };
  initDb().catch(console.error);

} else {
  // Use SQLite for Local
  const dbPath = path.resolve(__dirname, 'money_management.db');
  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error opening database', err.message);
    else console.log('Connected to the SQLite database.');
  });

  db = {
    all: (sql, params, cb) => sqliteDb.all(sql, params, cb),
    run: (sql, params, cb) => sqliteDb.run(sql, params, cb),
    get: (sql, params, cb) => sqliteDb.get(sql, params, cb)
  };

  sqliteDb.serialize(() => {
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      type TEXT CHECK(type IN ('Income', 'Expense')) NOT NULL,
      year_month TEXT NOT NULL
    )`);
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      due_date TEXT,
      debt_type TEXT CHECK(debt_type IN ('Short-term', 'Long-term')) NOT NULL
    )`);
  });
}

// API Endpoints for Debts

// Get all debts
app.get('/api/debts', (req, res) => {
  db.all('SELECT * FROM debts ORDER BY debt_type DESC, remaining_amount DESC', [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ data: rows });
  });
});

// Add a new debt
app.post('/api/debts', (req, res) => {
  const { name, total_amount, remaining_amount, due_date, debt_type } = req.body;
  const sql = 'INSERT INTO debts (name, total_amount, remaining_amount, due_date, debt_type) VALUES (?,?,?,?,?)';
  const params = [name, total_amount, remaining_amount, due_date, debt_type];
  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: 'success', data: { id: this.lastID, ...req.body } });
  });
});

// Update debt (e.g., when paying off)
app.put('/api/debts/:id', (req, res) => {
  const { name, total_amount, remaining_amount, due_date, debt_type } = req.body;
  const sql = 'UPDATE debts SET name = ?, total_amount = ?, remaining_amount = ?, due_date = ?, debt_type = ? WHERE id = ?';
  const params = [name, total_amount, remaining_amount, due_date, debt_type, req.params.id];
  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: 'updated' });
  });
});

// Delete a debt
app.delete('/api/debts/:id', (req, res) => {
  db.run('DELETE FROM debts WHERE id = ?', req.params.id, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: 'deleted' });
  });
});

// Get all transactions
app.get('/api/transactions', (req, res) => {
  const sql = 'SELECT * FROM transactions ORDER BY date DESC';
  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ data: rows });
  });
});

// Add a new transaction
app.post('/api/transactions', (req, res) => {
  const { date, description, amount, category, type } = req.body;
  const year_month = date.substring(0, 7); // YYYY-MM
  const sql = 'INSERT INTO transactions (date, description, amount, category, type, year_month) VALUES (?,?,?,?,?,?)';
  const params = [date, description, amount, category, type, year_month];
  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({
      message: 'success',
      data: { id: this.lastID, ...req.body, year_month }
    });
  });
});

// Update a transaction
app.put('/api/transactions/:id', (req, res) => {
  const { date, description, amount, category, type } = req.body;
  const year_month = date ? date.substring(0, 7) : undefined;
  
  let sql = 'UPDATE transactions SET ';
  let params = [];
  const fields = { date, description, amount, category, type, year_month };
  
  Object.keys(fields).forEach((key) => {
    if (fields[key] !== undefined) {
      sql += `${key} = ?, `;
      params.push(fields[key]);
    }
  });
  
  sql = sql.slice(0, -2); // remove last comma
  sql += ' WHERE id = ?';
  params.push(req.params.id);

  db.run(sql, params, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: 'updated', rows: this.changes });
  });
});

// Delete a transaction
app.delete('/api/transactions/:id', (req, res) => {
  db.run('DELETE FROM transactions WHERE id = ?', req.params.id, function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ message: 'deleted', rows: this.changes });
  });
});

// Get summary for a specific month
app.get('/api/summary/:yearMonth', (req, res) => {
  const ym = req.params.yearMonth;
  const sql = `
    SELECT 
      SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END) as totalIncome,
      SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END) as totalExpense
    FROM transactions 
    WHERE year_month = ?
  `;
  db.get(sql, [ym], (err, row) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.json({ data: row });
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
