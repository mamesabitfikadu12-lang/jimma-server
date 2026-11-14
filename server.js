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

const mongoUri = process.env.MONGO_URI || '';
if (mongoUri) {
  mongoose.connect(mongoUri)
    .then(() => console.log('MongoDB Atlas Connected!'))
    .catch(err => console.error('MongoDB Error:', err));
}

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  coins: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  vipLevel: { type: Number, default: 0 },
  usedRefs: { type: [String], default: [] }
});
const User = mongoose.model('User', userSchema);

async function getOrCreateUser(userId) {
  let user = await User.findOne({ userId });
  if (!user) user = await User.create({ userId, coins: 0, points: 0, vipLevel: 0, usedRefs: [] });
  return user;
}

app.get('/', (req, res) => res.send('Ethio-Voice Server + MongoDB Live!'));

app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await getOrCreateUser(req.params.userId);
    res.json({ success: true, coins: user.coins, points: user.points, vipLevel: user.vipLevel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/games/slot', async (req, res) => {
  try {
    const { userId, betAmount } = req.body;
    const user = await getOrCreateUser(userId);
    if (user.coins < betAmount) return res.status(400).json({ error: 'Coins gahaa hin qabdu!' });

    user.coins -= betAmount;
    const symbols = ['☕ Jebena', '🏰 Palace', '🐎 Oromo Horse', '🪑 Royal Stool', '🦁 Lion'];
    const isWin = Math.random() < 0.35; // 65% Galii Appichaa
    let winAmount = 0;
    let result = [symbols[0], symbols[1], symbols[2]];

    if (isWin) {
      const pick = symbols[Math.floor(Math.random() * symbols.length)];
      result = [pick, pick, pick];
      winAmount = betAmount * 2;
      user.coins += winAmount;
    }
    await user.save();
    res.json({ success: true, result, winAmount, newBalance: user.coins });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payment/verify-shegerpay', async (req, res) => {
  try {
    const { userId, referenceId, provider, coinsToAdd } = req.body;
    if (!referenceId || referenceId.length < 5) return res.status(400).json({ error: 'Transaction ID sirrii galchi!' });
    const used = await User.findOne({ usedRefs: referenceId });
    if (used) return res.status(400).json({ error: 'Nagaheen kun duraan itti fayyadamameera!' });

    const user = await getOrCreateUser(userId);
    user.coins += Number(coinsToAdd || 10000);
    user.usedRefs.push(referenceId);
    await user.save();
    res.json({ success: true, provider, newBalance: user.coins });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId }) => socket.join(roomId));
  socket.on('send_gift', async ({ roomId, senderId, receiverId, giftCost, giftName }) => {
    try {
      const sender = await getOrCreateUser(senderId);
      if (sender.coins >= giftCost) {
        sender.coins -= giftCost;
        await sender.save();
        io.to(roomId).emit('gift_received', { from: senderId, to: receiverId, giftName, coinsLeft: sender.coins });
      }
    } catch (_) {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
