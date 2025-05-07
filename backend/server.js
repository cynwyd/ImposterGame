import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { customAlphabet } from 'nanoid';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server); // use `new Server()` with ESM

// Serve static files for frontend
app.use(express.static(join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../frontend/index.html'));
});

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nanoid = customAlphabet(alphabet, 4); // 4-character uppercase ID

const rooms = {}; // { roomCode: [{ id: socketId, name: userName }, ...] }
const userNames = {}; // { socketId: userName }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('set-name', (name) => {
    userNames[socket.id] = name;
    console.log(`User ${socket.id} set their name to ${name}`);
  });

  socket.on('create-room', () => {
    const roomCode = nanoid();
    rooms[roomCode] = [{ id: socket.id, name: userNames[socket.id] }];
    socket.join(roomCode);
    console.log('Room created:', roomCode);
    socket.emit('room-created', roomCode);
  });

  socket.on('join-room', ({ roomCode, userName }) => {
    if (rooms[roomCode]) {
      userNames[socket.id] = userName; // Update name if not already set
      rooms[roomCode].push({ id: socket.id, name: userName });
      socket.join(roomCode);
      io.to(roomCode).emit('user-joined', userName);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('disconnect', () => {
    for (const room in rooms) {
      rooms[room] = rooms[room].filter(user => user.id !== socket.id);
      if (rooms[room].length === 0) delete rooms[room];
    }
    delete userNames[socket.id];
  });
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});
