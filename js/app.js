// Interface du jeu : plateau, modes (local, contre l'IA, en ligne), pendule,
// revue de partie, sons, thèmes, sauvegarde automatique et installation hors ligne.
import { Chess, colorOf, opposite, toUci } from './engine.js';
import { OnlineSession, isValidCode } from './online.js';
import { Clock, TIME_CONTROLS, formatTime } from './clock.js';
import { playSound, setSoundEnabled } from './sound.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PIECE_NAME = { k: 'roi', q: 'dame', r: 'tour', b: 'fou', n: 'cavalier', p: 'pion' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const SIDE = { w: 'Blancs', b: 'Noirs' };
const REASON = {
  checkmate: 'Échec et mat',
  stalemate: 'Pat',
  insufficient: 'Matériel insuffisant',
  fifty: 'Règle des 50 coups',
  repetition: 'Triple répétition',
  resign: 'Abandon',
  timeout: 'Temps écoulé',
  agreement: 'Nulle par accord mutuel',
};
// Fins de partie que le moteur ne peut pas recalculer à partir des coups.
const DECLARED = new Set(['resign', 'timeout', 'agreement']);
const THEMES = ['classique', 'vert', 'bleu', 'marbre'];
const STORAGE_KEY = 'echecs:partie';
const PREFS_KEY = 'echecs:prefs';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Variante « texte » : empêche iOS d'afficher les pièces en emoji.
const glyph = (p) => GLYPH[p.toLowerCase()] + '︎';

const $ = (id) => document.getElementById(id);
const els = {
  board: $('board'), status: $('status'), moves: $('moves'),
  mode: $('mode'), level: $('level'), color: $('color'), control: $('control'),
  aiOptions: $('ai-options'), onlineOptions: $('online-options'),
  onlineCreate: $('online-create'), onlineLink: $('online-link'), onlineUrl: $('online-url'),
  onlineCopy: $('online-copy'), onlineStatus: $('online-status'),
  newGame: $('new-game'), undo: $('undo'), flip: $('flip'), pgn: $('pgn'),
  resign: $('resign'), draw: $('draw'),
  drawOffer: $('draw-offer'), drawAccept: $('draw-accept'), drawDecline: $('draw-decline'),
  topName: $('top-name'), topCaptured: $('top-captured'), topClock: $('top-clock'),
  bottomName: $('bottom-name'), bottomCaptured: $('bottom-captured'), bottomClock: $('bottom-clock'),
  navFirst: $('nav-first'), navPrev: $('nav-prev'), navNext: $('nav-next'), navLast: $('nav-last'),
  theme: $('theme'), sound: $('sound'),
  promotion: $('promotion'), result: $('result'), resultTitle: $('result-title'),
  resultText: $('result-text'), rematch: $('rematch'), toast: $('toast'),
};

const state = {
  game: new Chess(),
  mode: 'local', // 'local' | 'ai' | 'online'
  level: 'moyen',
  colorChoice: 'w', // 'w' | 'b' | 'random' (contre l'IA)
  control: 'none', // clé de TIME_CONTROLS
  me: 'w', // couleur du joueur humain (IA, en ligne)
  flipped: false,
  selected: null,
  targets: [],
  result: null, // { winner, reason }
  thinking: false,
  onlineStatus: null,
  viewPly: null, // null = position actuelle ; sinon nombre de demi-coups affichés
  drawOffer: null, // 'sent' | 'received'
  animate: null, // { from, to } : coup à animer au prochain rendu
};

let online = null;
let clock = null;

/* ---------- Plateau ---------- */

const squares = [];
function buildBoard() {
  for (let i = 0; i < 64; i++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sq';
    el.setAttribute('role', 'gridcell');
    el.innerHTML = '<span class="piece"></span><span class="coord rank"></span><span class="coord file"></span>';
    squares.push(el);
    els.board.append(el);
  }
}

const sqAt = (i) => (state.flipped ? 63 - i : i);
const indexOf = (sq) => (state.flipped ? 63 - sq : sq);
const sqName = (sq) => 'abcdefgh'[sq & 7] + (8 - (sq >> 3));
const uciHistory = () => state.game.history.map((h) => toUci(h.move));
const isReviewing = () => state.viewPly !== null;

