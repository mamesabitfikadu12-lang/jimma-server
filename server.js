const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const DB_FILE = './ethio_voice_db.json';
const SUD_APP_ID = '2122085803670614016';
const SUD_APP_SECRET = 'th2xmnklxv9vz482n4ayptvhau6yah27';

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9163789861:AAG_a0CFrOqF-G1cCxgqEtRDjJXGwFnuZ4w';
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '1981380589';
const SB_URL = (process.env.SUPABASE_URL || 'https://supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaXBvdGhjZGhmamVkd21tZWR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNTMxODAsImV4cCI6MjExMDkyOTE4MH0.CpwRF9lbOrUH2_R7ZbxuNMlqg5gr1aulGmvCm260ADg';

function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  const payload = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TG_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  });
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

function sbRequest(method, path, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(SB_URL + path);
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }
      }, (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch (_) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      if (data) req.write(data);
      req.end();
    } catch (_) { resolve([]); }
  });
}

let db = {
  users: {
    'admin@ethiovoice.com': {
      uid: '100001',
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
  usedHashes: [],
  lastCashoutId: 0
};

if (fs.existsSync(DB_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.users = Object.assign(db.users, loaded.users || {});
    db.pendingRecharges = loaded.pendingRecharges || [];
    db.usedHashes = loaded.usedHashes || [];
    db.lastCashoutId = loaded.lastCashoutId || 0;
  } catch (e) {}
}

function saveDb() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

// Auto-poll Supabase cashout_requests every 20s and alert Telegram immediately
setInterval(async () => {
  const rows = await sbRequest('GET', '/rest/v1/cashout_requests?select=*&order=id.desc&limit=5');
  if (!Array.isArray(rows) || rows.length === 0) return;
  const newest = rows[0];
  if (newest && newest.id && newest.id > db.lastCashoutId) {
    if (db.lastCashoutId > 0) {
      for (const r of rows.filter((x) => x.id > db.lastCashoutId).reverse()) {
        sendTelegram(
          `💸 <b>NEW CASHOUT REQUEST!</b>\n` +
          `👤 Name: <b>${r.name || 'User'}</b> (UID: <code>${r.uid || ''}</code>)\n` +
          `💰 Amount: <b>${r.etb_amount || r.points || 0} ETB</b>\n` +
          `🏦 Method: <b>${r.method || 'CBE'}</b>\n` +
          `💳 Account: <code>${r.account_number || ''}</code>\n` +
          `🔗 Open Agency/Admin Portal: https://onrender.com`
        );
      }
    }
    db.lastCashoutId = newest.id;
    saveDb();
  }
}, 20000);

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
    return res.status(400).json({ ok: false, msg: 'Account already exists! Please Login.' });
  }
  const uid = String(1000000 + Object.keys(db.users).length + 1);
  const startCoins = ref.length >= 5 ? 5500 : 5000;
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

// 5. DAILY & WEEKLY TOP LEADERBOARD
app.get('/api/leaderboard', (req, res) => {
  const all = Object.values(db.users).map((u) => ({
    uid: u.uid, name: u.name, vipLevel: u.vipLevel || 0,
    gifted: u.totalGifted || 0, received: u.totalReceived || 0
  }));
  const topGifters = [...all].sort((a, b) => b.gifted - a.gifted).slice(0, 10);
  const topHosts = [...all].sort((a, b) => b.received - a.received).slice(0, 10);
  res.json({ ok: true, topGifters, topHosts });
});

// 6. RECHARGE RECEIPT UPLOAD + TELEGRAM ALERT
app.post('/api/recharge/submit', (req, res) => {
  const order = {
    id: 'ORD-' + Date.now(),
    uid: req.body.uid || '1000002',
    name: req.body.name || 'User',
    method: req.body.method || 'CBE',
    etb: req.body.etb || '180',
    coins: Number(req.body.coins) || 10000,
    screenshotBase64: req.body.screenshotBase64 || '',
    status: 'Pending',
    time: new Date().toISOString()
  };
  db.pendingRecharges.unshift(order);
  saveDb();
  sendTelegram(`🪙 <b>NEW COIN PURCHASE!</b>\n👤 ${order.name} (UID: <code>${order.uid}</code>)\n💰 ${order.coins} Coins (${order.etb} ETB via ${order.method})`);
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
    data: { ss_token: ssToken, expire_date: Date.now() + 86400000, user_info: { uid, nick_name: `Player_${uid}`, avatar: '' } }
  });
});

app.post('/api/sud/update_sstoken', (req, res) => {
  const newToken = crypto.createHmac('sha256', SUD_APP_SECRET).update(`refresh_${Date.now()}`).digest('hex');
