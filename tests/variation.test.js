const test = require('node:test'), assert = require('node:assert');
const R = require('../src/review.js');
const { Chess } = require('chess.js');
const V = require('../src/variation.js');

const piecesOf = (fen) => {
  const out = [], rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { out.push({ file: f, rank: 7 - i, color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() }); f++; } } });
  return out;
};
const START = new Chess().fen();

test('placementFromPieces round-trips real positions and rejects broken ones', () => {
  const c = new Chess(); for (const m of 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6'.split(' ')) c.move(m);
  assert.equal(V.placementFromPieces(piecesOf(c.fen())), V.placementOf(c.fen()));
  assert.equal(V.placementFromPieces(piecesOf(START).filter((p) => !(p.type === 'k' && p.color === 'b'))), null);                                   // a king is missing
  assert.equal(V.placementFromPieces([...piecesOf(START), { file: 4, rank: 3, color: 'w', type: 'p' }, { file: 4, rank: 3, color: 'b', type: 'p' }]), null);   // two pieces on one square
});

test('findMove: identifies the one move played, from the last shown position or from any known one', () => {
  const c = new Chess(); c.move('e4'); const afterE4 = c.fen();
  const known = new Map([[V.placementOf(START), { fen: START }], [V.placementOf(afterE4), { fen: afterE4 }]]);
  const d = new Chess(afterE4); d.move('c5'); const target = V.placementOf(d.fen());
  const r = V.findMove(known, target, Chess, afterE4);
  assert.deepEqual([r.san, r.uci, r.to, r.parentFen], ['c5', 'c7c5', 'c5', afterE4]);
  const e = new Chess(START); e.move('d4');
  assert.equal(V.findMove(known, V.placementOf(e.fen()), Chess, afterE4).san, 'd4');                    // hint was wrong, still found
  assert.equal(V.findMove(known, '8/8/8/8/8/8/8/K6k', Chess, afterE4), null);                          // not one move away
  // castling and en passant keep the right rights because the parent FEN is a full chess.js FEN
  const k2 = new Map(); const f = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'; k2.set(V.placementOf(f), { fen: f });
  const castled = new Chess(f); castled.move('O-O');
  assert.equal(V.findMove(k2, V.placementOf(castled.fen()), Chess, f).san, 'O-O');
});

test('cloud-eval sign: calibrated once, then every line is converted to White POV', () => {
  assert.equal(V.detectPov([{ moves: 'e7e5', cp: 28 }]), 'white');
  assert.equal(V.detectPov([{ moves: 'e7e5', cp: -28 }]), 'stm');
  assert.equal(V.detectPov([{ moves: 'x', mate: 3 }]), null);
  assert.equal(V.detectPov(null), null);
  const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  assert.deepEqual(V.toWhitePov([{ moves: 'a', cp: 50 }, { moves: 'b', mate: 2 }], blackToMove, 'stm'), [{ moves: 'a', cp: -50 }, { moves: 'b', mate: -2 }]);
  assert.deepEqual(V.toWhitePov([{ moves: 'a', cp: 50 }], blackToMove, 'white'), [{ moves: 'a', cp: 50 }]);
  assert.deepEqual(V.toWhitePov([{ moves: 'a', cp: 50 }], START, 'stm'), [{ moves: 'a', cp: 50 }]);
});

test('classifyMove: the full ladder for a side-line move, including the negative badges', () => {
  const k = (san, evB, evA, pvsB) => V.classifyMove({ parentFen: START, san, evB, evA, pvsB }, Chess)?.kind;
  assert.equal(k('e4', 20, 20, null), 'best');
  assert.equal(k('e4', 20, 10, null), 'excellent');
  assert.equal(k('e4', 20, -5, null), 'good');
  assert.equal(k('e4', 20, -40, null), 'inaccuracy');
  assert.equal(k('e4', 20, -100, null), 'mistake');
  assert.equal(k('e4', 20, -500, null), 'blunder');
  assert.equal(k('e4', 600, 0, null), 'blunder');                                        // 600 cp thrown away (Miss only exists on the real game, after an opponent's flagged error)
  assert.equal(k('e4', 20, -10, [{ moves: 'e2e4', cp: 20 }, { moves: 'd2d4', cp: 15 }]), 'best');   // engine's first choice
  assert.equal(V.classifyMove({ parentFen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1', san: 'Kd1', evB: 0, evA: 0 }, Chess).kind, 'best');
});

test('classifyMove: unknown evals give no badge; a forced move is Best', () => {
  assert.equal(V.classifyMove({ parentFen: START, san: 'e4', evB: null, evA: 10 }, Chess), null);
  assert.equal(V.classifyMove({ parentFen: START, san: 'e4', evB: 10, evA: null }, Chess), null);
  const forced = '3rk3/8/8/8/8/8/4q3/3RK3 w - - 0 1';
  assert.equal(V.classifyMove({ parentFen: forced, san: 'Kxe2', evB: 0, evA: 0 }, Chess).kind, 'best');   // the only legal move is trivially the best move
});

test('classifyMove: Brilliant and Great work in a side line (with cloud lines)', () => {
  const rook = '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1';
  const b = V.classifyMove({ parentFen: rook, san: 'Rd6', evB: 100, evA: 110, pvsB: [{ moves: 'd1d6', cp: 110 }, { moves: 'd1d2', cp: 60 }] }, Chess);
  assert.equal(b.kind, 'brilliant'); assert.equal(b.to, 'd6');
  assert.equal(V.classifyMove({ parentFen: rook, san: 'Rd6', evB: 100, evA: 110, pvsB: null }, Chess).kind, 'brilliant');   // case 1 needs no cloud lines
  assert.equal(V.classifyMove({ parentFen: rook, san: 'Rd6', evB: 100, evA: 110, pvsB: [{ moves: 'd1d6', cp: 110 }, { moves: 'd1d2', cp: 900 }] }, Chess).kind, 'best');   // would have won anyway
  const g = V.classifyMove({ parentFen: START, san: 'e4', evB: 30, evA: 30, pvsB: [{ moves: 'e2e4', cp: 30 }, { moves: 'd2d4', cp: -700 }] }, Chess);
  assert.equal(g.kind, 'great');                                                         // only move: 2nd best collapses
  // turning point from stored evals: losing -> equal is Great even for the first move of a side line
  const t = V.classifyMove({ parentFen: START, san: 'e4', evB: -300, evA: -20, pvsB: null }, Chess);
  assert.equal(t.kind, 'great');
});

test('findPath: a position up to 3 moves ahead is resolved; final move and its parent are right', () => {
  const two = new Chess(); for (const m of ['f3', 'e5']) two.move(m);
  const three = new Chess(two.fen()); three.move('g4');
  const path = V.findPath(START, V.placementOf(three.fen()), Chess);
  assert.equal(path.length, 3);
  assert.equal(V.placementOf(path[2].parentFen), V.placementOf(two.fen()));                  // parent of the final move = position after 2 moves
  assert.equal(path[2].san, 'g4'); assert.equal(path[0].parentFen, START);
  assert.equal(V.findPath(START, '8/8/8/8/8/8/8/K6k', Chess), null);                         // unreachable
  assert.equal(V.findPath(START, V.placementOf(START), Chess), null);                         // same position is not "ahead"
  const four = new Chess(three.fen()); four.move('Qh4#');
  assert.equal(V.findPath(START, V.placementOf(four.fen()), Chess), null);                    // 4 moves is beyond the search limit by design
});

test('findPathAny: jumps into another branch from any known position', () => {
  const known = new Map(), c = new Chess(); known.set(V.placementOf(c.fen()), { fen: c.fen() });
  for (const m of ['e4', 'e5']) { c.move(m); known.set(V.placementOf(c.fen()), { fen: c.fen() }); }
  const lastShown = new Chess(); for (const m of ['f3', 'e5', 'g4', 'Qh4#']) lastShown.move(m);        // far away branch
  const t = new Chess(c.fen()); for (const m of ['Qh5', 'Nc6']) t.move(m);
  const path = V.findPathAny(known, lastShown.fen(), V.placementOf(t.fen()), Chess);
  assert.deepEqual(path.map((s) => s.san), ['Qh5', 'Nc6']);
  assert.equal(V.findPathAny(known, lastShown.fen(), '8/8/8/8/8/8/8/K6k', Chess), null);
});

// ---- "Best" means the engine's first choice (Chess.com: expected-points loss exactly 0); +0.17 next to +0.20 is Excellent, not Best ----
const L = (moves, cp) => ({ moves, cp });
test('REGRESSION: +0.17 played while +0.20 was available is Excellent, the +0.20 move is Best', () => {
  const pvsB = [L('e2e4', 20), L('d2d4', 17), L('g1f3', 12)];
  const k = (san) => V.classifyMove({ parentFen: START, san, pvsB, pvsA: null }, Chess).kind;
  assert.equal(k('e4'), 'best');
  assert.equal(k('d4'), 'excellent');                 // 3 centipawns worse: both used to be "Best"
  assert.equal(k('Nf3'), 'excellent');
  assert.equal(V.isTopMove(pvsB, 'e2e4'), true);
  assert.equal(V.isTopMove(pvsB, 'd2d4'), false);
  assert.equal(V.isTopMove([L('e2e4', 20), L('d2d4', 20)], 'd2d4'), false);         // a tie does NOT make a second Best: only ONE best move per position
  assert.equal(V.classifyMove({ parentFen: START, san: 'd4', pvsB: [L('e2e4', 20), L('d2d4', 20)] }, Chess).kind, 'excellent');
  assert.equal(V.isTopMove(null, 'e2e4'), null);                                    // no engine lines: unknown, not "false"
});
test('classifyMove measures the move inside ONE search (no cross-search noise) and falls back to the after-position search', () => {
  // played move is inside the lines: loss = best line vs its own line, evA argument ignored
  assert.equal(V.classifyMove({ parentFen: START, san: 'd4', evB: 20, evA: -500, pvsB: [L('e2e4', 20), L('d2d4', 17)] }, Chess).kind, 'excellent');
  // played move outside the top lines: use the search of the position AFTER it (3 lines, White POV)
  assert.equal(V.classifyMove({ parentFen: START, san: 'a3', pvsB: [L('e2e4', 30), L('d2d4', 25), L('g1f3', 20)], pvsA: [L('e7e5', -30)] }, Chess).kind, 'inaccuracy');
  assert.equal(V.classifyMove({ parentFen: START, san: 'f3', pvsB: [L('e2e4', 30), L('d2d4', 25), L('g1f3', 20)], pvsA: [L('e7e5', -400)] }, Chess).kind, 'blunder');
  // no engine at all: stored evals, but a stored-eval "best" can no longer be told from "excellent", so it stays as before
  assert.equal(V.classifyMove({ parentFen: START, san: 'e4', evB: 20, evA: 20 }, Chess).kind, 'best');
});
test('verifyBest: mainline "best" from stored evals needs the engine\'s first choice', () => {
  const e = (uci) => ({ kind: 'best', uci, color: 'w' });
  const pvs = [L('e2e4', 20), L('d2d4', 17), L('g1f3', 16), ];
  assert.equal(V.verifyBest(e('e2e4'), pvs), 'best');
  assert.equal(V.verifyBest(e('d2d4'), pvs), 'excellent');
  assert.equal(V.verifyBest(e('a2a3'), pvs), 'excellent');                          // outside the top 3
  assert.equal(V.verifyBest(e('d2d4'), [L('e2e4', 50), L('d2d4', 20)]), 'good');    // 4.5% worse in the same search
  assert.equal(V.verifyBest(e('d2d4'), null), 'best');                              // engine unavailable: leave as is
  assert.equal(V.verifyBest({ kind: 'best', uci: 'd7d5', color: 'b' }, [L('e7e5', -20), L('d7d5', -17)]), 'excellent');   // Black: eval is White POV, e5 (-0.20) is Black's best
});

test('needsDeeper: only close calls get the deeper search', () => {
  assert.equal(V.needsDeeper([L('d1c2', 30), L('g1f3', 20), L('f1e2', 20)], 'g1f3'), true);      // the 5.Qc2 / 5.Nf3 / 5.Be2 situation: a hundredth of a pawn apart
  assert.equal(V.needsDeeper([L('e2e4', 120), L('d2d4', 10)], 'd2d4'), false);                    // clear best move
  assert.equal(V.needsDeeper([L('e2e4', 120), L('d2d4', 10), L('c2c4', 5)], 'c2c4'), false);
  assert.equal(V.needsDeeper([L('e2e4', 30)], 'e2e4'), false);                                    // one line: nothing to compare
  assert.equal(V.needsDeeper([L('e2e4', 100), L('d2d4', 30), L('g1f3', 98)], 'g1f3'), true);      // played move close to the top although the 2nd line is far
  assert.equal(V.needsDeeper(null, 'e2e4'), false);
});

test('REGRESSION (user screenshot): cloud castling "e8h8" is rewritten to e8g8, and a line cut off mid-exchange is NOT a sacrifice', () => {
  const afterBc4 = new Chess(); ['e4', 'c5', 'Nf3', 'Nc6', 'Bc4'].forEach((m) => afterBc4.move(m));
  const fixed = V.fixCastling([{ moves: 'e7e6 e1g1 g8f6 d2d3 f8e7 c1g5 e8h8 b1c3', cp: 0 }, { moves: 'g8f6 b1c3', cp: 5 }], afterBc4.fen(), Chess);
  assert.equal(fixed[0].moves.split(' ')[0], 'e7e6');
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
  assert.equal(V.fixCastling([{ moves: 'e8h8 e1a1', cp: 0 }], castle.fen(), Chess)[0].moves, 'e8g8 e1c1');
  assert.equal(V.fixCastling([{ moves: 'a8a7', cp: 0 }], castle.fen(), Chess)[0].moves, 'a8a7');         // a plain rook move is untouched
  // the exact line from the report: 3...e6 4.Nc3 Nf6 5.d4 Nxe4 6.Nxe4 d5 7.dxc5 - cut off before ...dxe4
  const fen = afterBc4.fen();
  const e = { mk: (f) => new Chess(f), fen, color: 'b', mat0: 0 };
  assert.equal(R.pvMaterialDrop(e, { moves: 'e7e6 b1c3 g8f6 d2d4 f6e4 c3e4 d7d5 d4c5' }), 0);
});

test('badgeSquareOk: a badge only draws on a square Lichess highlights as the last move', () => {
  assert.equal(V.badgeSquareOk({ san: 'Bd6', to: 'd6' }, ['g3', 'd6']), true);
  assert.equal(V.badgeSquareOk({ san: 'g5', to: 'g5' }, ['g3', 'd6']), false);        // the reported bug: star on the g5 pawn after the bishop moved
  assert.equal(V.badgeSquareOk({ san: 'O-O', to: 'g1' }, ['e1', 'h1']), true);         // castling highlighted king-takes-rook
  assert.equal(V.badgeSquareOk({ san: 'Nf3', to: 'f3' }, ['e1', 'h1']), false);
  assert.equal(V.badgeSquareOk({ san: 'e4', to: 'e4' }, null), true);                  // nothing highlighted / unreadable: no objection
});
