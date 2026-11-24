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
  const payload = JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org', path: `/bot${TG_TOKEN}/sendMessage`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  });
  req.on('error', () => {}); req.write(payload); req.end();
}

function sbRequest(method, path, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(SB_URL + path);
      const data = body ? JSON.stringify(body) : null;
      const req = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method,
        headers: {
          'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json', 'Prefer': 'return=representation',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        }
      }, (res) => {
        let raw = ''; res.on('data', (c) => raw += c);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (_) { resolve([]); } });
      });
      req.on('error', () => resolve([])); if (data) req.write(data); req.end();
    } catch (_) { resolve([]); }
  });
}

let db = {
  users: { 'admin@ethiovoice.com': { uid: '100001', name: 'Mohammedsabit (Founder)', contact: 'admin@ethiovoice.com', pass: '142730', coins: 500000, points: 250000, vipLevel: 19, hostLv: 15, wealthLv: 20, totalGifted: 120000, totalReceived: 95000 } },
  otps: {}, pendingRecharges: [], usedHashes: [], lastCashoutId: 0
};
if (fs.existsSync(DB_FILE)) {
  try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
}
const saveDb = () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} };

setInterval(async () => {
  const rows = await sbRequest('GET', '/rest/v1/cashout_requests?select=*&order=id.desc&limit=5');
  if (Array.isArray(rows) && rows.length > 0 && rows.id > db.lastCashoutId) {
    if (db.lastCashoutId > 0) {
      rows.filter((x) => x.id > db.lastCashoutId).reverse().forEach((r) => {
        sendTelegram(`💸 <b>NEW CASHOUT REQUEST!</b>\n👤 ${r.name || 'User'} (UID: <code>${r.uid || ''}</code>)\n💰 <b>${r.etb_amount || 0} ETB</b> (${r.method || 'CBE'})\n💳 Acc: <code>${r.account_number || ''}</code>\n🔗 https://onrender.com`);
      });
    }
    db.lastCashoutId = rows.id; saveDb();
  }
}, 20000);

app.get('/', (req, res) => res.json({ status: 'Ethio-Voice Cloud Server Active', usersCount: Object.keys(db.users).length }));

app.post('/api/auth/signup', (req, res) => {
  const contact = (req.body.contact || '').trim().toLowerCase(), name = (req.body.name || '').trim(), pass = (req.body.pass || '').trim();
  if (!contact || !name || pass.length < 6) return res.status(400).json({ ok: false, msg: 'Invalid input' });
  if (db.users[contact]) return res.status(400).json({ ok: false, msg: 'Account exists' });
  const uid = String(1000000 + Object.keys(db.users).length + 1);
  db.users[contact] = { uid, name, contact, pass, coins: 5000, points: 0, vipLevel: 0, hostLv: 1, wealthLv: 1, totalGifted: 0, totalReceived: 0 };
  saveDb(); res.json({ ok: true, user: db.users[contact] });
});

app.post('/api/auth/login', (req, res) => {
  const u = db.users[(req.body.contact || '').trim().toLowerCase()];
  if (!u || u.pass !== (req.body.pass || '').trim()) return res.status(401).json({ ok: false, msg: 'Wrong credentials' });
  res.json({ ok: true, user: u });
});

app.post('/api/user/sync', (req, res) => {
  const u = db.users[(req.body.contact || '').trim().toLowerCase()];
  if (!u) return res.status(404).json({ ok: false });
  ['coins', 'points', 'vipLevel', 'hostLv', 'wealthLv', 'totalGifted', 'totalReceived'].forEach((k) => { if (typeof req.body[k] === 'number') u[k] = req.body[k]; });
  saveDb(); res.json({ ok: true, user: u });
});

app.get('/api/leaderboard', (req, res) => {
  const all = Object.values(db.users).map((u) => ({ uid: u.uid, name: u.name, vipLevel: u.vipLevel || 0, gifted: u.totalGifted || 0, received: u.totalReceived || 0 }));
  res.json({ ok: true, topGifters: [...all].sort((a, b) => b.gifted - a.gifted).slice(0, 10), topHosts: [...all].sort((a, b) => b.received - a.received).slice(0, 10) });
});

