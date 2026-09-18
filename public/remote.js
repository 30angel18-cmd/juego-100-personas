const socket = io();

const el = {
  auth: document.getElementById('auth'),
  panel: document.getElementById('panel'),
  pin: document.getElementById('pin'),
  authBtn: document.getElementById('authBtn'),
  authError: document.getElementById('authError'),
  hudPhase: document.getElementById('hudPhase'),
  hudPot: document.getElementById('hudPot'),
  hudStrikes: document.getElementById('hudStrikes'),
  scoreA: document.getElementById('scoreA'),
  scoreB: document.getElementById('scoreB'),
  questionSelect: document.getElementById('questionSelect'),
  startBtn: document.getElementById('startBtn'),
  currentQuestion: document.getElementById('currentQuestion'),
  answersCard: document.getElementById('answersCard'),
  answers: document.getElementById('answers'),
  strikeBtn: document.getElementById('strikeBtn'),
  awardA: document.getElementById('awardA'),
  awardB: document.getElementById('awardB'),
  nextBtn: document.getElementById('nextBtn'),
  resetBtn: document.getElementById('resetBtn'),
};

const PHASES = {
  lobby: 'Lobby',
  round: 'Ronda en juego',
  roundEnd: 'Fin de ronda',
  final: 'Fin del juego',
};

// ---------- Autenticación ----------
function submitPin() {
  socket.emit('remote:auth', el.pin.value.trim());
}
el.authBtn.addEventListener('click', submitPin);
el.pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });

socket.on('remote:authOk', () => {
  el.auth.classList.add('hidden');
  el.panel.classList.remove('hidden');
});
socket.on('remote:authFail', () => {
  el.authError.classList.remove('hidden');
  el.pin.select();
});

// ---------- Acciones del host ----------
el.startBtn.addEventListener('click', () => {
  socket.emit('question:select', Number(el.questionSelect.value));
});
el.strikeBtn.addEventListener('click', () => socket.emit('strike:add'));
el.awardA.addEventListener('click', () => socket.emit('round:award', 'A'));
el.awardB.addEventListener('click', () => socket.emit('round:award', 'B'));
el.nextBtn.addEventListener('click', () => socket.emit('question:next'));
el.resetBtn.addEventListener('click', () => {
  if (confirm('¿Reiniciar el juego? Se borran los puntos.')) {
    socket.emit('game:reset');
  }
});

// ---------- Render del estado del host ----------
let lastQuestionIndex = null;

socket.on('hostState', (s) => {
  el.hudPhase.textContent = PHASES[s.phase] || s.phase;
  el.hudPot.textContent = s.pot;
  el.hudStrikes.textContent = '✕'.repeat(s.strikes) || '0';
  el.scoreA.textContent = s.teams.A;
  el.scoreB.textContent = s.teams.B;

  // Selector de preguntas (se llena una sola vez)
  if (el.questionSelect.options.length === 0) {
    s.questions.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = q.index;
      opt.textContent = `${q.index + 1}. ${q.text}`;
      el.questionSelect.appendChild(opt);
    });
  }

  // Pregunta actual + lista de respuestas
  if (s.answersFull) {
    el.answersCard.classList.remove('hidden');
    el.currentQuestion.textContent = s.questionText;
    el.questionSelect.value = s.questionIndex;

    if (s.questionIndex !== lastQuestionIndex) {
      lastQuestionIndex = s.questionIndex;
      el.answers.innerHTML = '';
      s.answersFull.forEach((a, i) => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.innerHTML = `<span>${i + 1}. ${a.text}</span><span class="pts">${a.points}</span>`;
        btn.addEventListener('click', () => socket.emit('answer:reveal', i));
        el.answers.appendChild(btn);
      });
    }

    s.answersFull.forEach((a, i) => {
      const btn = el.answers.children[i];
      if (btn) {
        btn.classList.toggle('revealed', a.revealed);
        btn.disabled = a.revealed || s.phase !== 'round';
      }
    });
  } else {
    el.answersCard.classList.add('hidden');
    el.currentQuestion.textContent = '';
    lastQuestionIndex = null;
  }

  // Botón siguiente → "Terminar" en la última pregunta
  const isLast = s.questionIndex === s.questions.length - 1;
  el.nextBtn.textContent = isLast ? 'Terminar juego ➜' : 'Siguiente ➜';

  // Deshabilitar acciones según la fase
  const inRound = s.phase === 'round';
  el.strikeBtn.disabled = !inRound;
  el.awardA.disabled = el.awardB.disabled = !inRound && s.phase !== 'roundEnd';
  el.nextBtn.disabled = s.phase === 'lobby' || s.phase === 'final';
});
