// IA d'échecs : negamax alpha-bêta + quiescence, table de transposition,
// coups killers, extension d'échec, approfondissement itératif borné dans le temps.
// Évaluation : matériel + tables de position des pièces.
import { Chess, toUci } from './engine.js';

export const LEVELS = {
  facile: { depth: 1, timeMs: 300, noise: 150 },
  moyen: { depth: 3, timeMs: 1000, noise: 25 },
  difficile: { depth: 8, timeMs: 2500, noise: 0 },
};

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const TIMEOUT = Symbol('timeout');

// Tables vues du côté blanc, rangée 8 en premier (même indexation que le moteur).
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  // Finale : le roi doit se centraliser.
  kEnd: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

// Score du point de vue du joueur au trait.
export function evaluate(game) {
  const b = game.board;
  let heavy = 0;
  for (const p of b) if (p && 'nbrqNBRQ'.includes(p)) heavy += VALUE[p.toLowerCase()];
  const kingTable = heavy <= 1600 ? PST.kEnd : PST.k;

  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p) continue;
    const type = p.toLowerCase();
    const white = p !== type;
    const table = type === 'k' ? kingTable : PST[type];
    const v = VALUE[type] + table[white ? sq : sq ^ 56];
    score += white ? v : -v;
  }
  return game.turn === 'w' ? score : -score;
}

/* ---------- Hachage de Zobrist (identifie une position en O(64)) ---------- */

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const rnd = mulberry32(0x9e3779b9);
const pair = () => [rnd(), rnd()];
const Z_PIECE = {};
for (const p of 'PNBRQKpnbrqk') Z_PIECE[p] = Array.from({ length: 64 }, pair);
const Z_TURN = pair();
const Z_CASTLE = { K: pair(), Q: pair(), k: pair(), q: pair() };
const Z_EP = Array.from({ length: 8 }, pair);

// Clé numérique sur 53 bits (32 + 21) : utilisable directement comme clé de Map.
export function hashPosition(game) {
  let a = 0, b = 0;
  const board = game.board;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p) { const z = Z_PIECE[p][sq]; a ^= z[0]; b ^= z[1]; }
  }
  if (game.turn === 'b') { a ^= Z_TURN[0]; b ^= Z_TURN[1]; }
  for (const k of 'KQkq') if (game.castling[k]) { a ^= Z_CASTLE[k][0]; b ^= Z_CASTLE[k][1]; }
  if (game.ep >= 0) { const z = Z_EP[game.ep & 7]; a ^= z[0]; b ^= z[1]; }
  return (a >>> 0) * 0x200000 + (b & 0x1fffff);
}

/* ---------- Recherche ---------- */

const EXACT = 0, LOWER = 1, UPPER = 2;
const TT_MAX = 400000;
const sameMove = (a, b) => b && a.from === b.from && a.to === b.to && a.promotion === b.promotion;

// Ordre : coup de la table de transposition, captures rentables (MVV-LVA),
// promotions, coups « killers » (ayant provoqué une coupure au même niveau).
function orderMoves(moves, ttMove, killers) {
  const score = (m) => {
    if (sameMove(m, ttMove)) return 1e6;
    let s = 0;
    if (m.captured) s += 10000 + 10 * VALUE[m.captured.toLowerCase()] - VALUE[m.piece.toLowerCase()];
    if (m.promotion) s += 9000 + VALUE[m.promotion];
    if (!s && killers) {
      if (sameMove(m, killers[0])) s = 8000;
      else if (sameMove(m, killers[1])) s = 7000;
    }
    return s;
  };
  return moves.map((m) => [score(m), m]).sort((x, y) => y[0] - x[0]).map((x) => x[1]);
}

function tick(ctx) {
  if ((++ctx.nodes & 1023) === 0 && ctx.enforce && Date.now() > ctx.deadline) throw TIMEOUT;
}

