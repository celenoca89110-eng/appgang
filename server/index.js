require('dotenv').config();

const initDB = require('./db/init');
const seed = require('./db/seed');
const db = require('./db/database');

const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');

// ✅ OPTION 2 SAFE IMPORT (évite undefined crash)
const gangsModule = require('./routes/gangs');
const gangsRoutes = gangsModule?.router;

const miscRoutes = require('./routes/misc');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[fatal] JWT_SECRET manquant');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// =====================
// DEBUG ROUTES SAFE CHECK
// =====================
function safeUse(path, route, name) {
  if (!route) {
    console.error(`❌ ROUTE MANQUANTE: ${name} (${path}) est undefined`);
    return;
  }
  app.use(path, route);
}

// =====================
// ROUTES API
// =====================
app.use('/api/auth', authRoutes);

// 🔥 FIX IMPORTANT ICI
safeUse('/api/gangs', gangsRoutes, 'gangsRoutes');
safeUse('/api', miscRoutes, 'miscRoutes');

// =====================
// DEBUG USERS
// =====================
app.get('/debug/users', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error('DEBUG ERROR:', err);
    res.status(500).json({
      error: 'DB error',
      details: err.message
    });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// =====================
// SOCKET.IO
// =====================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Auth requise'));

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error('Token invalide'));
  }
});

io.on('connection', (socket) => {
  console.log(`[socket] ${socket.user.username}`);
});

// =====================
// FRONT SPA
// =====================
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API not found' });
  }

  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// =====================
// START SERVER
// =====================
async function start() {
  try {
    console.log("🔄 Init DB...");
    await initDB();

    console.log("🔄 Seed...");
    await seed();

    server.listen(PORT, () => {
      console.log(`\n=== GangApp GTA RP ===`);
      console.log(`Serveur demarre sur http://localhost:${PORT}`);
      console.log(`API REST : http://localhost:${PORT}/api`);
      console.log(`Temps reel : Socket.io actif`);
      console.log(`======================\n`);
    });

  } catch (err) {
    console.error("❌ DB ERROR:", err);
    process.exit(1);
  }
}

start();
