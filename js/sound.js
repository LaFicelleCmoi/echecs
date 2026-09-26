// Sons synthétisés avec Web Audio : aucun fichier à télécharger, marche hors ligne.
let ctx = null;
let enabled = true;

export function setSoundEnabled(value) {
  enabled = value;
}

function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Claquement de pièce en bois : bruit bref filtré.
function knock(ac, { at = 0, freq = 1800, gain = 0.5, decay = 0.05 }) {
  const t = ac.currentTime + at;
  const length = Math.ceil(ac.sampleRate * decay * 2);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay * 2);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
}

function tone(ac, { at = 0, freq, duration = 0.15, type = 'sine', gain = 0.15 }) {
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const SOUNDS = {
  move: (ac) => knock(ac, { freq: 1500 }),
  capture: (ac) => { knock(ac, { freq: 1100, gain: 0.7 }); knock(ac, { at: 0.06, freq: 1700, gain: 0.35 }); },
  castle: (ac) => { knock(ac, { freq: 1500 }); knock(ac, { at: 0.11, freq: 1300 }); },
  check: (ac) => { knock(ac, { freq: 1500 }); tone(ac, { at: 0.02, freq: 988, type: 'triangle', gain: 0.12 }); },
  start: (ac) => [523, 659, 784].forEach((freq, i) => tone(ac, { at: i * 0.08, freq, gain: 0.1 })),
  win: (ac) => [523, 659, 784, 1047].forEach((freq, i) => tone(ac, { at: i * 0.11, freq, duration: 0.3, type: 'triangle' })),
  lose: (ac) => [392, 330, 262].forEach((freq, i) => tone(ac, { at: i * 0.14, freq, duration: 0.35, type: 'triangle' })),
  draw: (ac) => [440, 440].forEach((freq, i) => tone(ac, { at: i * 0.15, freq, duration: 0.2, type: 'triangle' })),
  tick: (ac) => tone(ac, { freq: 1320, duration: 0.05, type: 'square', gain: 0.05 }),
  notify: (ac) => [660, 880].forEach((freq, i) => tone(ac, { at: i * 0.1, freq, gain: 0.1 })),
};

export function playSound(name) {
  if (!enabled || !SOUNDS[name]) return;
  try { SOUNDS[name](audio()); } catch { /* audio indisponible */ }
}
