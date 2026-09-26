// Interface du jeu : plateau, modes (local, contre l'IA, en ligne), historique,
// sauvegarde automatique et installation hors ligne.
import { Chess, colorOf, opposite, toUci } from './engine.js';
import { OnlineSession, isValidCode } from './online.js';

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
};
const STORAGE_KEY = 'echecs:partie';
// Variante « texte » : empêche iOS d'afficher les pièces en emoji.
const glyph = (p) => GLYPH[p.toLowerCase()] + '︎';

const $ = (id) => document.getElementById(id);
const els = {
  board: $('board'), status: $('status'), moves: $('moves'),
  mode: $('mode'), level: $('level'), color: $('color'),
  aiOptions: $('ai-options'), onlineOptions: $('online-options'),
  onlineCreate: $('online-create'), onlineLink: $('online-link'), onlineUrl: $('online-url'),
  onlineCopy: $('online-copy'), onlineStatus: $('online-status'),
  newGame: $('new-game'), undo: $('undo'), flip: $('flip'), pgn: $('pgn'), resign: $('resign'),
  topName: $('top-name'), topCaptured: $('top-captured'),
  bottomName: $('bottom-name'), bottomCaptured: $('bottom-captured'),
  promotion: $('promotion'), result: $('result'), resultTitle: $('result-title'),
  resultText: $('result-text'), rematch: $('rematch'), toast: $('toast'),
};

const state = {
  game: new Chess(),
  mode: 'local', // 'local' | 'ai' | 'online'
  level: 'moyen',
  colorChoice: 'w', // 'w' | 'b' | 'random' (contre l'IA)
  me: 'w', // couleur du joueur humain (IA, en ligne)
  flipped: false,
  selected: null,
  targets: [],
  result: null, // { winner, reason }
  thinking: false,
  onlineStatus: null,
};

let online = null;

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
const sqName = (sq) => 'abcdefgh'[sq & 7] + (8 - (sq >> 3));

function renderBoard() {
  const { game } = state;
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
}

