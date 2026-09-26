// IA d'échecs : negamax alpha-bêta + quiescence, approfondissement itératif
// borné dans le temps. Évaluation : matériel + tables de position des pièces.
import { Chess, toUci } from './engine.js';

export const LEVELS = {
  facile: { depth: 1, timeMs: 300, noise: 150 },
  moyen: { depth: 3, timeMs: 1000, noise: 25 },
  difficile: { depth: 5, timeMs: 2500, noise: 0 },
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

// Captures les plus rentables d'abord (MVV-LVA), puis promotions.
function orderScore(m) {
  let s = 0;
  if (m.captured) s += 10000 + 10 * VALUE[m.captured.toLowerCase()] - VALUE[m.piece.toLowerCase()];
  if (m.promotion) s += 9000 + VALUE[m.promotion];
  return s;
}

const sortMoves = (moves) => moves.sort((a, b) => orderScore(b) - orderScore(a));

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
  for (const m of sortMoves(tactical)) {
    game.makeMove(m, false);
    if (game.inCheck(color)) { game.undo(); continue; }
    const s = -quiesce(game, -beta, -alpha, ctx);
    game.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(game, depth, alpha, beta, ply, ctx) {
  tick(ctx);
  if (game.halfmove >= 100) return 0;
  if (depth <= 0) return quiesce(game, alpha, beta, ctx);

  const color = game.turn;
  let best = -Infinity;
  let legal = 0;
  for (const m of sortMoves(game._pseudoMoves(color))) {
    game.makeMove(m, false);
    if (game.inCheck(color)) { game.undo(); continue; }
    legal++;
    const s = -search(game, depth - 1, -beta, -alpha, ply + 1, ctx);
    game.undo();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  // Mat le plus rapide préféré : on retire la distance au mat.
  if (!legal) return game.inCheck(color) ? -MATE + ply : 0;
  return best;
}

// Meilleur coup (notation UCI) pour la position FEN donnée, ou null si aucun.
export function bestMove(fen, level = 'moyen', random = Math.random) {
  const { depth, timeMs, noise } = LEVELS[level] || LEVELS.moyen;
  const game = new Chess(fen);
  let root = game.moves().map((move) => ({ move, score: 0 }));
  if (!root.length) return null;

  const ctx = { nodes: 0, deadline: Date.now() + timeMs, enforce: false };
  for (let d = 1; d <= depth; d++) {
    // La profondeur 1 est toujours terminée pour garantir un coup sensé.
    ctx.enforce = d > 1;
    try {
      let alpha = -Infinity;
      const scored = [];
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