// Position affichée : l'actuelle, ou une position passée en mode revue.
let viewCache = { ply: -1, length: -1, game: null };
function displayedGame() {
  if (!isReviewing()) return state.game;
  const length = state.game.history.length;
  if (viewCache.ply !== state.viewPly || viewCache.length !== length) {
    const game = new Chess();
    for (const uci of uciHistory().slice(0, state.viewPly)) game.move(uci);
    viewCache = { ply: state.viewPly, length, game };
  }
  return viewCache.game;
}

function renderBoard() {
  const game = displayedGame();
  const last = game.history.at(-1)?.move;
  const checkSq = game.inCheck() ? game.kingSquare(game.turn) : -1;
  const interactive = canMove();

  squares.forEach((el, i) => {
    const sq = sqAt(i);
    const p = game.board[sq];
    const target = state.targets.find((m) => m.to === sq);
    el.dataset.sq = sq;
    el.classList.toggle('dark', ((sq >> 3) + (sq & 7)) % 2 === 1);
    el.classList.toggle('selected', sq === state.selected);
    el.classList.toggle('last', Boolean(last && (last.from === sq || last.to === sq)));
    el.classList.toggle('check', sq === checkSq);
    el.classList.toggle('dot', Boolean(target && !target.captured));
    el.classList.toggle('capture', Boolean(target?.captured));
    el.classList.toggle('movable', interactive && Boolean(p) && colorOf(p) === game.turn);

    const piece = el.firstChild;
    piece.textContent = p ? glyph(p) : '';
    piece.className = p ? `piece ${colorOf(p)}` : 'piece';
    el.children[1].textContent = i % 8 === 0 ? 8 - (sq >> 3) : '';
    el.children[2].textContent = i >= 56 ? 'abcdefgh'[sq & 7] : '';
    el.setAttribute('aria-label', `${sqName(sq)}${p ? `, ${PIECE_NAME[p.toLowerCase()]} ${colorOf(p) === 'w' ? 'blanc' : 'noir'}` : ''}`);
  });
  els.board.classList.toggle('reviewing', isReviewing());
  animatePending();
}

// La pièce glisse de sa case de départ à sa case d'arrivée.
function animatePending() {
  const move = state.animate;
  state.animate = null;
  if (!move || reducedMotion.matches) return;
  const from = squares[indexOf(move.from)].getBoundingClientRect();
  const toEl = squares[indexOf(move.to)];
  const to = toEl.getBoundingClientRect();
  const piece = toEl.firstChild;
  piece.classList.add('moving');
  const anim = piece.animate(
    [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }],
    { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)' },
  );
  anim.onfinish = anim.oncancel = () => piece.classList.remove('moving');
}

