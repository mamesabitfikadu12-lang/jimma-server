const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let users = {
  "269849": { id: "269849", name: "New Member", coins: 500, vip: 0 }
};
let rooms = {};

// 1. Odeeffannoo Fayyadamaafi Coins Argachuu
app.get('/api/user/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// 2. Tapha Oromia Royal Slot
app.post('/api/games/slot', (req, res) => {
  const { userId, betAmount } = req.body;
  const user = users[userId];

  if (!user || user.coins < betAmount) {
    return res.status(400).json({ error: "Coins gahaa hin qabdu!" });
  }

  user.coins -= betAmount;
  const items = ["Jebena", "Palace", "Oromo Horse"];
  const result = [
    items[Math.floor(Math.random() * items.length)],
    items[Math.floor(Math.random() * items.length)],
    items[Math.floor(Math.random() * items.length)]
  ];

  let winAmount = 0;
  if (result[0] === result[1] && result[1] === result[2]) {
    winAmount = betAmount * 5;
    user.coins += winAmount;
  }

  res.json({ result, winAmount, newBalance: user.coins });
});

// 3. Kaffaltii Chapa Jalqabuuf
app.post('/api/payment/buy-coins', async (req, res) => {
  const { userId, amountETB, email, firstName } = req.body;
  const tx_ref = `jimma-${userId}-${Date.now()}`;

  try {
    const response = await fetch("https://chapa.co", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amountETB,
        currency: "ETB",
        email: email,
        first_name: firstName,
        tx_ref: tx_ref,
        callback_url: "https://onrender.com"
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Kaffaltiin hin milkoofne" });
  }
});

// 4. Real-Time Voice Room & Gift System
io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, userId }) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = { seats: Array(8).fill(null) };
    io.to(roomId).emit('room_update', rooms[roomId]);
  });

  socket.on('take_seat', ({ roomId, seatIndex, userId }) => {
    if (rooms[roomId] && rooms[roomId].seats[seatIndex] === null) {
      rooms[roomId].seats[seatIndex] = users[userId];
      io.to(roomId).emit('room_update', rooms[roomId]);
    }
  });

  socket.on('send_gift', ({ roomId, senderId, receiverId, giftCost, giftName }) => {
    const sender = users[senderId];
    const receiver = users[receiverId];
    if (sender && receiver && sender.coins >= giftCost) {
      sender.coins -= giftCost;
      receiver.coins += Math.floor(giftCost * 0.7);
      io.to(roomId).emit('gift_received', {
        from: sender.name,
        to: receiver.name,
        giftName,
        senderBalance: sender.coins
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Jimma Voice Chat Server hojii jalqabeera (Port ${PORT})...`);
});
