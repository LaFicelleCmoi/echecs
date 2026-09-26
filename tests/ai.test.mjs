// Vérifie que l'IA joue des coups légaux et trouve les tactiques évidentes.
// Lancement : node tests/ai.test.mjs
import assert from 'node:assert/strict';
import { Chess, START_FEN as START } from '../js/engine.js';
import { bestMove, evaluate, hashPosition } from '../js/ai.js';

const noRandom = () => 0.5;

// Position initiale : évaluation symétrique.
assert.equal(evaluate(new Chess()), 0);

// Mat en un (mat du berger).
let g = new Chess();
for (const m of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6']) g.move(m);
for (const level of ['moyen', 'difficile']) {
  assert.equal(bestMove(g.fen(), level, noRandom), 'h5f7', `mat en un (${level})`);
}

// Prendre une dame offerte.
assert.equal(bestMove('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'moyen', noRandom), 'e4d5');

// Parer un mat : les noirs doivent défendre f7 (ou ne pas perdre au coup suivant).
g = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3');
const reply = bestMove(g.fen(), 'moyen', noRandom);
assert.ok(g.move(reply), 'coup légal');
assert.ok(!g.moves().some((m) => g.san(m).endsWith('#')), `la défense ${reply} évite le mat`);

// Aucun coup possible → null.
assert.equal(bestMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), null);

// Tous les niveaux jouent un coup légal depuis la position initiale.
for (const level of ['facile', 'moyen', 'difficile']) {
  const m = bestMove(new Chess().fen(), level);
  assert.ok(new Chess().move(m), `${level} : ${m}`);
}

// Hachage : une transposition donne la même clé, le trait ou le roque la changent.
const a = new Chess(); for (const m of ['g1f3', 'g8f6', 'b1c3']) a.move(m);
const b = new Chess(); for (const m of ['b1c3', 'g8f6', 'g1f3']) b.move(m);
assert.equal(hashPosition(a), hashPosition(b), 'transposition');
assert.notEqual(hashPosition(new Chess()), hashPosition(new Chess(START.replace(' w ', ' b '))), 'trait');
assert.notEqual(hashPosition(new Chess()), hashPosition(new Chess(START.replace('KQkq', 'Kkq'))), 'roque');

// Avec un gros avantage, l'IA évite de retomber dans une position déjà jouée (nulle).
const winning = '6k1/8/8/8/8/8/5Q2/6K1 w - - 0 1';
const g2 = new Chess(winning);
const history = [];
for (const m of ['f2f3', 'g8h8', 'f3f2', 'h8g8']) { history.push(g2.fen()); g2.move(m); }
const choice = bestMove(g2.fen(), 'moyen', noRandom, history);
assert.notEqual(choice, 'f2f3', 'ne rejoue pas la répétition');

console.log('✓ ia');