// Pièces prises par chaque camp + avantage matériel.
function renderPlayers() {
  const game = displayedGame();
  const count = {};
  for (const p of game.board) if (p) count[p] = (count[p] || 0) + 1;
  const lost = (color) => {
    const out = [];
    for (const [t, n] of Object.entries(START_COUNT)) {
      const piece = color === 'w' ? t.toUpperCase() : t;
      for (let k = count[piece] || 0; k < n; k++) out.push(piece);
    }
    return out;
  };
  const material = (color) => game.board.reduce(
    (s, p) => s + (p && colorOf(p) === color ? VALUE[p.toLowerCase()] : 0), 0);
  const diff = material('w') - material('b');

  const bottom = state.flipped ? 'b' : 'w';
  const fill = (nameEl, capEl, color) => {
    nameEl.textContent = playerName(color);
    const pieces = lost(opposite(color)).map((p) => `<span class="piece ${colorOf(p)}">${glyph(p)}</span>`).join('');
    const adv = color === 'w' ? diff : -diff;
    capEl.innerHTML = pieces + (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
    nameEl.parentElement.classList.toggle('to-move', !state.result && state.game.turn === color);
  };
  fill(els.bottomName, els.bottomCaptured, bottom);
  fill(els.topName, els.topCaptured, opposite(bottom));
  renderClocks();
}

let lastTickSecond = null;
function renderClocks() {
  const bottom = state.flipped ? 'b' : 'w';
  for (const [el, color] of [[els.bottomClock, bottom], [els.topClock, opposite(bottom)]]) {
    el.hidden = !clock;
    if (!clock) continue;
    const ms = clock.time(color);
    el.textContent = formatTime(ms);
    el.classList.toggle('running', clock.running === color);
    el.classList.toggle('low', ms < 20e3);
  }
  // Bip à chaque seconde sous les 10 s, pour le joueur humain qui a le trait.
  const running = clock?.running;
  const human = running && (state.mode === 'local' || running === state.me);
  const ms = human ? clock.time(running) : Infinity;
  const second = ms < 10e3 ? Math.ceil(ms / 1000) : null;
  if (second !== null && second !== lastTickSecond) playSound('tick');
  lastTickSecond = second;
}

function playerName(color) {
  if (state.mode === 'ai') return color === state.me ? 'Vous' : `Ordinateur (${state.level})`;
  if (state.mode === 'online') return color === state.me ? 'Vous' : 'Adversaire';
  return SIDE[color];
}

function renderMoves() {
  const sans = state.game.sanHistory();
  const shown = state.viewPly ?? sans.length;
  els.moves.innerHTML = '';
  let current = null;
  for (let i = 0; i < sans.length; i += 2) {
    const li = document.createElement('li');
    for (const j of [i, i + 1]) {
      if (!sans[j]) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = sans[j];
      btn.dataset.ply = j + 1;
      if (j + 1 === shown) { btn.className = 'current'; current = btn; }
      li.append(btn);
    }
    els.moves.append(li);
  }
  if (!isReviewing()) els.moves.scrollTop = els.moves.scrollHeight;
  else current?.scrollIntoView({ block: 'nearest' });

  const length = sans.length;
  els.navFirst.disabled = els.navPrev.disabled = shown === 0;
  els.navNext.disabled = els.navLast.disabled = shown === length;
}

function statusText() {
  const { game, result } = state;
  if (isReviewing()) return `Revue — coup ${state.viewPly} / ${game.history.length}`;
  if (result) {
    const reason = REASON[result.reason];
    if (result.reason === 'timeout' && !result.winner) return `${reason} — nulle (matériel insuffisant pour gagner)`;
    return result.winner ? `${reason} — les ${SIDE[result.winner]} gagnent` : `${reason} — partie nulle`;
  }
  if (state.mode === 'online' && state.onlineStatus !== 'connected') {
    return {
      connecting: 'Connexion…',
      waiting: 'En attente de l’adversaire… partagez le lien.',
      disconnected: 'Adversaire déconnecté — en attente de son retour…',
      error: 'Jeu en ligne indisponible.',
    }[state.onlineStatus] || 'Créez une partie ou ouvrez un lien d’invitation.';
  }
  if (state.thinking) return 'L’ordinateur réfléchit…';
  const check = game.inCheck() ? ' — échec !' : '';
  if (state.mode === 'local') return `Aux ${SIDE[game.turn]} de jouer${check}`;
  if (!state.me) return 'Synchronisation…';
  return (game.turn === state.me ? 'À vous de jouer' : 'Au tour de l’adversaire') + check;
}

function render() {
  renderBoard();
  renderPlayers();
  renderMoves();
  els.status.textContent = statusText();
  els.status.classList.toggle('alert', !state.result && !isReviewing() && state.game.inCheck());

  const isOnline = state.mode === 'online';
  const playing = !state.result && state.game.history.length > 0;
  els.aiOptions.hidden = state.mode !== 'ai';
  els.onlineOptions.hidden = !isOnline;
  els.onlineCreate.hidden = isConnected();
  // L'invité suit la cadence choisie par l'hôte.
  els.control.disabled = isOnline && online && !online.isHost;
  els.undo.disabled = isOnline || !state.game.history.length;
  els.resign.hidden = !isOnline;
  els.resign.disabled = !isConnected() || Boolean(state.result);
  els.draw.hidden = state.mode === 'ai';
  els.draw.disabled = !playing || (isOnline && (!isConnected() || state.drawOffer !== null));
  els.draw.textContent = state.drawOffer === 'sent' ? 'Nulle proposée…' : 'Proposer nulle';
  els.drawOffer.hidden = state.drawOffer !== 'received' || Boolean(state.result);
  els.newGame.textContent = isOnline ? 'Revanche' : 'Nouvelle partie';
  els.newGame.disabled = isOnline && (!isConnected() || !state.result);
}

/* ---------- Coups ---------- */

const isConnected = () => state.onlineStatus === 'connected';

function canMove() {
  if (state.result || state.thinking || isReviewing()) return false;
  if (state.mode === 'local') return true;
  if (state.mode === 'online' && !isConnected()) return false;
  return state.game.turn === state.me;
}

function select(sq) {
  state.selected = sq;
  state.targets = state.game.moves({ from: sq });
  renderBoard();
}

function clearSelection() {
  state.selected = null;
  state.targets = [];
  renderBoard();
}

// Clic ou relâchement sur une case. Renvoie true si un coup a été lancé.
function activate(sq, { dragged = false } = {}) {
  if (!canMove()) return false;
  const candidates = state.targets.filter((m) => m.to === sq);
  if (candidates.length) {
    playFromUi(candidates, dragged);
    return true;
  }
  const p = state.game.board[sq];
  if (p && colorOf(p) === state.game.turn && sq !== state.selected) select(sq);
  else clearSelection();
  return false;
}

async function playFromUi(candidates, dragged) {
  let move = candidates[0];
  if (move.promotion) {
    const choice = await askPromotion(state.game.turn);
    if (!choice) return clearSelection();
    move = candidates.find((m) => m.promotion === choice);
  }
  applyMove(toUci(move), { local: true, animate: !dragged });
}

function applyMove(uci, { local = false, animate = true, clockTimes = null } = {}) {
  const mover = state.game.turn;
  const played = state.game.move(uci);
  if (!played) return false;
  state.selected = null;
  state.targets = [];
  state.viewPly = null;
  state.drawOffer = null;
  if (animate) state.animate = { from: played.from, to: played.to };

  if (clock) {
    clock.press(mover);
    // En ligne, le temps du joueur qui vient de jouer est celui de sa pendule.
    if (clockTimes && Number.isFinite(clockTimes[mover])) clock.set({ [mover]: clockTimes[mover] });
  }
  const result = state.game.outcome();
  if (local && state.mode === 'online') {
    online.send({ type: 'move', uci, ply: state.game.history.length, clock: clock?.snapshot() });
  }

  if (result) {
    endGame(result);
  } else {
    playSound(played.san.endsWith('+') ? 'check' : played.flag === 'k' || played.flag === 'q' ? 'castle' : played.captured ? 'capture' : 'move');
    vibrate(played.captured ? [15, 30, 15] : 12);
    save();
    render();
    requestAiMove();
  }
  return true;
}

// Fin de partie : `message` est envoyé à l'adversaire en ligne s'il est fourni.
function endGame(result, message) {
  if (state.result) return;
  state.result = result;
  state.drawOffer = null;
  clock?.stop();
  cancelAi();
  if (message && state.mode === 'online') online?.send(message);
  const { winner } = result;
  playSound(!winner ? 'draw' : state.mode === 'local' || winner === state.me ? 'win' : 'lose');
  vibrate([30, 60, 30]);
  save();
  render();
  showResult();
}

function askPromotion(color) {
  const dialog = els.promotion;
  dialog.querySelectorAll('button[value] .piece').forEach((el) => {
    el.className = `piece ${color}`;
  });
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue || null), { once: true });
  });
}