function quiesce(game, alpha, beta, ctx) {
  tick(ctx);
  const stand = evaluate(game);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const color = game.turn;
  const tactical = game._pseudoMoves(color).filter((m) => m.captured || m.promotion);
  for (const m of orderMoves(tactical)) {
    game.makeMove(m, false);
    if (game.inCheck(color)) { game.undo(); continue; }
    const s = -quiesce(game, -beta, -alpha, ctx);
    game.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

// Les scores de mat sont stockés relativement au nœud pour rester valides ailleurs.
const toTT = (s, ply) => (s > MATE - 1000 ? s + ply : s < -MATE + 1000 ? s - ply : s);
const fromTT = (s, ply) => (s > MATE - 1000 ? s - ply : s < -MATE + 1000 ? s + ply : s);

function search(game, depth, alpha, beta, ply, ctx) {
  tick(ctx);
  const key = hashPosition(game);
  // Répétition (dans la partie ou la variante) ou règle des 50 coups : nulle.
  if (game.halfmove >= 100 || ctx.seen.get(key)) return 0;

  const color = game.turn;
  const inCheck = game.inCheck(color);
  // Extension d'échec : on ne s'arrête pas au milieu d'une séquence forcée.
  if (inCheck && ply < ctx.maxPly) depth++;
  if (depth <= 0) return quiesce(game, alpha, beta, ctx);

  const alpha0 = alpha;
  const entry = ctx.tt.get(key);
  if (entry && entry.depth >= depth) {
    const s = fromTT(entry.score, ply);
    if (entry.flag === EXACT) return s;
    if (entry.flag === LOWER && s >= beta) return s;
    if (entry.flag === UPPER && s <= alpha) return s;
  }

  const killers = ctx.killers[ply] || (ctx.killers[ply] = []);
  let best = -Infinity;
  let bestMoveHere = null;
  let legal = 0;
  ctx.seen.set(key, 1);
  for (const m of orderMoves(game._pseudoMoves(color), entry?.move, killers)) {
    game.makeMove(m, false);
    if (game.inCheck(color)) { game.undo(); continue; }
    legal++;
    const s = -search(game, depth - 1, -beta, -alpha, ply + 1, ctx);
    game.undo();
    if (s > best) { best = s; bestMoveHere = m; }
    if (s > alpha) alpha = s;
    if (alpha >= beta) {
      if (!m.captured && !sameMove(m, killers[0])) { killers[1] = killers[0]; killers[0] = m; }
      break;
    }
  }
  ctx.seen.delete(key);

  // Mat le plus rapide préféré : on retire la distance au mat.
  if (!legal) return inCheck ? -MATE + ply : 0;

  if (ctx.tt.size > TT_MAX) ctx.tt.clear();
  const flag = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
  ctx.tt.set(key, { depth, score: toTT(best, ply), flag, move: bestMoveHere });
  return best;
}

// Meilleur coup (notation UCI) pour la position FEN donnée, ou null si aucun.
// `history` : FEN des positions déjà jouées, pour éviter (ou viser) la répétition.
// `maxTimeMs` : plafond de réflexion (pendule), en plus de celui du niveau.
export function bestMove(fen, level = 'moyen', { random = Math.random, history = [], maxTimeMs = Infinity } = {}) {
  const { depth, noise } = LEVELS[level] || LEVELS.moyen;
  const timeMs = Math.max(50, Math.min(LEVELS[level]?.timeMs ?? LEVELS.moyen.timeMs, maxTimeMs));
  const game = new Chess(fen);
  let root = game.moves().map((move) => ({ move, score: 0 }));
  if (!root.length) return null;

  const seen = new Map();
  for (const f of history) seen.set(hashPosition(new Chess(f)), 1);
  const ctx = {
    nodes: 0, deadline: Date.now() + timeMs, enforce: false,
    tt: new Map(), killers: [], seen, maxPly: depth * 2 + 4,
  };
  const rootKey = hashPosition(game);

  for (let d = 1; d <= depth; d++) {
    // La profondeur 1 est toujours terminée pour garantir un coup sensé.
    ctx.enforce = d > 1;
    try {
      let alpha = -Infinity;
      const scored = [];
      seen.set(rootKey, 1);
      for (const { move } of root) {
        game.makeMove(move, false);
        // Avec du bruit, il faut le score exact de chaque coup : pas de coupure.
        const s = -search(game, d - 1, -Infinity, noise ? Infinity : -alpha, 1, ctx);
        game.undo();
        scored.push({ move, score: s + (noise ? (random() - 0.5) * noise : 0) });
        if (s > alpha) alpha = s;
      }
      root = scored.sort((a, b) => b.score - a.score);
      if (root[0].score > MATE - 1000) break;
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
  }
  return toUci(root[0].move);
}
