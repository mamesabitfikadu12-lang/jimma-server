const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const DB_FILE = './ethio_voice_db.json';
const SUD_APP_ID = '2122085803670614016';
const SUD_APP_SECRET = 'tb2umxnklxv9vz482n4ayptvhau6yah7';

let db = {
  users: {
    'admin@ethiovoice.com': {
      uid: '1000001',
      name: 'Mohammedsabit (Founder)',
      contact: 'admin@ethiovoice.com',
      pass: '142730',
      coins: 500000,
      points: 250000,
      vipLevel: 19,
      hostLv: 15,
      wealthLv: 20,
      totalGifted: 120000,
      totalReceived: 95000,
      isAgency: true,
      isCoinSeller: true
    }
  },
  otps: {},
  pendingRecharges: [],
  usedHashes: []
};

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = Object.assign(db.users, loaded.users || {});
    db.pendingRecharges = loaded.pendingRecharges || [];
    db.usedHashes = loaded.usedHashes || [];
  } catch (e) {}
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {}
}

app.get('/', (req, res) => {
  res.json({ status: 'Ethio-Voice Cloud Server Active', usersCount: Object.keys(db.users).length });
});

// 1. SIGN UP
app.post('/api/auth/signup', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase();
  const name = (req.body.name || '').trim();
  const pass = (req.body.pass || '').trim();
  const ref = (req.body.ref || '').trim();

  if (!contact || !name || pass.length < 6) {
    return res.status(400).json({ ok: false, msg: 'Enter valid Name, Email/Phone & Password (min 6 chars)' });
  }
  if (db.users[contact]) {
    return res.status(409).json({ ok: false, msg: 'Account already exists! Please Login.' });
  }
  const uid = String(1000000 + Object.keys(db.users).length + 1);
  const startCoins = ref.length >= 5 ? 1500 : 1000;
  db.users[contact] = {
    uid, name, contact, pass,
    coins: startCoins, points: 0, vipLevel: 0, hostLv: 1, wealthLv: 1,
    totalGifted: 0, totalReceived: 0, isAgency: false, isCoinSeller: false
  };
  saveDb();
  res.json({ ok: true, user: db.users[contact] });
});

// 2. STRICT LOGIN
app.post('/api/auth/login', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase();
  const pass = (req.body.pass || '').trim();
  const u = db.users[contact];
  if (!u || u.pass !== pass) {
    return res.status(401).json({ ok: false, msg: 'Wrong Email/Phone or Incorrect Password!' });
  }
  res.json({ ok: true, user: u });
});

