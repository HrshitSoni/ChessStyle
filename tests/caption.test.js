const test = require('node:test'), assert = require('node:assert');
const { caption, evalText } = require('../src/caption.js');
test('captions follow the wording Chess.com shows', () => {
  assert.equal(caption({ san: 'c4', kind: 'book', evAfter: 21 }), 'c4 is a book move +0.21');
  assert.equal(caption({ san: 'e3', kind: 'book', evAfter: 50 }, true), 'e3 is the last book move +0.50');
  assert.equal(caption({ san: 'Qxa5', kind: 'brilliant', evAfter: 373 }), 'Qxa5 is brilliant +3.73');
  assert.equal(caption({ san: 'a5', kind: 'inaccuracy', evAfter: 66 }), 'a5 is an inaccuracy +0.66');
  assert.equal(caption({ san: 'd2', kind: 'mistake', evAfter: -87 }), 'd2 is a mistake -0.87');
  assert.equal(caption({ san: 'Nf3', kind: 'best', evAfter: 20 }), 'Nf3 is best +0.20. The best move here, no doubt about it.');
  assert.equal(caption({ san: 'fxe4', kind: 'miss', evAfter: 0 }), 'fxe4 is a miss 0.00');
});
test('mate scores and missing evals are left out, never invented', () => {
  assert.equal(evalText(10000), ''); assert.equal(evalText(-10000), ''); assert.equal(evalText(null), ''); assert.equal(evalText(undefined), '');
  assert.equal(caption({ san: 'Qh7#', kind: 'great', evAfter: 10000 }), 'Qh7# is a great move');
  assert.equal(caption({ san: 'x', kind: 'nonsense' }), '');
});

test('negative badges show the measure behind the label', () => {
  assert.equal(caption({ san: 'd2', kind: 'mistake', evAfter: -87, loss: 0.173 }), 'd2 is a mistake -0.87 (lost 17% win chance)');
  assert.equal(caption({ san: 'Nf3', kind: 'good', evAfter: 10, loss: 0.03 }), 'Nf3 is good +0.10');          // only the negative labels carry it
});