function showResult() {
  const { winner, reason } = state.result;
  let title = 'Partie nulle';
  if (winner) {
    title = state.mode === 'local' ? `Les ${SIDE[winner]} gagnent` : winner === state.me ? 'Victoire !' : 'Défaite';
  }
  els.resultTitle.textContent = title;
  els.resultText.textContent = REASON[reason];
  els.rematch.textContent = state.mode === 'online' ? 'Revanche' : 'Rejouer';
  els.rematch.disabled = state.mode === 'online' && !isConnected();
  if (!els.result.open) els.result.showModal();
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* non pris en charge */ }
}

/* ---------- Pendule ---------- */

function setupClock(times) {
  clock?.stop();
  const control = TIME_CONTROLS[state.control];
  clock = control ? new Clock(control, { onFlag, onTick: renderClocks }) : null;
  if (clock && times) clock.set(times);
  renderClocks();
}

// La pendule tourne dès que les blancs ont joué leur premier coup.
function resumeClock() {
  if (clock && !state.result && state.game.history.length) clock.start(state.game.turn);
}

// Il faut au moins une pièce autre qu'un fou ou un cavalier seul pour mater.
function canMate(color) {
  const pieces = state.game.board.filter((p) => p && colorOf(p) === color && p.toLowerCase() !== 'k');
  return pieces.length > 1 || (pieces.length === 1 && !'nb'.includes(pieces[0].toLowerCase()));
}

function onFlag(loser) {
  if (state.result) return;
  const winner = opposite(loser);
  const result = { winner: canMate(winner) ? winner : null, reason: 'timeout' };
  if (state.mode === 'online' && loser !== state.me) {
    // Laisse le temps au dernier coup de l'adversaire d'arriver avant de conclure.
    setTimeout(() => {
      if (!state.result && clock && clock.time(loser) === 0) endGame(result, { type: 'timeout', loser });
    }, 1500);
    return;
  }
  endGame(result, { type: 'timeout', loser });
}