app.post('/api/recharge/submit', (req, res) => {
  const order = { id: 'ORD-' + Date.now(), uid: req.body.uid || '1000002', name: req.body.name || 'User', method: req.body.method || 'CBE', etb: req.body.etb || '180', coins: Number(req.body.coins) || 10000, status: 'Pending', time: new Date().toISOString() };
  db.pendingRecharges.unshift(order); saveDb();
  sendTelegram(`🪙 <b>NEW COIN PURCHASE!</b>\n👤 ${order.name} (UID: <code>${order.uid}</code>)\n💰 ${order.coins} Coins (${order.etb} ETB)`);
  res.json({ ok: true, order });
});

app.post('/api/sud/get_sstoken', (req, res) => {
  const uid = (req.body.code || '').replace('ethio_', '') || '1000001';
  const ssToken = crypto.createHmac('sha256', SUD_APP_SECRET).update(`${uid}_${Date.now()}`).digest('hex');
  res.json({ ret_code: 0, ret_msg: 'success', data: { ss_token: ssToken, expire_date: Date.now() + 86400000, user_info: { uid, nick_name: `Player_${uid}`, avatar: '' } } });
});

app.get('/api/agency/overview', async (req, res) => {
  const [agencies, members, cashouts] = await Promise.all([
    sbRequest('GET', '/rest/v1/agencies?select=*&order=id.desc'),
    sbRequest('GET', '/rest/v1/agency_members?select=*&order=id.desc'),
    sbRequest('GET', '/rest/v1/cashout_requests?select=*&order=id.desc&limit=30')
  ]);
  res.json({ ok: true, agencies, members, cashouts });
});

app.post('/api/agency/create', async (req, res) => {
  const { agency_code, agency_name, owner_uid, owner_name, phone, coin_stock } = req.body;
  await sbRequest('POST', '/rest/v1/agencies', [{ agency_code, agency_name, owner_uid, owner_name, phone, coin_stock: Number(coin_stock) || 0 }]);
  sendTelegram(`🏢 <b>NEW AGENCY:</b> ${agency_name} (${agency_code}) | Stock: ${coin_stock || 0} Coins`);
  res.json({ ok: true });
});

app.post('/api/agency/sell-coins', async (req, res) => {
  const { agency_code, to_uid, coins_amount, price_etb } = req.body;
  const amt = Number(coins_amount) || 0;
  const list = await sbRequest('GET', `/rest/v1/agencies?agency_code=eq.${encodeURIComponent(agency_code)}`);
  if (!Array.isArray(list) || !list.length || Number(list.coin_stock) < amt) return res.status(400).json({ ok: false, msg: 'Invalid agency or low stock' });
  await sbRequest('PATCH', `/rest/v1/agencies?agency_code=eq.${encodeURIComponent(agency_code)}`, { coin_stock: Number(list.coin_stock) - amt });
  await sbRequest('POST', '/rest/v1/coin_transfers', [{ from_uid: list.owner_uid, to_uid, coins_amount: amt, price_etb: Number(price_etb) || 0 }]);
  sendTelegram(`🤝 <b>AGENT SALE:</b> ${list.agency_name} sold ${amt} Coins to UID <code>${to_uid}</code>`);
  res.json({ ok: true });
});

app.post('/api/agency/payroll', async (req, res) => {
  const { agency_code, host_uid, host_name, diamonds_earned } = req.body;
  const gross = (Number(diamonds_earned) || 0) * 0.01;
  await sbRequest('POST', '/rest/v1/agency_members', [{ agency_code, host_uid, host_name, diamonds_earned: Number(diamonds_earned) || 0, host_payout_etb: +(gross * 0.7).toFixed(2), agent_commission_etb: +(gross * 0.15).toFixed(2), founder_profit_etb: +(gross * 0.15).toFixed(2), payroll_status: 'calculated' }]);
  res.json({ ok: true });
});

