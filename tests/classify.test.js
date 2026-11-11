const test = require('node:test'), assert = require('node:assert');
const C = require('../ext/src/classify.js');
const G = require('../ext/src/gate.js');
const dom = (sel) => ({ querySelector: (s) => sel.some((x) => s.includes(x)) ? {} : null });
test('winP symmetric and monotonic', () => {
  assert.ok(Math.abs(C.winP(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(C.winP(300) + C.winP(-300) - 1) < 1e-9);
  assert.ok(C.winP(100) < C.winP(200));
});
test('best/excellent/good/inaccuracy/mistake/blunder ladder', () => {
  assert.equal(C.classify(50, 50), 'best');
  assert.equal(C.classify(50, 35), 'excellent');
  assert.equal(C.classify(50, 0), 'good');
  assert.equal(C.classify(50, -50), 'inaccuracy');
  assert.equal(C.classify(0, -200), 'mistake');
  assert.equal(C.classify(0, -600), 'blunder');
});
test('miss: dropped a winning position', () => {
  assert.equal(C.classify(500, 0), 'miss');
});
test('brilliant requires sacrifice, not just best', () => {
  assert.equal(C.classify(100, 100, { isBestMove: true }), 'best');
  assert.equal(C.classify(100, 100, { isBestMove: true, sacrifice: true }), 'brilliant');
  assert.equal(C.classify(1500, 1500, { isBestMove: true, sacrifice: true }), 'best'); // already crushing
});
test('great requires only-move gap', () => {
  assert.equal(C.classify(0, 0, { isBestMove: true, isOnlyGoodMove: true, secondBestWinP: 0.1 }), 'great');
});
test('book and forced take priority', () => {
  assert.equal(C.classify(0, -900, { inBook: true }), 'book');
  assert.equal(C.classify(0, -900, { isForced: true }), 'forced');
});
test('accuracy bounds', () => {
  assert.ok(C.moveAccuracy(0.5, 0.5) > 99);
  assert.ok(C.moveAccuracy(0.9, 0.1) < 10);
  assert.equal(C.gameAccuracy([]), null);
});
test('gate fails closed', () => {
  assert.equal(G.engineAllowed({ pathname: '/abcd1234' }, dom([])).ok, false);              // unverified
  assert.equal(G.engineAllowed({ pathname: '/abcd1234' }, dom(['.round', '.result-wrap'])).ok, true);
  assert.equal(G.engineAllowed({ pathname: '/abcd1234' }, dom(['.round', '.result-wrap', '.rclock.running'])).ok, false);
  assert.equal(G.engineAllowed({ pathname: '/abcd1234' }, dom(['.round'])).ok, false);      // active
  assert.equal(G.engineAllowed({ pathname: '/analysis' }, dom([])).ok, true);
  assert.equal(G.engineAllowed({ pathname: '/' }, dom([])).ok, false);
});
