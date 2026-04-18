const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'mapa-colaborativo-segredo-local',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

function createFirebaseApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!projectId || !rawJson) {
    console.warn('[firebase] FIREBASE_PROJECT_ID ou FIREBASE_SERVICE_ACCOUNT_JSON ausentes. Usando fallback em memória.');
    return null;
  }

  const serviceAccount = JSON.parse(rawJson);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId
  });
}

const firebaseApp = createFirebaseApp();
const db = firebaseApp ? admin.firestore() : null;
const usersCollection = db ? db.collection('users') : null;
const markersCollection = db ? db.collection('markers') : null;
const memoryUsers = new Map();
const memoryMarkers = [];

function getSafeUser(req) {
  if (!req.session.user) {
    return null;
  }

  return {
    username: req.session.user.username
  };
}

async function findUserByUsername(username) {
  if (!usersCollection) {
    return memoryUsers.get(username) || null;
  }

  const snap = await usersCollection.doc(username).get();
  if (!snap.exists) {
    return null;
  }

  return snap.data();
}

async function createUser(username, password) {
  if (!usersCollection) {
    memoryUsers.set(username, { password });
    return;
  }

  await usersCollection.doc(username).set({
    username,
    password,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function loadMarkers() {
  if (!markersCollection) {
    return [...memoryMarkers];
  }

  const snap = await markersCollection.orderBy('createdAt', 'asc').get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function saveMarker(marker) {
  if (!markersCollection) {
    memoryMarkers.push(marker);
    return marker;
  }

  const payload = {
    lat: marker.lat,
    lng: marker.lng,
    type: marker.type,
    label: marker.label,
    author: marker.author,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const ref = await markersCollection.add(payload);
  const saved = await ref.get();

  return {
    id: saved.id,
    ...saved.data(),
    createdAt: saved.data().createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString()
  };
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    const foundUser = await findUserByUsername(username);
    if (foundUser) {
      return res.status(409).json({ error: 'Usuário já existe.' });
    }

    await createUser(username, password);
    req.session.user = { username };
    return res.status(201).json({ user: getSafeUser(req) });
  } catch (error) {
    return res.status(500).json({ error: `Erro ao registrar usuário: ${error.message}` });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    const record = await findUserByUsername(username);
    if (!record || record.password !== password) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    req.session.user = { username };
    return res.status(200).json({ user: getSafeUser(req) });
  } catch (error) {
    return res.status(500).json({ error: `Erro ao autenticar: ${error.message}` });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

app.get('/api/me', (req, res) => {
  const user = getSafeUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  return res.status(200).json({ user });
});

const io = new Server(server);

io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const req = socket.request;
  if (!req.session || !req.session.user) {
    return next(new Error('Não autenticado'));
  }

  return next();
});

io.on('connection', async (socket) => {
  const { username } = socket.request.session.user;

  try {
    const markers = await loadMarkers();
    socket.emit('markers:init', markers.map((marker) => ({
      ...marker,
      createdAt: marker.createdAt?.toDate?.()?.toISOString?.() || marker.createdAt || null
    })));
  } catch {
    socket.emit('markers:init', []);
  }

  socket.on('marker:add', async (payload) => {
    const { lat, lng, type, label } = payload || {};

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return;
    }

    if (!['radio', 'gprs'].includes(type)) {
      return;
    }

    try {
      const marker = await saveMarker({
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        lat,
        lng,
        type,
        label: typeof label === 'string' ? label.trim().slice(0, 120) : '',
        author: username,
        createdAt: new Date().toISOString()
      });

      io.emit('marker:added', {
        ...marker,
        createdAt: marker.createdAt?.toDate?.()?.toISOString?.() || marker.createdAt || null
      });
    } catch {
      socket.emit('marker:error', { error: 'Falha ao salvar marcador no Firebase.' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://localhost:${PORT}`);
});
