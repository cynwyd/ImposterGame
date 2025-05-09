import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { customAlphabet } from 'nanoid';
import fs from 'fs';

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
const answers = {}; // { roomCode: { socketId: { name: userName, answer: userAnswer } } }
const currentQuestions = {}; // { roomCode: { firstQuestion: string, secondQuestion: string } }
const roomAdmins = {}; // { roomCode: socketId }
const latestCustomQuestions = {}; // { roomCode: { question: string, impostorQuestion: string } }

// Load questions from questions.json
const questions = JSON.parse(fs.readFileSync(join(__dirname, '../frontend/data/questions.json'), 'utf-8')).question_sets;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('set-name', (name) => {
    userNames[socket.id] = name;
    console.log(`User ${socket.id} set their name to ${name}`);
  });

  socket.on('create-room', () => {
    const roomCode = nanoid();
    rooms[roomCode] = [{ id: socket.id, name: userNames[socket.id] }];
    roomAdmins[roomCode] = socket.id; // Set the creator as the admin
    socket.join(roomCode);
    console.log('Room created:', roomCode);
    socket.emit('room-created', { roomCode, isAdmin: true }); // Notify the creator they are the admin
  });

  socket.on('join-room', ({ roomCode, userName }) => {
    console.log("Joining room:", roomCode, "with name:", userName, "with Socket ID:", socket.id);
    if (rooms[roomCode]) {
      console.log("Room found:", roomCode);
      userNames[socket.id] = userName; // Update name if not already set
      rooms[roomCode].push({ id: socket.id, name: userName });
      socket.join(roomCode);
      const isAdmin = roomAdmins[roomCode] === socket.id; // Check if the user is the admin
      socket.emit('room-joined', { roomCode, isAdmin });
      io.to(roomCode).emit('user-joined', userName);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('submit-custom-question', ({ roomCode, question, impostorQuestion, userName }) => {
    if (rooms[roomCode]) {
      // Store the latest custom question for the room
      latestCustomQuestions[roomCode] = { question, impostorQuestion };
      console.log(`Custom question submitted by ${userName} for room ${roomCode}:`, { question, impostorQuestion });

      // Broadcast the custom question and username to the room
      io.to(roomCode).emit('custom-question-submitted', { userName, question, impostorQuestion });
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('start-game', ({ roomCode }) => {
    if (rooms[roomCode]) {
      let questionSet;

      if (latestCustomQuestions[roomCode]) {
        // Use the most recent custom question if available
        questionSet = {
          questions: [
            latestCustomQuestions[roomCode].question,
            latestCustomQuestions[roomCode].impostorQuestion,
          ],
        };

        // Clear the latest custom question for the room
        delete latestCustomQuestions[roomCode];
      } else {
        // Otherwise, select a random question set
        questionSet = questions[Math.floor(Math.random() * questions.length)];
      }

      const users = rooms[roomCode];
      const firstQuestion = questionSet.questions[0];
      const secondQuestion = questionSet.questions[1];

      // Store the selected question set for the room
      currentQuestions[roomCode] = { firstQuestion, secondQuestion };

      // Notify clients that a new round has started
      io.to(roomCode).emit('round-started');

      // Randomly select one user to receive the second question
      const randomIndex = Math.floor(Math.random() * users.length);
      const randomUser = users[randomIndex];

      // Assign questions to users
      users.forEach((user) => {
        const question = user.id === randomUser.id ? secondQuestion : firstQuestion;
        io.to(user.id).emit('receive-question', question);
      });

      console.log(`Game started in room ${roomCode}. Random user ${randomUser.name} received the second question.`);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('submit-answer', ({ roomCode, answer }) => {
    if (!answers[roomCode]) {
      answers[roomCode] = {};
    }

    answers[roomCode][socket.id] = {
      name: userNames[socket.id],
      answer,
    };
    
    const usersInRoom = rooms[roomCode];
    const totalUsers = usersInRoom.length;
    const submittedAnswers = Object.keys(answers[roomCode]).length;

    if (submittedAnswers === totalUsers) {
      console.log(`All users have submitted their answers in room ${roomCode}.`);

      // Retrieve the original question for the room
      const originalQuestion = currentQuestions[roomCode]?.firstQuestion || 'No question available';
      const allAnswers = Object.values(answers[roomCode]);

      io.to(roomCode).emit('all-answers-submitted', { originalQuestion, allAnswers });

      // Clear answers and current questions for the next round
      delete answers[roomCode];
      delete currentQuestions[roomCode];
    }
  });

  socket.on('rejoin-room', ({ roomCode, userName }) => {
    if (rooms[roomCode]) {
      const userExists = rooms[roomCode].some((user) => user.id === socket.id);

      if (!userExists) {
        // Add the user back to the room
        rooms[roomCode].push({ id: socket.id, name: userName });
        userNames[socket.id] = userName;
        socket.join(roomCode);
        io.to(roomCode).emit('user-joined', userName);
        console.log(`${userName} rejoined room ${roomCode}`);
      }

      socket.emit('rejoin-success');
    } else {
      socket.emit('rejoin-failed', 'Room not found.');
    }
  });

  socket.on('kick-user', ({ roomCode, userId }) => {
    if (roomAdmins[roomCode] === socket.id) {
      // Check if the user to be kicked exists in the room
      const userIndex = rooms[roomCode].findIndex((user) => user.id === userId);
      if (userIndex !== -1) {
        const kickedUser = rooms[roomCode][userIndex];
        rooms[roomCode].splice(userIndex, 1); // Remove the user from the room
        io.to(userId).emit('kicked'); // Notify the kicked user
        io.to(roomCode).emit('user-kicked', { userName: kickedUser.name, userId }); // Notify the room
        console.log(`User ${kickedUser.name} was kicked from room ${roomCode}`);
      } else {
        socket.emit('error', 'User not found in the room.');
      }
    } else {
      socket.emit('error', 'Only the admin can kick users.');
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