// Pièces prises par chaque camp + avantage matériel.
function renderPlayers() {
  const count = {};
  for (const p of state.game.board) if (p) count[p] = (count[p] || 0) + 1;
  const lost = (color) => {
    const out = [];
    for (const [t, n] of Object.entries(START_COUNT)) {
      const piece = color === 'w' ? t.toUpperCase() : t;
      for (let k = count[piece] || 0; k < n; k++) out.push(piece);
    }
    return out;
  };
  const material = (color) => state.game.board.reduce(
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
}

function playerName(color) {
  if (state.mode === 'ai') return color === state.me ? 'Vous' : `Ordinateur (${state.level})`;
  if (state.mode === 'online') return color === state.me ? 'Vous' : 'Adversaire';
  return SIDE[color];
}

function renderMoves() {
  const sans = state.game.sanHistory();
  els.moves.innerHTML = '';
  for (let i = 0; i < sans.length; i += 2) {
    const li = document.createElement('li');
    for (const [j, san] of [[i, sans[i]], [i + 1, sans[i + 1]]]) {
      if (!san) continue;
      const span = document.createElement('span');
      span.textContent = san;
      if (j === sans.length - 1) span.className = 'current';
      li.append(span);
    }
    els.moves.append(li);
  }
  els.moves.scrollTop = els.moves.scrollHeight;
}

function statusText() {
  const { game, result } = state;
  if (result) {
    const reason = REASON[result.reason];
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
  els.status.classList.toggle('alert', !state.result && state.game.inCheck());

  const isOnline = state.mode === 'online';
  els.aiOptions.hidden = state.mode !== 'ai';
  els.onlineOptions.hidden = !isOnline;
  els.onlineCreate.hidden = isConnected();
  els.undo.disabled = isOnline || !state.game.history.length;
  els.resign.hidden = !isOnline;
  els.resign.disabled = !isConnected() || Boolean(state.result);
  els.newGame.textContent = isOnline ? 'Revanche' : 'Nouvelle partie';
  els.newGame.disabled = isOnline && (!isConnected() || !state.result);
}

/* ---------- Coups ---------- */

const isConnected = () => state.onlineStatus === 'connected';

function canMove() {
  if (state.result || state.thinking) return false;
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
function activate(sq) {
  if (!canMove()) return false;
  const candidates = state.targets.filter((m) => m.to === sq);
  if (candidates.length) {
    playFromUi(candidates);
    return true;
  }
  const p = state.game.board[sq];
  if (p && colorOf(p) === state.game.turn && sq !== state.selected) select(sq);
  else clearSelection();
  return false;
}

async function playFromUi(candidates) {
  let move = candidates[0];
  if (move.promotion) {
    const choice = await askPromotion(state.game.turn);
    if (!choice) return clearSelection();
    move = candidates.find((m) => m.promotion === choice);
  }
  applyMove(toUci(move), true);
}

function applyMove(uci, local) {
  const played = state.game.move(uci);
  if (!played) return false;
  state.selected = null;
  state.targets = [];
  state.result = state.game.outcome();
  if (local && state.mode === 'online') {
    online.send({ type: 'move', uci, ply: state.game.history.length });
  }
  vibrate(played.captured ? [15, 30, 15] : 12);
  save();
  render();
  if (state.result) showResult();
  else requestAiMove();
  return true;
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

function requestAiMove() {
  if (state.mode !== 'ai' || state.result || state.game.turn === state.me) return;
  state.thinking = true;
  render();
  const request = { id: ++aiRequest, fen: state.game.fen(), level: state.level };
  const w = getWorker();
  if (w === 'inline') {
    import('./ai.js').then(({ bestMove }) => setTimeout(() => {
      onAiMove({ id: request.id, move: bestMove(request.fen, request.level) });
    }, 30));
  } else {
    w.postMessage(request);
  }
}

function onAiMove({ id, move }) {
  if (id !== aiRequest) return; // réponse périmée (annulation, nouvelle partie)
  state.thinking = false;
  if (!move || !applyMove(move, false)) render();
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
  state.result = state.game.outcome();
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
  state.result = state.game.outcome();
  save();
  render();
  requestAiMove();
}

const uciHistory = () => state.game.history.map((h) => toUci(h.move));

function save() {
  if (state.mode === 'online') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: state.mode, level: state.level, colorChoice: state.colorChoice,
      me: state.me, flipped: state.flipped, moves: uciHistory(),
      resigned: state.result?.reason === 'resign' ? state.result : null,
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
      me: saved.me === 'b' ? 'b' : 'w',
      flipped: Boolean(saved.flipped),
    });
    newGame(Array.isArray(saved.moves) ? saved.moves : []);
    if (saved.resigned) state.result = saved.resigned;
  } catch { /* sauvegarde absente ou corrompue */ }
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
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

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

// L'hôte fait autorité : il fixe les couleurs et renvoie l'historique complet.
function sendStart() {
  online.send({ type: 'start', you: opposite(state.me), moves: uciHistory(), result: state.result });
}

function onOnlineStatus(status, message) {
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
    vibrate(20);
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
      newGame(Array.isArray(msg.moves) ? msg.moves : []);
      if (msg.result?.reason === 'resign') state.result = msg.result;
      onOnlineStatus('connected');
      if (state.result) showResult();
      break;
    }
    case 'move': {
      const expected = game.history.length + 1;
      if (msg.ply !== expected || game.turn === state.me || typeof msg.uci !== 'string' || !applyMove(msg.uci, false)) {
        // Désynchronisation : l'hôte renvoie l'état, l'invité le redemande.
        if (online.isHost) sendStart(); else online.send({ type: 'sync' });
      }
      break;
    }
    case 'sync':
      if (online.isHost) sendStart();
      break;
    case 'resign':
      if (state.result) return;
      state.result = { winner: state.me, reason: 'resign' };
      render();
      showResult();
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
  onOnlineStatus('connected');
}

function resign() {
  if (state.mode !== 'online' || state.result || !isConnected()) return;
  if (!confirm('Abandonner la partie ?')) return;
  online.send({ type: 'resign' });
  state.result = { winner: opposite(state.me), reason: 'resign' };
  render();
  showResult();
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
  if (target !== null && target !== sq) activate(target);
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
    if (el && e.detail === 0) activate(Number(el.dataset.sq));
  });
  els.board.addEventListener('keydown', onBoardKey);

  els.mode.addEventListener('change', () => setMode(els.mode.value));
  els.level.addEventListener('change', () => { state.level = els.level.value; save(); render(); });
  els.color.addEventListener('change', () => { state.colorChoice = els.color.value; startLocalOrAi(); });
  els.newGame.addEventListener('click', () => (state.mode === 'online' ? rematch() : startLocalOrAi()));
  els.rematch.addEventListener('click', () => (state.mode === 'online' ? rematch() : startLocalOrAi()));
  els.undo.addEventListener('click', undo);
  els.flip.addEventListener('click', () => { state.flipped = !state.flipped; save(); render(); });
  els.pgn.addEventListener('click', exportPgn);
  els.resign.addEventListener('click', resign);
  els.onlineCreate.addEventListener('click', hostOnline);
  els.onlineCopy.addEventListener('click', async () => {
    const url = els.onlineUrl.value;
    if (navigator.share) {
      try { await navigator.share({ title: 'Partie d’échecs', text: 'Rejoins-moi pour une partie !', url }); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { els.onlineUrl.select(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected !== null) clearSelection();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.closest('input, select')) { e.preventDefault(); undo(); }
  });
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
  registerServiceWorker();
}

init();
