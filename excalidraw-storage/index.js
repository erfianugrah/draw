const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// API key authentication (optional - set API_KEY env var to enable)
const API_KEY = process.env.API_KEY || '';

// Cleanup configuration (in days)
const ROOM_MAX_AGE_DAYS = parseInt(process.env.ROOM_MAX_AGE_DAYS || '30', 10);
const EXPORT_MAX_AGE_DAYS = parseInt(process.env.EXPORT_MAX_AGE_DAYS || '30', 10);
const DRAWING_MAX_AGE_DAYS = parseInt(process.env.DRAWING_MAX_AGE_DAYS || '90', 10);
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || '24', 10);

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'excalidraw.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Enable foreign key enforcement [L2]
db.pragma('foreign_keys = ON');

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

// Enable incremental vacuum mode for non-blocking space reclaim [M3]
db.pragma('auto_vacuum = INCREMENTAL');

// ============================================
// Auto-cleanup of old data
// ============================================

const VACUUM_THRESHOLD = 100; // Only vacuum if more than this many rows deleted

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
    
    const totalDeleted = roomResult.changes + orphanedFiles.changes + exportResult.changes + drawingResult.changes;
    console.log(`[cleanup] ${roomResult.changes} rooms, ${orphanedFiles.changes} orphaned files, ${exportResult.changes} exports, ${drawingResult.changes} drawings deleted`);
    
    // Only vacuum if significant deletions occurred [M3]
    if (totalDeleted >= VACUUM_THRESHOLD) {
      console.log(`[cleanup] Running incremental vacuum (${totalDeleted} rows deleted)`);
      db.pragma('incremental_vacuum');
    }
  } catch (error) {
    console.error('[cleanup] Error:', error);
  }
};

// Run cleanup on startup
runCleanup();

// Schedule periodic cleanup
const cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

// ============================================
// Graceful shutdown [M4]
// ============================================

const shutdown = (signal) => {
  console.log(`[shutdown] Received ${signal}, closing gracefully...`);
  clearInterval(cleanupInterval);
  try {
    db.close();
    console.log('[shutdown] Database closed');
  } catch (err) {
    console.error('[shutdown] Error closing database:', err);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================
// Middleware
// ============================================

// Request logging [L4]
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || true, // true = reflect request origin (required for credentials)
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'CF-Access-Client-Id', 'CF-Access-Client-Secret', 'X-API-Key']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));

// API key authentication middleware [H2]
// Only enforced on write endpoints when API_KEY is configured.
// Requests from the Excalidraw frontend pass through Cloudflare Access
// (which sets Cf-Access-Jwt-Assertion header), so those are allowed through.
// The API key is for external/programmatic access protection.
const requireApiKey = (req, res, next) => {
  if (!API_KEY) {
    return next(); // No API key configured, skip auth
  }
  // Allow requests that passed through Cloudflare Access (JWT present)
  if (req.headers['cf-access-jwt-assertion']) {
    return next();
  }
  const provided = req.headers['x-api-key'];
  if (provided === API_KEY) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
};

// Health check (no auth required)
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Excalidraw storage server is up',
    authEnabled: !!API_KEY,
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

// Get drawing by ID (read - no auth required)
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
    console.error('[drawings] Error getting drawing:', error);
    res.status(500).json({ error: 'Failed to get drawing' });
  }
});

// Save new drawing (write - auth required)
app.post('/api/v2/post/', requireApiKey, (req, res) => {
  try {
    const id = nanoid(22);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    
    const stmt = db.prepare('INSERT INTO drawings (id, data) VALUES (?, ?)');
    stmt.run(id, data);
    
    res.json({ id });
  } catch (error) {
    console.error('[drawings] Error saving drawing:', error);
    res.status(500).json({ error: 'Failed to save drawing' });
  }
});

// ============================================
// Exports API (for shareable exports)
// ============================================

// Get export by ID (read - no auth required)
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
    console.error('[exports] Error getting export:', error);
    res.status(500).json({ error: 'Failed to get export' });
  }
});

// Save export (write - auth required)
app.post('/api/v2/exports/:id', requireApiKey, (req, res) => {
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
    console.error('[exports] Error saving export:', error);
    res.status(500).json({ error: 'Failed to save export' });
  }
});

// ============================================
// Rooms API (for collaboration)
// ============================================

// Get room scene data (read - no auth required)
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
    console.error('[rooms] Error getting room:', error);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// Save/update room scene data (write - auth required)
// Uses atomic sceneVersion check — only accepts writes with a higher version
// to prevent concurrent clients from overwriting each other's changes.
// The client-side reconcileElements() merges before sending, so a stale
// sceneVersion means the client needs to re-fetch and reconcile.
app.post('/api/v2/rooms/:roomId', requireApiKey, (req, res) => {
  try {
    const { roomId } = req.params;
    const { sceneVersion, iv, ciphertext } = req.body;
    
    const ivBuffer = iv ? Buffer.from(iv, 'base64') : null;
    const ciphertextBuffer = ciphertext ? Buffer.from(ciphertext, 'base64') : null;
    
    const result = db.prepare(`
      INSERT INTO rooms (id, scene_version, iv, ciphertext)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scene_version = excluded.scene_version,
        iv = excluded.iv,
        ciphertext = excluded.ciphertext,
        updated_at = strftime('%s', 'now')
      WHERE excluded.scene_version > rooms.scene_version
    `).run(roomId, sceneVersion, ivBuffer, ciphertextBuffer);
    
    if (result.changes === 0) {
      return res.status(409).json({ error: 'Conflict: stale sceneVersion' });
    }
    
    res.json({ success: true, roomId });
  } catch (error) {
    console.error('[rooms] Error saving room:', error);
    res.status(500).json({ error: 'Failed to save room' });
  }
});

// ============================================
// Files API (for room assets)
// ============================================

// Get file - supports multiple path segments (read - no auth required)
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
    console.error('[files] Error getting file:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// Save file - supports multiple path segments (write - auth required)
app.post('/api/v2/files/*', requireApiKey, (req, res) => {
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
    console.error('[files] Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Excalidraw storage server listening on port ${PORT}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Auth: ${API_KEY ? 'API key enabled' : 'disabled (set API_KEY to enable)'}`);
  console.log(`Cleanup: rooms ${ROOM_MAX_AGE_DAYS}d, exports ${EXPORT_MAX_AGE_DAYS}d, drawings ${DRAWING_MAX_AGE_DAYS}d, interval ${CLEANUP_INTERVAL_HOURS}h`);
});
