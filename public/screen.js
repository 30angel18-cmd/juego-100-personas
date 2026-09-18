const socket = io();

const el = {
  lobby: document.getElementById('lobby'),
  game: document.getElementById('game'),
  final: document.getElementById('final'),
  scorebar: document.getElementById('scorebar'),
  qr: document.getElementById('qr'),
  remoteUrl: document.getElementById('remoteUrl'),
  questionText: document.getElementById('questionText'),
  board: document.getElementById('board'),
  answerInfo: document.getElementById('answerInfo'),
  strikes: document.getElementById('strikes'),
  awardOverlay: document.getElementById('awardOverlay'),
  awardText: document.getElementById('awardText'),
  winnerText: document.getElementById('winnerText'),
  scoreA: document.getElementById('scoreA'),
  scoreB: document.getElementById('scoreB'),
  pot: document.getElementById('pot'),
};

let currentQuestion = null;
let prevFlags = [];
const prev = { revealed: 0, strikes: 0, phase: 'lobby' };

// ---------- Sonidos (WebAudio, sin archivos) ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('pointerdown', ensureAudio);
document.addEventListener('keydown', ensureAudio);

function tone(freq, dur, type = 'sine', delay = 0, vol = 0.25) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const ding = () => { tone(987, 0.3); tone(1318, 0.45, 'sine', 0.08); };
const buzz = () => { tone(140, 0.6, 'sawtooth', 0, 0.3); tone(110, 0.6, 'sawtooth', 0.02, 0.2); };
const fanfare = () => { tone(523, 0.2); tone(659, 0.2, 'sine', 0.15); tone(784, 0.2, 'sine', 0.3); tone(1046, 0.5, 'sine', 0.45); };

// ---------- Render ----------
function buildBoard(answers) {
  el.board.innerHTML = '';
  answers.forEach((_, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = `
      <div class="slot-inner">
        <div class="face front"><span class="num">${i + 1}</span></div>
        <div class="face back">
          <span class="answer-text"></span>
          <span class="answer-points"></span>
        </div>
      </div>`;
    el.board.appendChild(slot);
  });
}

function render(s) {
  // Sonidos según cambios de estado
  if (s.answers) {
    const nowRevealed = s.answers.filter(a => a.revealed).length;
    if (nowRevealed > prev.revealed && s.phase === 'round') ding();
    prev.revealed = nowRevealed;
  } else {
    prev.revealed = 0;
  }
  const justStruckOut = s.strikes === 3 && s.strikes > prev.strikes;
  if (s.strikes > prev.strikes) buzz();
  prev.strikes = s.strikes;
  if (s.phase === 'roundEnd' && prev.phase === 'round' && s.lastAward) fanfare();
  prev.phase = s.phase;

  // Fases visibles
  el.lobby.classList.toggle('hidden', s.phase !== 'lobby');
  el.game.classList.toggle('hidden', s.phase !== 'round' && s.phase !== 'roundEnd');
  el.final.classList.toggle('hidden', s.phase !== 'final');
  el.scorebar.classList.toggle('hidden', s.phase === 'lobby');
  el.awardOverlay.classList.toggle('hidden', s.phase !== 'roundEnd' || !s.lastAward);

  // Lobby
  if (s.phase === 'lobby') {
    if (s.qr) { el.qr.src = s.qr; el.qr.classList.remove('hidden'); }
    el.remoteUrl.textContent = s.remoteUrl || '';
  }

  // Tablero
  if (s.answers) {
    if (s.questionText !== currentQuestion) {
      currentQuestion = s.questionText;
      el.questionText.textContent = s.questionText;
      buildBoard(s.answers);
      prevFlags = s.answers.map(() => false);
      el.answerInfo.classList.add('hidden');
    }
    let newlyRevealed = -1;
    s.answers.forEach((a, i) => {
      const slot = el.board.children[i];
      if (!slot) return;
      if (a.revealed && !prevFlags[i]) newlyRevealed = i;
      slot.classList.toggle('revealed', a.revealed);
      if (a.revealed) {
        slot.querySelector('.answer-text').textContent = a.text;
        slot.querySelector('.answer-points').textContent = a.points;
      }
    });
    prevFlags = s.answers.map(a => a.revealed);
    // Información de la respuesta recién revelada
    if (newlyRevealed >= 0) {
      const info = s.answers[newlyRevealed].info;
      if (info) {
        el.answerInfo.textContent = info;
        el.answerInfo.classList.remove('hidden');
      } else {
        el.answerInfo.classList.add('hidden');
      }
    }
  } else {
    prevFlags = [];
    el.answerInfo.classList.add('hidden');
  }

  // Strikes
  el.strikes.innerHTML = '✕'.repeat(s.strikes)
    .split('')
    .map(x => `<span class="strike">${x}</span>`)
    .join('');

  // Marcador
  el.scoreA.textContent = s.teams.A;
  el.scoreB.textContent = s.teams.B;
  el.pot.textContent = s.pot;

  // Overlay fin de ronda
  if (s.phase === 'roundEnd' && s.lastAward) {
    el.awardText.textContent =
      `¡EQUIPO ${s.lastAward.team} SE LLEVA ${s.lastAward.points} PUNTOS!`;
  }

  // 3 errores: aviso temporal en pantalla
  if (justStruckOut && !s.lastAward) {
    el.awardText.textContent = '✕ ✕ ✕';
    el.awardOverlay.classList.remove('hidden');
    setTimeout(() => {
      if (el.awardText.textContent === '✕ ✕ ✕') {
        el.awardOverlay.classList.add('hidden');
      }
    }, 2500);
  }

  // Final
  if (s.phase === 'final') {
    const { A, B } = s.teams;
    el.winnerText.textContent =
      A === B ? `¡EMPATE! ${A} - ${B}` : `🏆 GANA EL EQUIPO ${A > B ? 'A' : 'B'} — ${Math.max(A, B)} puntos`;
  }
}

socket.on('state', render);
