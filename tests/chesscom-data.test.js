// Calibration evidence: Chess.com's OWN displayed evals from a reviewed game (Klekowski-Ermolaev, game 18490057, ~3000-rated, reverse-engineered dataset
// CHESSCOM-MOVE-DATA.json). Only consecutive plies where Chess.com showed an eval before AND after are used (eval shown is White's point of view;
// below converted to the MOVER's point of view, in centipawns). Everything here is one game: it pins the curve's steepness near 0, nothing more.
const test = require('node:test'), assert = require('node:assert');
const C = require('../src/classify.js');
// classify() alone says 'best' for ~0 loss; a move that is not the engine's first line is shown as Excellent (variation.js), so compare that way
const lab = (b, a) => { const k = C.classify(b, a); return k === 'best' ? 'excellent' : k; };
const PAIRS = [ // san, Chess.com label, mover eval before, after (cp)
  ['Bf5', 'excellent', -50, -51], ['a5', 'inaccuracy', -30, -66], ['h4', 'inaccuracy', 66, 10], ['Nd5', 'inaccuracy', 24, -11],
  ['Nxd5', 'inaccuracy', 11, -24], ['e4', 'excellent', 26, 25], ['Be6+', 'inaccuracy', 0, -33],
];
test('curve reproduces the Chess.com labels where Chess.com showed its own evals', () => {
  for (const [san, label, b, a] of PAIRS) assert.equal(lab(b, a), label, `${san}: ${b} -> ${a}`);
});
test('documented deviation: Qd2 (+0.78 -> -0.87) is a Mistake at Chess.com, ours says Blunder (no single logistic fits both this and the 33 cp Inaccuracy)', () => {
  assert.equal(C.classify(78, -87), 'blunder');
});
test('the old, flatter Lichess curve could NOT reproduce them (why it was replaced)', () => {
  const old = (cp) => 1 / (1 + Math.exp(-0.00368208 * cp));
  const lab = (b, a) => { const l = old(b) - old(a); return l <= 0.02 ? 'excellent' : l <= 0.05 ? 'good' : l <= 0.10 ? 'inaccuracy' : 'mistake'; };
  assert.ok(PAIRS.filter(([, label, b, a]) => lab(b, a) === label).length <= 5);
});