app.get('/agency', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice Chat ET Agency</title><style>body{font-family:sans-serif;background:#071a15;color:#fff;padding:14px;max-width:720px;margin:auto}h2,h3{color:#fbbf24}.c{background:#0f2e25;padding:12px;border-radius:10px;margin-bottom:12px}input,button{width:100%;padding:9px;margin:5px 0;border-radius:7px;border:none;box-sizing:border-box}input{background:#061410;color:#fff;border:1px solid #2b6654}button{background:#f59e0b;color:#000;font-weight:bold}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #1e4d3f;padding:6px;text-align:left}</style></head><body><h2>👑 Voice Chat ET — Agency & Payroll</h2><div class="c"><h3>1. Hire Agency</h3><input id="ac" placeholder="Agency Code (AG101)"><input id="an" placeholder="Agency Name"><input id="ou" placeholder="Agent UID"><input id="on" placeholder="Agent Name"><input id="ph" placeholder="Phone"><input id="cs" type="number" placeholder="Initial Coin Stock"><button onclick="cAg()">Create Agency</button></div><div class="c"><h3>2. Agent Coin Sale</h3><input id="sac" placeholder="Agency Code"><input id="stu" placeholder="Buyer UID"><input id="samt" type="number" placeholder="Coins"><input id="spr" type="number" placeholder="ETB"><button onclick="sCn()">Record Sale</button></div><div class="c"><h3>3. Payroll (70% Host / 15% Agent / 15% Founder)</h3><input id="pac" placeholder="Agency Code"><input id="phu" placeholder="Host UID"><input id="phn" placeholder="Host Name"><input id="pdi" type="number" placeholder="Diamonds"><button onclick="cPy()">Calculate Payroll</button></div><div class="c"><h3>4. Live Data & Cashouts</h3><div id="out">Loading...</div></div><script>async function ld(){const r=await fetch('/api/agency/overview').then(x=>x.json());out.innerHTML='<h4>Agencies</h4><table><tr><th>Code</th><th>Name</th><th>Owner</th><th>Stock</th></tr>'+(r.agencies||[]).map(a=>'<tr><td>'+a.agency_code+'</td><td>'+a.agency_name+'</td><td>'+a.owner_name+'</td><td>'+a.coin_stock+'</td></tr>').join('')+'</table><h4>Payroll</h4><table><tr><th>Agency</th><th>Host</th><th>Host ETB</th><th>Agent ETB</th><th>Founder ETB</th></tr>'+(r.members||[]).map(m=>'<tr><td>'+m.agency_code+'</td><td>'+m.host_name+'</td><td>'+m.host_payout_etb+'</td><td>'+m.agent_commission_etb+'</td><td>'+m.founder_profit_etb+'</td></tr>').join('')+'</table><h4>Cashouts</h4><table><tr><th>Name</th><th>UID</th><th>ETB</th><th>Account</th></tr>'+(r.cashouts||[]).map(c=>'<tr><td>'+(c.name||'')+'</td><td>'+(c.uid||'')+'</td><td>'+(c.etb_amount||'')+'</td><td>'+(c.account_number||'')+'</td></tr>').join('')+'</table>';}async function cAg(){await fetch('/api/agency/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agency_code:ac.value,agency_name:an.value,owner_uid:ou.value,owner_name:on.value,phone:ph.value,coin_stock:cs.value})});alert('Created!');ld();}async function sCn(){const r=await fetch('/api/agency/sell-coins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agency_code:sac.value,to_uid:stu.value,coins_amount:samt.value,price_etb:spr.value})}).then(x=>x.json());alert(r.ok?'Sold!':r.msg);ld();}async function cPy(){await fetch('/api/agency/payroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agency_code:pac.value,host_uid:phu.value,host_name:phn.value,diamonds_earned:pdi.value})});alert('Saved!');ld();}ld();</script></body></html>`);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const roomSeats = {};
io.on('connection', (socket) => {
  socket.on('join_room', (d) => { const r = typeof d === 'string' ? d : (d.roomId || 'default'); socket.join(r); if (!roomSeats[r]) roomSeats[r] = {}; io.to(r).emit('seats_update', roomSeats[r]); });
  socket.on('take_seat', ({ roomId, seatIndex, user }) => { if (!roomSeats[roomId]) roomSeats[roomId] = {}; Object.keys(roomSeats[roomId]).forEach((k) => { if (roomSeats[roomId][k]?.uid === user.uid) delete roomSeats[roomId][k]; }); roomSeats[roomId][seatIndex] = { ...user, socketId: socket.id, muted: false }; io.to(roomId).emit('seats_update', roomSeats[roomId]); });
  socket.on('leave_seat', ({ roomId, uid }) => { if (roomSeats[roomId]) { Object.keys(roomSeats[roomId]).forEach((k) => { if (roomSeats[roomId][k]?.uid === uid) delete roomSeats[roomId][k]; }); io.to(roomId).emit('seats_update', roomSeats[roomId]); } });
  socket.on('room_msg', (d) => io.to(d.roomId).emit('room_msg', d));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ethio-Voice Server running on port ${PORT}`));
