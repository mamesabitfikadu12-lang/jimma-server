const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let dbConnected = false;
const mongoUri = process.env.MONGODB_URI || '';
if (mongoUri) {
  mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 4000 })
    .then(() => { dbConnected = true; console.log('MongoDB Atlas Connected!'); })
    .catch((err) => { dbConnected = false; console.error('MongoDB Fallback Active:', err.message); });
}

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  coins: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  vipLevel: { type: Number, default: 0 },
  usedRefs: { type: [String], default: [] }
});
const User = mongoose.model('User', userSchema);

// Kuusaa Yeroo (Yoo MongoDB hin jirre ofumaan kan tajaajilu)
const memUsers = new Map();
const memUsedRefs = new Set();

async function getOrCreateUser(userId) {
  if (dbConnected && mongoose.connection.readyState === 1) {
    let user = await User.findOne({ userId });
    if (!user) user = await User.create({ userId, coins: 0, points: 0, vipLevel: 0, usedRefs: [] });
    return user;
  }
  if (!memUsers.has(userId)) {
    memUsers.set(userId, { userId, coins: 0, points: 0, vipLevel: 0, usedRefs: [] });
  }
  return memUsers.get(userId);
}

app.get('/', (req, res) => res.send('✅ Ethio-Voice Server + MongoDB Live!'));

app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await getOrCreateUser(req.params.userId);
    res.json({ success: true, coins: user.coins, points: user.points, vipLevel: user.vipLevel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payment/verify-shegerpay', async (req, res) => {
  try {
    const { userId, referenceId, provider, coinsToAdd } = req.body || {};
    const ref = (referenceId || '').trim().toUpperCase();
    const uid = (userId || '').trim();
    const add = parseInt(coinsToAdd, 10) || 10000;

    if (!uid || ref.length < 5) {
      return res.status(400).json({ error: 'Transaction ID sirrii galchi!' });
    }

    if (dbConnected && mongoose.connection.readyState === 1) {
      const used = await User.findOne({ usedRefs: ref });
      if (used) return res.status(400).json({ error: 'Nagaheen kun duraan itti fayyadamameera!' });
      const user = await getOrCreateUser(uid);
      user.coins += add;
      user.usedRefs.push(ref);
      await user.save();
      return res.json({ success: true, provider, newBalance: user.coins });
    }

    if (memUsedRefs.has(ref)) {
      return res.status(400).json({ error: 'Nagaheen kun duraan itti fayyadamameera!' });
    }
    memUsedRefs.add(ref);
    const user = await getOrCreateUser(uid);
    user.coins += add;
    return res.json({ success: true, provider, newBalance: user.coins });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId }) => socket.join(roomId));
  socket.on('send_gift', async ({ roomId, senderId, receiverId, giftCost, giftName }) => {
    try {
      const sender = await getOrCreateUser(senderId);
      if (sender.coins >= giftCost) {
        sender.coins -= giftCost;
        if (sender.save) await sender.save();
        io.to(roomId).emit('gift_received', { from: senderId, to: receiverId, giftName, coinsLeft: sender.coins });
      }
    } catch (_) {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