// 3. FORGOT PASSWORD OTP
app.post('/api/auth/send-otp', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase();
  if (!db.users[contact]) {
    return res.status(404).json({ ok: false, msg: 'No account found with this Email/Phone!' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.otps[contact] = { code, exp: Date.now() + 10 * 60 * 1000 };
  saveDb();
  res.json({ ok: true, code });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  const newPass = (req.body.newPass || '').trim();
  const record = db.otps[contact];
  if (!record || record.code !== code || Date.now() > record.exp) {
    return res.status(400).json({ ok: false, msg: 'Invalid or expired 6-digit code!' });
  }
  if (newPass.length >= 6) db.users[contact].pass = newPass;
  delete db.otps[contact];
  saveDb();
  res.json({ ok: true, user: db.users[contact] });
});

// 4. PERMANENT USER SYNC
app.post('/api/user/sync', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase();
  if (db.users[contact]) {
    const u = db.users[contact];
    if (typeof req.body.coins === 'number') u.coins = req.body.coins;
    if (typeof req.body.points === 'number') u.points = req.body.points;
    if (typeof req.body.vipLevel === 'number') u.vipLevel = req.body.vipLevel;
    if (typeof req.body.hostLv === 'number') u.hostLv = req.body.hostLv;
    if (typeof req.body.wealthLv === 'number') u.wealthLv = req.body.wealthLv;
    if (typeof req.body.totalGifted === 'number') u.totalGifted = req.body.totalGifted;
    if (typeof req.body.totalReceived === 'number') u.totalReceived = req.body.totalReceived;
    if (typeof req.body.name === 'string' && req.body.name.trim()) u.name = req.body.name.trim();
    saveDb();
    return res.json({ ok: true, user: u });
  }
  res.status(404).json({ ok: false });
});

// 5. DAILY & WEEKLY TOP LEADERBOARD (GIFTERS & HOSTS)
app.get('/api/leaderboard', (req, res) => {
  const all = Object.values(db.users).map((u) => ({
    uid: u.uid,
    name: u.name,
    vipLevel: u.vipLevel || 0,
    gifted: u.totalGifted || 0,
    received: u.totalReceived || 0
  }));
  const topGifters = [...all].sort((a, b) => b.gifted - a.gifted).slice(0, 10);
  const topHosts = [...all].sort((a, b) => b.received - a.received).slice(0, 10);
  res.json({ ok: true, topGifters, topHosts });
});

// 6. CLOUD SCREENSHOT & RECHARGE RECEIPT UPLOAD
app.post('/api/recharge/submit', (req, res) => {
  const order = {
    id: 'ORD' + Date.now(),
    uid: req.body.uid || '1000002',
    name: req.body.name || 'User',
    method: req.body.method || 'Telebirr',
    etb: req.body.etb || '180',
    coins: Number(req.body.coins) || 10000,
    screenshotBase64: req.body.screenshotBase64 || '',
    status: 'Pending',
    time: new Date().toISOString()
  };
  db.pendingRecharges.unshift(order);
  saveDb();
  res.json({ ok: true, order });
});

app.get('/api/recharge/pending', (req, res) => {
  res.json({ ok: true, list: db.pendingRecharges.slice(0, 50) });
});

app.post('/api/recharge/approve', (req, res) => {
  const id = req.body.id;
  const item = db.pendingRecharges.find((x) => x.id === id);
  if (item && item.status === 'Pending') {
    item.status = 'Approved';
    const user = Object.values(db.users).find((u) => u.uid === item.uid);
    if (user) user.coins = (user.coins || 0) + item.coins;
    saveDb();
    return res.json({ ok: true, item });
  }
  res.status(404).json({ ok: false });
});

// 7. SUD.TECH TOKEN ENDPOINTS
app.post('/api/sud/get_sstoken', (req, res) => {
  const uid = (req.body.code || '').replace('ethio_', '') || '1000001';
  const ssToken = crypto.createHmac('sha256', SUD_APP_SECRET).update(`${uid}_${Date.now()}`).digest('hex');
  res.json({
    ret_code: 0, ret_msg: 'success',
    data: { ss_token: ssToken, expire_date: Date.now() + 86400000, user_info: { uid, nick_name: `Player_${uid}`, avatar_url: '' } }
  });
});

app.post('/api/sud/update_sstoken', (req, res) => {
  const newToken = crypto.createHmac('sha256', SUD_APP_SECRET).update(`refresh_${Date.now()}`).digest('hex');
  res.json({ ret_code: 0, ret_msg: 'success', data: { ss_token: newToken, expire_date: Date.now() + 86400000 } });
});

// 8. REAL-TIME MIC SEATS & ROOM SOCKET
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const roomSeats = {};

io.on('connection', (socket) => {
  socket.on('join_room', (data) => {
    const roomId = typeof data === 'string' ? data : (data.roomId || 'default');
    socket.join(roomId);
    if (!roomSeats[roomId]) roomSeats[roomId] = {};
    io.to(roomId).emit('seats_update', roomSeats[roomId]);
  });

  socket.on('take_seat', ({ roomId, seatIndex, user }) => {
    if (!roomSeats[roomId]) roomSeats[roomId] = {};
    Object.keys(roomSeats[roomId]).forEach((k) => {
      if (roomSeats[roomId][k] && roomSeats[roomId][k].uid === user.uid) delete roomSeats[roomId][k];
    });
    roomSeats[roomId][seatIndex] = { ...user, socketId: socket.id, muted: false };
    io.to(roomId).emit('seats_update', roomSeats[roomId]);
  });

  socket.on('leave_seat', ({ roomId, uid }) => {
    if (roomSeats[roomId]) {
      Object.keys(roomSeats[roomId]).forEach((k) => {
        if (roomSeats[roomId][k] && roomSeats[roomId][k].uid === uid) delete roomSeats[roomId][k];
      });
      io.to(roomId).emit('seats_update', roomSeats[roomId]);
    }
  });

  socket.on('room_msg', (data) => io.to(data.roomId).emit('room_msg', data));

  socket.on('disconnect', () => {
    Object.keys(roomSeats).forEach((rId) => {
      let changed = false;
      Object.keys(roomSeats[rId]).forEach((k) => {
        if (roomSeats[rId][k] && roomSeats[rId][k].socketId === socket.id) {
          delete roomSeats[rId][k];
          changed = true;
        }
      });
      if (changed) io.to(rId).emit('seats_update', roomSeats[rId]);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ethio-Voice Server running on port ${PORT}`));
