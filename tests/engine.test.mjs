// Vérifie le générateur de coups sur les positions « perft » de référence
// (https://www.chessprogramming.org/Perft_Results) et quelques règles de fin de partie.
// Lancement : node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { Chess, START_FEN } from '../js/engine.js';

function perft(game, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of game.moves()) {
    game.makeMove(m, false);
    n += perft(game, depth - 1);
    game.undo();
  }
  return n;
}

const cases = [
  [START_FEN, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

for (const [fen, expected] of cases) {
  const game = new Chess(fen);
  expected.forEach((count, i) => {
    assert.equal(perft(game, i + 1), count, `perft(${i + 1}) ${fen}`);
  });
  assert.equal(game.fen(), fen, 'la position doit être restaurée après undo');
}
console.log('✓ perft');

// Mat du berger + notation SAN
let g = new Chess();
for (const m of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']) assert.ok(g.move(m), m);
assert.deepEqual(g.sanHistory(), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
assert.deepEqual(g.outcome(), { winner: 'w', reason: 'checkmate' });

// Pat
g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
assert.deepEqual(g.outcome(), { winner: null, reason: 'stalemate' });

// Triple répétition
g = new Chess();
for (let i = 0; i < 2; i++) for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) g.move(m);
assert.deepEqual(g.outcome(), { winner: null, reason: 'repetition' });

// Matériel insuffisant
assert.equal(new Chess('8/8/4k3/8/8/2B5/4K3/8 w - - 0 1').outcome().reason, 'insufficient');

// Roque, prise en passant et promotion en SAN
g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert.equal(g.move('e1g1').san, 'O-O');
assert.equal(g.move('e8c8').san, 'O-O-O');
g = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
assert.equal(g.move('e5d6').san, 'exd6');
assert.equal(g.board[27], null, 'le pion pris en passant disparaît');
g = new Chess('8/1P2k3/8/8/8/8/8/4K3 w - - 0 1');
assert.equal(g.move('b7b8n').san, 'b8=N');

console.log('✓ règles');
