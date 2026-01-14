const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// Cleanup configuration (in days)
const ROOM_MAX_AGE_DAYS = parseInt(process.env.ROOM_MAX_AGE_DAYS || '30', 10);
const EXPORT_MAX_AGE_DAYS = parseInt(process.env.EXPORT_MAX_AGE_DAYS || '30', 10);
const DRAWING_MAX_AGE_DAYS = parseInt(process.env.DRAWING_MAX_AGE_DAYS || '90', 10);
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10);

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'excalidraw.db');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Rooms table for collaboration
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    scene_version INTEGER DEFAULT 0,
    iv BLOB,
    ciphertext BLOB,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Files table for room assets and export files
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    data BLOB NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  )
`);

// Exports table for shareable exports
db.exec(`
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// ============================================
// Auto-cleanup of old data
// ============================================

const runCleanup = () => {
  const now = Math.floor(Date.now() / 1000);
  
  try {
    // Delete old rooms
    const roomCutoff = now - (ROOM_MAX_AGE_DAYS * 24 * 60 * 60);
    const roomResult = db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(roomCutoff);
    
    // Delete orphaned files (files whose room was deleted)
    const orphanedFiles = db.prepare(`
      DELETE FROM files WHERE room_id IS NOT NULL 
      AND room_id NOT IN (SELECT id FROM rooms)
    `).run();
    
    // Delete old exports
    const exportCutoff = now - (EXPORT_MAX_AGE_DAYS * 24 * 60 * 60);
    const exportResult = db.prepare('DELETE FROM exports WHERE created_at < ?').run(exportCutoff);
    
    // Delete old drawings (shareable links)
    const drawingCutoff = now - (DRAWING_MAX_AGE_DAYS * 24 * 60 * 60);
    const drawingResult = db.prepare('DELETE FROM drawings WHERE updated_at < ?').run(drawingCutoff);
    
    console.log(`Cleanup completed: ${roomResult.changes} rooms, ${orphanedFiles.changes} orphaned files, ${exportResult.changes} exports, ${drawingResult.changes} drawings deleted`);
    
    // Vacuum the database to reclaim space
    db.exec('VACUUM');
  } catch (error) {
    console.error('Cleanup error:', error);
  }
};

// Run cleanup on startup
runCleanup();

// Schedule periodic cleanup
setInterval(runCleanup, CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

// ============================================
// Middleware
// ============================================

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Excalidraw storage server is up',
    cleanup: {
      roomMaxAgeDays: ROOM_MAX_AGE_DAYS,
      exportMaxAgeDays: EXPORT_MAX_AGE_DAYS,
      drawingMaxAgeDays: DRAWING_MAX_AGE_DAYS,
      intervalHours: CLEANUP_INTERVAL_HOURS
    }
  });
});

// ============================================
// Shareable Links API
// ============================================

// Get drawing by ID
app.get('/api/v2/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('SELECT data FROM drawings WHERE id = ?');
    const row = stmt.get(id);
    
    if (!row) {
      return res.status(404).json({ error: 'Drawing not found' });
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(row.data));
  } catch (error) {
    console.error('Error getting drawing:', error);
    res.status(500).json({ error: 'Failed to get drawing' });
  }
});

// Save new drawing
app.post('/api/v2/post/', (req, res) => {
  try {
    const id = nanoid(22);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    
    const stmt = db.prepare('INSERT INTO drawings (id, data) VALUES (?, ?)');
    stmt.run(id, data);
    
    res.json({ id });
  } catch (error) {
    console.error('Error saving drawing:', error);
    res.status(500).json({ error: 'Failed to save drawing' });
  }
});

// ============================================
// Exports API (for shareable exports)
// ============================================

// Get export by ID
app.get('/api/v2/exports/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.prepare('SELECT data FROM exports WHERE id = ?');
    const row = stmt.get(id);
    
    if (!row) {
      return res.status(404).json({ error: 'Export not found' });
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(row.data));
  } catch (error) {
    console.error('Error getting export:', error);
    res.status(500).json({ error: 'Failed to get export' });
  }
});

// Save export
app.post('/api/v2/exports/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    
    const stmt = db.prepare(`
      INSERT INTO exports (id, data)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `);
    stmt.run(id, data);
    
    res.json({ success: true, id });
  } catch (error) {
    console.error('Error saving export:', error);
    res.status(500).json({ error: 'Failed to save export' });
  }
});

// ============================================
// Rooms API (for collaboration)
// ============================================

// Get room scene data
app.get('/api/v2/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const stmt = db.prepare('SELECT scene_version, iv, ciphertext FROM rooms WHERE id = ?');
    const row = stmt.get(roomId);
    
    if (!row) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({
      sceneVersion: row.scene_version,
      iv: row.iv ? Buffer.from(row.iv).toString('base64') : null,
      ciphertext: row.ciphertext ? Buffer.from(row.ciphertext).toString('base64') : null
    });
  } catch (error) {
    console.error('Error getting room:', error);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// Save/update room scene data
app.post('/api/v2/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const { sceneVersion, iv, ciphertext } = req.body;
    
    const ivBuffer = iv ? Buffer.from(iv, 'base64') : null;
    const ciphertextBuffer = ciphertext ? Buffer.from(ciphertext, 'base64') : null;
    
    const stmt = db.prepare(`
      INSERT INTO rooms (id, scene_version, iv, ciphertext)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scene_version = excluded.scene_version,
        iv = excluded.iv,
        ciphertext = excluded.ciphertext,
        updated_at = strftime('%s', 'now')
    `);
    stmt.run(roomId, sceneVersion, ivBuffer, ciphertextBuffer);
    
    res.json({ success: true, roomId });
  } catch (error) {
    console.error('Error saving room:', error);
    res.status(500).json({ error: 'Failed to save room' });
  }
});

// ============================================
// Files API (for room assets)
// ============================================

// Get file - supports multiple path segments
app.get('/api/v2/files/*', (req, res) => {
  try {
    const fullPath = req.params[0];
    const stmt = db.prepare('SELECT data FROM files WHERE id = ?');
    const row = stmt.get(fullPath);
    
    if (!row) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(row.data));
  } catch (error) {
    console.error('Error getting file:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// Save file - supports multiple path segments
app.post('/api/v2/files/*', (req, res) => {
  try {
    const fullPath = req.params[0];
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    
    const stmt = db.prepare(`
      INSERT INTO files (id, data)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `);
    stmt.run(fullPath, data);
    
    res.json({ success: true, id: fullPath });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Excalidraw storage server listening on port ${PORT}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Cleanup: rooms ${ROOM_MAX_AGE_DAYS}d, exports ${EXPORT_MAX_AGE_DAYS}d, drawings ${DRAWING_MAX_AGE_DAYS}d, interval ${CLEANUP_INTERVAL_HOURS}h`);
});