/* ---------- IA ---------- */

let worker = null;
let aiRequest = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => onAiMove(data);
    // Navigateur sans worker module : calcul sur le fil principal.
    worker.onerror = () => {
      worker.terminate();
      worker = 'inline';
      requestAiMove();
    };
  }
  return worker;
}

// FEN des positions précédentes : l'IA s'en sert pour gérer les répétitions.
function previousPositions() {
  const game = new Chess();
  const fens = [];
  for (const uci of uciHistory()) {
    fens.push(game.fen());
    game.move(uci);
  }
  return fens;
}

function requestAiMove() {
  if (state.mode !== 'ai' || state.result || state.game.turn === state.me) return;
  state.thinking = true;
  render();
  const ai = state.game.turn;
  // Avec une pendule, l'IA répartit son temps restant sur une trentaine de coups.
  const maxTimeMs = clock ? clock.time(ai) / 30 + clock.inc * 0.8 : Infinity;
  const request = {
    id: ++aiRequest, fen: state.game.fen(), level: state.level,
    history: previousPositions(), maxTimeMs,
  };
  const w = getWorker();
  if (w === 'inline') {
    import('./ai.js').then(({ bestMove }) => setTimeout(() => {
      onAiMove({ id: request.id, move: bestMove(request.fen, request.level, request) });
    }, 30));
  } else {
    w.postMessage(request);
  }
}

function onAiMove({ id, move }) {
  if (id !== aiRequest) return; // réponse périmée (annulation, nouvelle partie)
  state.thinking = false;
  if (!move || !applyMove(move)) render();
}

function cancelAi() {
  aiRequest++;
  state.thinking = false;
}

/* ---------- Parties ---------- */

function newGame(moves = []) {
  cancelAi();
  state.game = new Chess();
  for (const m of moves) if (!state.game.move(m)) break;
  state.selected = null;
  state.targets = [];
  state.viewPly = null;
  state.drawOffer = null;
  state.result = state.game.outcome();
  setupClock();
  if (els.result.open) els.result.close();
}

function startLocalOrAi() {
  if (state.mode === 'ai') {
    state.me = state.colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : state.colorChoice;
    state.flipped = state.me === 'b';
  }
  newGame();
  save();
  render();
  playSound('start');
  requestAiMove();
}

function undo() {
  if (state.mode === 'online' || !state.game.history.length) return;
  cancelAi();
  state.game.undo();
  // Contre l'IA, on revient jusqu'à son propre tour.
  if (state.mode === 'ai' && state.game.turn !== state.me && state.game.history.length) state.game.undo();
  state.selected = null;
  state.targets = [];
  state.viewPly = null;
  const wasOver = state.result;
  state.result = state.game.outcome();
  clock?.stop();
  if (wasOver && clock) {
    // Une partie perdue au temps reprend avec quelques secondes de grâce.
    clock.set({ w: Math.max(clock.time('w'), 10e3), b: Math.max(clock.time('b'), 10e3) });
  }
  resumeClock();
  save();
  render();
  requestAiMove();
}

function save() {
  if (state.mode === 'online') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode, level: state.level, colorChoice: state.colorChoice, control: state.control,
      me: state.me, flipped: state.flipped, moves: uciHistory(), clock: clock?.snapshot() || null,
      ended: DECLARED.has(state.result?.reason) ? state.result : null,
    }));
  } catch { /* stockage indisponible (navigation privée…) */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !['local', 'ai'].includes(saved.mode)) return;
    Object.assign(state, {
      mode: saved.mode,
      level: saved.level in { facile: 1, moyen: 1, difficile: 1 } ? saved.level : 'moyen',
      colorChoice: ['w', 'b', 'random'].includes(saved.colorChoice) ? saved.colorChoice : 'w',
      control: saved.control in TIME_CONTROLS ? saved.control : 'none',
      me: saved.me === 'b' ? 'b' : 'w',
      flipped: Boolean(saved.flipped),
    });
    newGame(Array.isArray(saved.moves) ? saved.moves : []);
    if (saved.ended && DECLARED.has(saved.ended.reason)) state.result = saved.ended;
    if (clock && saved.clock) clock.set(saved.clock);
    resumeClock();
  } catch { /* sauvegarde absente ou corrompue */ }
}

