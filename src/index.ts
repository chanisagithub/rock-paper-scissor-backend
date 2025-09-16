import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DRPSRoom } from './rooms/DRPSRoom';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 2567;

app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/drps')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Colyseus Server Setup
const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define('drps_room', DRPSRoom);

// Express API Endpoints
app.post('/api/create-room', (req, res) => {
  // This endpoint would typically interact with the Gameon platform API
  // to create a room and get a JWT token. For this minimalist implementation,
  // we'll simulate it.
  const { playerUuid, playerName, nftContractAddress, nftTokenId, nftImageUrl } = req.body;

  if (!playerUuid || !playerName) {
    return res.status(400).json({ message: 'playerUuid and playerName are required' });
  }

  // Simulate JWT generation
  const token = jwt.sign(
    { playerUuid, playerName, nftContractAddress, nftTokenId, nftImageUrl, sessionUuid: 'dummy_session_id' },
    process.env.JWT_SECRET || 'your_jwt_secret',
    { expiresIn: '2h' }
  );

  // In a real scenario, you'd create a session in your DB and return its ID
  // For now, we return a dummy session ID and the token.
  res.json({
    sessionUuid: 'dummy_session_id',
    token,
    message: 'Room created and token generated. Use this token to join the Colyseus room.'
  });
});

app.post('/api/game-result', (req, res) => {
  // This endpoint would receive game results from Colyseus room
  // and submit them to the Gameon platform API.
  const { sessionUuid, winnerUuid, loserUuid, finalScore } = req.body;
  console.log('Game Result Received:', { sessionUuid, winnerUuid, loserUuid, finalScore });
  // Here, you would typically save to DB and/or call Gameon platform API
  res.status(200).json({ message: 'Game result processed' });
});

// Start Server
gameServer.listen(port, '0.0.0.0');
console.log(`Colyseus WebSocket server listening on ws://0.0.0.0:${port} (LAN accessible)`);

app.listen(port + 1, '0.0.0.0', () => {
  console.log(`Express API listening on http://0.0.0.0:${port + 1} (LAN accessible)`);
});

