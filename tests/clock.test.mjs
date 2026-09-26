// Vérifie la pendule avec une horloge simulée.
// Lancement : node tests/clock.test.mjs
import assert from 'node:assert/strict';
import { Clock, TIME_CONTROLS, formatTime } from '../js/clock.js';

let t = 0;
const flags = [];
const clock = new Clock(TIME_CONTROLS['3+2'], { now: () => t, onFlag: (c) => flags.push(c) });

assert.deepEqual(clock.snapshot(), { w: 180e3, b: 180e3 });
clock.press('w'); // les blancs jouent : +2 s, la pendule des noirs part
assert.equal(clock.time('w'), 182e3);
t += 5e3;
assert.equal(clock.time('b'), 175e3);
clock.press('b');
assert.equal(clock.time('b'), 177e3);
t += 1e3;
assert.equal(clock.time('w'), 181e3);

clock.set({ w: 50 });
t += 100;
clock.check();
assert.deepEqual(flags, ['w'], 'chute du drapeau');
assert.equal(clock.running, null);
assert.equal(clock.time('w'), 0);
clock.stop();

assert.equal(formatTime(300e3), '5:00');
assert.equal(formatTime(61e3), '1:01');
assert.equal(formatTime(59001), '1:00');
assert.equal(formatTime(9870), '9.8');
assert.equal(formatTime(3600e3), '1:00:00');

console.log('✓ pendule');