function loadPrefs() {
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { /* aucune préférence */ }
  applyTheme(THEMES.includes(prefs.theme) ? prefs.theme : 'classique');
  els.sound.checked = prefs.sound !== false;
  setSoundEnabled(els.sound.checked);
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: els.theme.value, sound: els.sound.checked }));
  } catch { /* stockage indisponible */ }
}

function applyTheme(theme) {
  els.theme.value = theme;
  document.documentElement.dataset.board = theme;
}

async function exportPgn() {
  const { result } = state;
  const score = !result ? '*' : !result.winner ? '1/2-1/2' : result.winner === 'w' ? '1-0' : '0-1';
  const pgn = state.game.pgn({ result: score, white: playerName('w'), black: playerName('b') });
  try {
    await navigator.clipboard.writeText(pgn);
    toast('PGN copié dans le presse-papiers');
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
    a.download = 'partie.pgn';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

/* ---------- Revue de la partie ---------- */

function viewPly(ply) {
  const length = state.game.history.length;
  const target = Math.max(0, Math.min(length, ply));
  const current = state.viewPly ?? length;
  if (target === current) return;
  // Un pas en avant rejoue le coup avec son animation.
  if (target === current + 1) {
    const { move } = state.game.history[target - 1];
    state.animate = { from: move.from, to: move.to };
    playSound(move.captured ? 'capture' : 'move');
  }
  state.viewPly = target === length ? null : target;
  state.selected = null;
  state.targets = [];
  render();
}

const shownPly = () => state.viewPly ?? state.game.history.length;

/* ---------- En ligne ---------- */

function setMode(mode) {
  if (mode === state.mode) return;
  if (state.mode === 'online') leaveOnline();
  state.mode = mode;
  els.mode.value = mode;
  if (mode === 'online') {
    state.onlineStatus = null;
    state.me = 'w';
    state.flipped = false;
    newGame();
    els.onlineLink.hidden = true;
    render();
  } else {
    if (mode === 'local') state.flipped = false;
    startLocalOrAi();
  }
}

function leaveOnline() {
  online?.close();
  online = null;
  state.onlineStatus = null;
  if (new URLSearchParams(location.search).has('partie')) history.replaceState(null, '', location.pathname);
}

function createSession() {
  online?.close();
  online = new OnlineSession({ onMessage: onRemote, onStatus: onOnlineStatus });
  return online;
}

async function hostOnline() {
  const session = createSession();
  state.me = 'w';
  state.flipped = false;
  newGame();
  render();
  try {
    const code = await session.host();
    els.onlineUrl.value = `${location.origin}${location.pathname}?partie=${code}`;
    els.onlineLink.hidden = false;
    els.onlineUrl.select();
  } catch (e) {
    onOnlineStatus('error', e.message);
  }
}

async function joinOnline(code) {
  setMode('online');
  const session = createSession();
  state.me = null; // fixé par l'hôte au message « start »
  try {
    await session.join(code);
  } catch (e) {
    onOnlineStatus('error', e.message);
  }
}

// L'hôte fait autorité : couleurs, cadence, historique complet et pendules.
function sendStart() {
  online.send({
    type: 'start', you: opposite(state.me), moves: uciHistory(), control: state.control,
    clock: clock?.snapshot() || null, result: DECLARED.has(state.result?.reason) ? state.result : null,
  });
}

function onOnlineStatus(status, message) {
  const wasConnected = isConnected();
  state.onlineStatus = status;
  els.onlineStatus.textContent = message || {
    connecting: 'Connexion au serveur…',
    waiting: 'Partie créée. Envoyez le lien à votre adversaire.',
    connected: state.me ? `Connecté — vous jouez les ${SIDE[state.me]}.` : 'Connecté — synchronisation…',
    disconnected: 'Connexion perdue.',
  }[status] || '';
  if (status === 'connected') {
    els.onlineLink.hidden = true;
    if (online.isHost) sendStart();
    if (!wasConnected) { playSound('notify'); vibrate(20); }
  }
  render();
}

function onRemote(msg) {
  const { game } = state;
  switch (msg.type) {
    case 'start': {
      if (online.isHost) return;
      state.me = msg.you === 'b' ? 'b' : 'w';
      state.flipped = state.me === 'b';
      state.control = msg.control in TIME_CONTROLS ? msg.control : 'none';
      els.control.value = state.control;
      newGame(Array.isArray(msg.moves) ? msg.moves : []);
      if (DECLARED.has(msg.result?.reason)) state.result = msg.result;
      if (clock && msg.clock) clock.set(msg.clock);
      resumeClock();
      onOnlineStatus('connected');
      if (state.result) showResult();
      break;
    }
    case 'move': {
      const expected = game.history.length + 1;
      const ok = msg.ply === expected && game.turn !== state.me && !state.result && typeof msg.uci === 'string'
        && applyMove(msg.uci, { clockTimes: msg.clock });
      // Désynchronisation : l'hôte renvoie l'état, l'invité le redemande.
      if (!ok) { if (online.isHost) sendStart(); else online.send({ type: 'sync' }); }
      break;
    }
    case 'sync':
      if (online.isHost) sendStart();
      break;
    case 'resign':
      endGame({ winner: state.me, reason: 'resign' });
      break;
    case 'timeout': {
      const loser = msg.loser === 'w' || msg.loser === 'b' ? msg.loser : null;
      if (!loser) return;
      const winner = opposite(loser);
      endGame({ winner: canMate(winner) ? winner : null, reason: 'timeout' });
      break;
    }
    case 'draw-offer':
      if (state.result) return;
      state.drawOffer = 'received';
      playSound('notify');
      render();
      break;
    case 'draw-accept':
      if (state.drawOffer === 'sent') endGame({ winner: null, reason: 'agreement' });
      break;
    case 'draw-decline':
      if (state.drawOffer !== 'sent') return;
      state.drawOffer = null;
      toast('Nulle refusée');
      render();
      break;
    case 'rematch':
      if (online.isHost) rematch();
      break;
  }
}

function rematch() {
  if (!online.isHost) { online.send({ type: 'rematch' }); return; }
  // Les couleurs s'inversent à chaque revanche.
  state.me = opposite(state.me);
  state.flipped = state.me === 'b';
  newGame();
  sendStart();
  playSound('start');
  onOnlineStatus('connected');
}

function resign() {
  if (state.mode !== 'online' || state.result || !isConnected()) return;
  if (!confirm('Abandonner la partie ?')) return;
  endGame({ winner: opposite(state.me), reason: 'resign' }, { type: 'resign' });
}

function offerDraw() {
  if (state.result || !state.game.history.length) return;
  if (state.mode === 'local') {
    if (confirm('Déclarer la partie nulle d’un commun accord ?')) endGame({ winner: null, reason: 'agreement' });
    return;
  }
  if (state.mode !== 'online' || !isConnected() || state.drawOffer) return;
  state.drawOffer = 'sent';
  online.send({ type: 'draw-offer' });
  toast('Nulle proposée à l’adversaire');
  render();
}

function answerDraw(accept) {
  if (state.drawOffer !== 'received') return;
  if (accept) {
    endGame({ winner: null, reason: 'agreement' }, { type: 'draw-accept' });
  } else {
    state.drawOffer = null;
    online.send({ type: 'draw-decline' });
    render();
  }
}

/* ---------- Glisser-déposer ---------- */

let drag = null;

function squareFromPoint(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.sq');
  return el && els.board.contains(el) ? Number(el.dataset.sq) : null;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const el = e.target.closest('.sq');
  if (!el) return;
  e.preventDefault();
  // En revue, toucher le plateau ramène à la position actuelle.
  if (isReviewing()) { viewPly(Infinity); return; }
  const sq = Number(el.dataset.sq);
  // Pièce déjà sélectionnée : un simple clic la désélectionne, un glissé la joue.
  const deselect = state.selected === sq && canMove();
  if (!deselect && (activate(sq) || state.selected !== sq)) return;

  const pieceEl = el.firstChild;
  const size = el.getBoundingClientRect().width;
  const ghost = document.createElement('div');
  ghost.className = `ghost ${pieceEl.className}`;
  ghost.textContent = pieceEl.textContent;
  ghost.style.width = ghost.style.height = `${size}px`;
  ghost.style.fontSize = getComputedStyle(pieceEl).fontSize;
  drag = { sq, el, ghost, size, deselect, x: e.clientX, y: e.clientY, moved: false };
  moveGhost(e);
}

function moveGhost(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
    drag.moved = true;
    document.body.append(drag.ghost);
    drag.el.classList.add('dragging');
  }
  drag.ghost.style.transform = `translate(${e.clientX - drag.size / 2}px, ${e.clientY - drag.size / 2}px)`;
}

function onPointerUp(e) {
  if (!drag) return;
  const { sq, el, ghost, moved, deselect } = drag;
  drag = null;
  ghost.remove();
  el.classList.remove('dragging');
  if (!moved) { if (deselect) clearSelection(); return; }
  const target = squareFromPoint(e.clientX, e.clientY);
  if (target !== null && target !== sq) activate(target, { dragged: true });
}

/* ---------- Démarrage ---------- */

function bindEvents() {
  els.board.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', moveGhost);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  // Clavier (Entrée / Espace sur une case) : detail === 0.
  els.board.addEventListener('click', (e) => {
    const el = e.target.closest('.sq');
    if (!el || e.detail !== 0) return;
    if (isReviewing()) viewPly(Infinity);
    else activate(Number(el.dataset.sq));
  });
  els.board.addEventListener('keydown', onBoardKey);

  els.mode.addEventListener('change', () => setMode(els.mode.value));
  els.level.addEventListener('change', () => { state.level = els.level.value; save(); render(); });
  els.color.addEventListener('change', () => { state.colorChoice = els.color.value; startLocalOrAi(); });
  els.control.addEventListener('change', onControlChange);
  els.newGame.addEventListener('click', () => (state.mode === 'online' ? rematch() : startLocalOrAi()));
  els.rematch.addEventListener('click', () => (state.mode === 'online' ? rematch() : startLocalOrAi()));
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', () => { state.flipped = !state.flipped; save(); render(); });
  els.pgn.addEventListener('click', exportPgn);
  els.resign.addEventListener('click', resign);
  els.draw.addEventListener('click', offerDraw);
  els.drawAccept.addEventListener('click', () => answerDraw(true));
  els.drawDecline.addEventListener('click', () => answerDraw(false));
  els.moves.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ply]');
    if (btn) viewPly(Number(btn.dataset.ply));
  });
  els.navFirst.addEventListener('click', () => viewPly(0));
  els.navPrev.addEventListener('click', () => viewPly(shownPly() - 1));
  els.navNext.addEventListener('click', () => viewPly(shownPly() + 1));
  els.navLast.addEventListener('click', () => viewPly(Infinity));
  els.theme.addEventListener('change', () => { applyTheme(els.theme.value); savePrefs(); });
  els.sound.addEventListener('change', () => {
    setSoundEnabled(els.sound.checked);
    savePrefs();
    playSound('move');
  });
  els.onlineCreate.addEventListener('click', hostOnline);
  els.onlineCopy.addEventListener('click', async () => {
    const url = els.onlineUrl.value;
    if (navigator.share) {
      try { await navigator.share({ title: 'Partie d’échecs', text: 'Rejoins-moi pour une partie !', url }); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { els.onlineUrl.select(); }
  });
  document.addEventListener('keydown', onGlobalKey);
  // Sauvegarde des pendules quand l'onglet est fermé ou mis en arrière-plan.
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
}

function onControlChange() {
  state.control = els.control.value;
  if (state.mode !== 'online') { startLocalOrAi(); return; }
  // Hôte : la nouvelle cadence s'applique tout de suite si la partie n'a pas commencé.
  if (!state.game.history.length) {
    setupClock();
    if (isConnected()) sendStart();
    render();
  } else {
    toast('La cadence s’appliquera à la prochaine partie');
  }
}

function onGlobalKey(e) {
  if (e.target.closest('input, select, textarea, dialog')) return;
  if (e.key === 'Escape' && state.selected !== null) clearSelection();
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  // Flèches hors du plateau : naviguer dans la partie.
  if (squares.includes(document.activeElement)) return;
  const nav = { ArrowLeft: shownPly() - 1, ArrowRight: shownPly() + 1, Home: 0, End: Infinity }[e.key];
  if (nav !== undefined) { e.preventDefault(); viewPly(nav); }
}

// Flèches pour se déplacer de case en case sur le plateau.
function onBoardKey(e) {
  const delta = { ArrowUp: -8, ArrowDown: 8, ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (delta === undefined) return;
  const i = squares.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = i + delta;
  if (next < 0 || next > 63 || (Math.abs(delta) === 1 && Math.floor(next / 8) !== Math.floor(i / 8))) return;
  squares[next].focus();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function init() {
  buildBoard();
  bindEvents();
  loadPrefs();
  const code = new URLSearchParams(location.search).get('partie');
  if (code && isValidCode(code)) {
    joinOnline(code);
  } else {
    restore();
    els.mode.value = state.mode;
    render();
    requestAiMove();
  }
  els.level.value = state.level;
  els.color.value = state.colorChoice;
  els.control.value = state.control;
  registerServiceWorker();
}

init();
