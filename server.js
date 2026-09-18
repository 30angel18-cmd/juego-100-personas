const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1234';

// URL pública: variable de entorno > Render > IP de la red local > localhost
function lanUrl() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it.family === 'IPv4' && !it.internal) {
        return `http://${it.address}:${PORT}`;
      }
    }
  }
  return `http://localhost:${PORT}`;
}

const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  lanUrl()
).replace(/\/+$/, '');

const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8')
);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.redirect('/screen'));
app.get('/screen', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'screen.html'))
);
app.get('/remote', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'remote.html'))
);

// ---------- Estado del juego (una sola partida a la vez) ----------

const game = {
  phase: 'lobby', // lobby | round | roundEnd | final
  questionIndex: -1,
  revealed: [],
  pot: 0,
  strikes: 0,
  lastAward: null, // { team: 'A'|'B', points: n }
  teams: { A: 0, B: 0 },
};

const authedRemotes = new Set();
let remoteQrDataUrl = null;

function currentQuestion() {
  return game.questionIndex >= 0 ? questions[game.questionIndex] : null;
}

// Lo que ve la pantalla del proyector: NO incluye respuestas ocultas
function publicState() {
  const q = currentQuestion();
  return {
    phase: game.phase,
    questionText: q ? q.text : null,
    answers: q
      ? q.answers.map((a, i) => ({
          revealed: game.revealed[i],
          text: game.revealed[i] ? a.text : null,
          points: game.revealed[i] ? a.points : null,
          info: game.revealed[i] ? a.info || null : null,
        }))
      : null,
    pot: game.pot,
    strikes: game.strikes,
    teams: game.teams,
    lastAward: game.lastAward,
    remoteUrl: `${PUBLIC_URL}/remote`,
    qr: remoteQrDataUrl,
  };
}

// Lo que ve el host en su celular: incluye TODAS las respuestas
function hostState() {
  const q = currentQuestion();
  return {
    ...publicState(),
    questionIndex: game.questionIndex,
    answersFull: q
      ? q.answers.map((a, i) => ({
          text: a.text,
          points: a.points,
          revealed: game.revealed[i],
        }))
      : null,
    questions: questions.map((qq, i) => ({ index: i, text: qq.text })),
  };
}

function broadcast() {
  io.emit('state', publicState());
  for (const id of authedRemotes) {
    io.to(id).emit('hostState', hostState());
  }
}

function startRound(index) {
  game.questionIndex = index;
  game.revealed = questions[index].answers.map(() => false);
  game.pot = 0;
  game.strikes = 0;
  game.lastAward = null;
  game.phase = 'round';
}

// ---------- Sockets ----------

io.on('connection', (socket) => {
  socket.emit('state', publicState());

  socket.on('remote:auth', (pin) => {
    if (String(pin) === HOST_PIN) {
      authedRemotes.add(socket.id);
      socket.emit('remote:authOk');
      socket.emit('hostState', hostState());
    } else {
      socket.emit('remote:authFail');
    }
  });

  const isHost = () => authedRemotes.has(socket.id);

  socket.on('question:select', (index) => {
    if (!isHost()) return;
    if (!Number.isInteger(index) || index < 0 || index >= questions.length) return;
    startRound(index);
    broadcast();
  });

  socket.on('answer:reveal', (index) => {
    if (!isHost() || (game.phase !== 'round' && game.phase !== 'roundEnd')) return;
    const q = currentQuestion();
    if (!q || index < 0 || index >= q.answers.length || game.revealed[index]) return;
    game.revealed[index] = true;
    if (game.phase === 'round') {
      game.pot += q.answers[index].points;
      if (game.revealed.every(Boolean)) game.phase = 'roundEnd';
    }
    broadcast();
  });

  socket.on('strike:add', () => {
    if (!isHost() || game.phase !== 'round') return;
    if (game.strikes < 3) game.strikes += 1;
    if (game.strikes === 3) game.phase = 'roundEnd'; // 3 errores: termina la ronda
    broadcast();
  });

  socket.on('round:award', (team) => {
    if (!isHost()) return;
    if (game.phase !== 'round' && game.phase !== 'roundEnd') return;
    if (team !== 'A' && team !== 'B') return;
    game.teams[team] += game.pot;
    game.lastAward = { team, points: game.pot };
    game.pot = 0;
    game.phase = 'roundEnd';
    broadcast();
  });

  socket.on('question:next', () => {
    if (!isHost()) return;
    if (game.questionIndex + 1 < questions.length) {
      startRound(game.questionIndex + 1);
    } else {
      game.phase = 'final';
      game.lastAward = null;
    }
    broadcast();
  });

  socket.on('game:reset', () => {
    if (!isHost()) return;
    game.phase = 'lobby';
    game.questionIndex = -1;
    game.revealed = [];
    game.pot = 0;
    game.strikes = 0;
    game.lastAward = null;
    game.teams = { A: 0, B: 0 };
    broadcast();
  });

  socket.on('disconnect', () => authedRemotes.delete(socket.id));
});

// ---------- Arranque ----------

QRCode.toDataURL(`${PUBLIC_URL}/remote`, { width: 320, margin: 1 })
  .then((url) => {
    remoteQrDataUrl = url;
    broadcast(); // por si algún cliente conectó antes de generarse el QR
  })
  .catch((err) => console.error('No se pudo generar el QR:', err.message));

server.listen(PORT, () => {
  console.log(`Juego listo:`);
  console.log(`  Pantalla (proyector): ${PUBLIC_URL}/screen`);
  console.log(`  Control (celular):    ${PUBLIC_URL}/remote  · PIN: ${HOST_PIN}`);
});
