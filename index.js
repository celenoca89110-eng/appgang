require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const db = require('./db/database');
const { ensureAdmin } = require('./db/seed');

const authRoutes = require('./routes/auth');
const { router: gangsRoutes } = require('./routes/gangs');
const miscRoutes = require('./routes/misc');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[fatal] JWT_SECRET manquant dans .env - copiez .env.example vers .env et definissez-le.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io); // rend io accessible depuis les routes via req.app.get('io')

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- ROUTES API ----------
app.use('/api/auth', authRoutes);
app.use('/api/gangs', gangsRoutes);
app.use('/api', miscRoutes);

// Sante de l'API
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Gestionnaire d'erreurs centralise pour les routes async (next(err))
app.use((err, req, res, next) => {
  console.error('[api] Erreur non gérée :', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ---------- SOCKET.IO ----------
// Authentifie la connexion socket via le meme JWT que l'API REST
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentification requise pour le temps reel.'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = { id: payload.id, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    next(new Error('Token invalide.'));
  }
});

io.on('connection', (socket) => {
  console.log(`[socket] ${socket.user.username} connecte (${socket.id})`);
  socket.on('disconnect', () => {
    console.log(`[socket] ${socket.user.username} deconnecte (${socket.id})`);
  });
});

// Toute route non-API sert l'interface web (SPA simple)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Route API introuvable.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

async function start() {
  try {
    console.log('[init] Connexion à PostgreSQL et application des migrations...');
    await db.init(); // cree les tables au besoin, ne touche jamais aux donnees existantes
    await ensureAdmin(); // cree le compte admin initial si la table users est vide de ce username

    server.listen(PORT, () => {
      console.log(`\n=== GangApp GTA RP ===`);
      console.log(`Serveur demarre sur http://localhost:${PORT}`);
      console.log(`Base de donnees : PostgreSQL`);
      console.log(`API REST      : http://localhost:${PORT}/api`);
      console.log(`Temps reel    : Socket.io actif`);
      console.log(`======================\n`);
    });
  } catch (err) {
    console.error('[fatal] Échec du démarrage :', err);
    process.exit(1);
  }
}

start();
