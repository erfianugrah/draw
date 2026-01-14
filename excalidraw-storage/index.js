const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'excalidraw.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
  res.send('Excalidraw storage server is up :)');
});

// Get drawing by ID - matches Excalidraw's expected API format
// GET /api/v2/:id
app.get('/api/v2/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('SELECT data FROM drawings WHERE id = ?');
    const row = stmt.get(id);
    
    if (!row) {
      return res.status(404).json({ error: 'Drawing not found' });
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(row.data);
  } catch (error) {
    console.error('Error getting drawing:', error);
    res.status(500).json({ error: 'Failed to get drawing' });
  }
});

// Save new drawing - matches Excalidraw's expected API format
// POST /api/v2/post/
app.post('/api/v2/post/', (req, res) => {
  try {
    const id = nanoid(22);
    const data = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    const stmt = db.prepare('INSERT INTO drawings (id, data) VALUES (?, ?)');
    stmt.run(id, data);
    
    // Return the response format Excalidraw expects
    res.json({ id });
  } catch (error) {
    console.error('Error saving drawing:', error);
    res.status(500).json({ error: 'Failed to save drawing' });
  }
});

// Update existing drawing
app.put('/api/v2/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    const stmt = db.prepare(`
      UPDATE drawings 
      SET data = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    const result = stmt.run(data, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Drawing not found' });
    }
    
    res.json({ id });
  } catch (error) {
    console.error('Error updating drawing:', error);
    res.status(500).json({ error: 'Failed to update drawing' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Excalidraw storage server listening on port ${PORT}`);
  console.log(`Database: ${dbPath}`);
});
