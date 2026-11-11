const test = require('node:test'), assert = require('node:assert');
const { Chess } = require('chess.js');
const C = require('../src/classify.js'), R = require('../src/review.js');

test('expected-points ladder (Chess.com cutoffs 0 / .02 / .05 / .10 / .20)', () => {
  assert.equal(C.classify(50, 50), 'best');
  assert.equal(C.classify(50, 40), 'excellent');
  assert.equal(C.classify(50, 20), 'good');
  assert.equal(C.classify(50, -10), 'inaccuracy');
  assert.equal(C.classify(0, -100), 'mistake');
  assert.equal(C.classify(0, -600), 'blunder');
});
test('sacrifice measure', () => {
  const hang = new Chess('4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1');
  assert.equal(R.sacrificeNet(hang, 'Rd6'), 5);                       // rook lost for nothing
  assert.equal(R.sacrifice(hang, 'Rd2'), false);
  assert.equal(hang.fen(), '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1');       // board restored
  const rxb7 = new Chess('1r4k1/1bR2ppp/p3pq2/1p1r4/3P4/1Q3N2/PP3PPP/2R3K1 w - - 0 20');
  assert.equal(R.sacrificeNet(rxb7, 'Rxb7'), 2);                      // rook for bishop = exchange sacrifice
  assert.equal(R.sacrifice(new Chess(), 'e4'), false);
});
test('Brilliant: piece sacrifice + near-best + not bad afterwards -> candidate', () => {
  const g = { initialFen: '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', moves: 'Rd6', analysis: [{ eval: 300 }] };
  const [e] = R.computeBadges(g, Chess);
  assert.equal(e.brilliantCand, true);
  assert.equal(e.kind, 'best');                                       // not shown as Brilliant until verified
});
test('Brilliant verification: alternative must NOT be completely winning', () => {
  const [e] = R.computeBadges({ initialFen: '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', moves: 'Rd6', analysis: [{ eval: 300 }] }, Chess);
  const played = 'd1d6';
  assert.equal(R.refine(e, [{ moves: played, cp: 300 }, { moves: 'd1d2', cp: 100 }]), 'brilliant');   // alternative only +1.0
  assert.notEqual(R.refine(e, [{ moves: played, cp: 900 }, { moves: 'd1d2', cp: 900 }]), 'brilliant'); // would win anyway
  assert.equal(R.refine(e, null), 'brilliant');                       // no cloud data, position wasn't crushing
  const crushing = { ...e, wb: 0.97 };
  assert.notEqual(R.refine(crushing, null), 'brilliant');             // no cloud data AND already crushing -> fail closed
});
test('REGRESSION (Kasparov-Topalov, checked against Chess.com Game Review)', () => {
  const run = (fen, san, startEval, evalAfter) => R.computeBadges({ initialFen: fen, moves: san, startEval, analysis: [{ eval: evalAfter }] }, Chess)[0];
  // 29...Bb7: Chess.com = Great. The knight on f6 was ALREADY hanging before the move, so this is not a sacrifice.
  assert.equal(run('b2r3r/R4p1p/p4np1/1p1q4/kP6/P1Q2PPB/2P4P/1K6 b - - 1 29', 'Bb7', 20, 30).brilliantCand, false);
  // 30.Rxb7: Chess.com = Brilliant (rook for bishop = exchange sacrifice), even with no ratings known.
  assert.equal(run('3r3r/Rb3p1p/p4np1/1p1q4/kP6/P1Q2PPB/2P4P/1K6 w - - 2 30', 'Rxb7', 30, 20).brilliantCand, true);
  // 33.c3+: Chess.com = Brilliant (pawn sacrificed with check to drag the king out).
  assert.equal(run('3r3r/1R3p1p/Q5p1/1p6/1kq5/5PPB/2P4P/1K6 w - - 0 33', 'c3+', 380, 410).brilliantCand, true);
});
test('a quiet pawn push or non-check pawn sacrifice is not Brilliant', () => {
  const g = { initialFen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', moves: 'e5', startEval: 30, analysis: [{ eval: 30 }] };
  assert.equal(R.computeBadges(g, Chess)[0].brilliantCand, false);
});
test('Great is NOT given to ordinary best moves', () => {
  const sans = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7'.split(' ');
  const evals = [25, 30, 28, 30, 25, 30, 28, 32, 30, 28, 30, 32, 30, 28, 30, 30, 28, 30, 25, 30];
  const list = R.computeBadges({ moves: sans.join(' '), analysis: evals.map((eval_) => ({ eval: eval_ })) }, Chess);
  assert.ok(list.length > 15);
  assert.equal(list.filter((e) => e.kind === 'great' || e.kind === 'brilliant').length, 0);
  // even with cloud lines present, a small gap between best and 2nd best is not "only move"
  for (const e of list.filter((x) => x.greatCand)) {
    const s = e.color === 'w' ? 1 : -1;
    assert.equal(R.refine(e, [{ moves: e.uci, cp: 30 * s }, { moves: 'a2a3', cp: 10 * s }]), null);
  }
});
test('Great: only-move needs a big gap AND the played move to be the top line', () => {
  const g = { moves: 'e4 e5', analysis: [{ eval: 30 }, { eval: 30 }] };
  const e = R.computeBadges(g, Chess)[1];                              // black's e5
  assert.equal(e.greatCand, true);
  assert.equal(R.refine(e, [{ moves: 'e7e5', cp: 30 }, { moves: 'a7a6', cp: 700 }]), 'great');  // 2nd best collapses for Black (+7 White)
  assert.equal(R.refine(e, [{ moves: 'e7e5', cp: 30 }, { moves: 'c7c5', cp: 90 }]), null);      // small gap
  assert.equal(R.refine(e, [{ moves: 'a7a6', cp: 30 }, { moves: 'e7e5', cp: 700 }]), null);     // played move was not the top line
  assert.equal(R.refine(e, [{ moves: 'e7e5', cp: 30 }]), null);                                  // only one line known
});
test('Great: turning point (losing -> equal, equal -> winning) from stored evals, and capped', () => {
  const sans = []; for (let i = 0; i < 6; i++) sans.push('Nf3', 'Nf6', 'Ng1', 'Ng8');
  const analysis = sans.map((_, i) => ({ eval: i % 2 === 0 ? 0 : -300 }));
  const list = R.computeBadges({ moves: sans.join(' '), analysis }, Chess);
  assert.ok(list.filter((e) => e.swing).length > 4);                   // many swing candidates...
  assert.equal(list.filter((e) => e.color === 'w' && e.kind === 'great').length, 2);   // ...but capped (min 2 / 10% of moves)
  assert.equal(list.filter((e) => e.color === 'b' && e.kind === 'great').length, 2);
});
test('Lichess-flagged moves carry Lichess\'s own verdict as a board badge; book moves stay book', () => {
  assert.deepEqual(R.computeBadges({ moves: 'e4', analysis: [{ eval: -400, judgment: { name: 'Blunder' } }] }, Chess).map((x) => x.kind), ['blunder']);
  assert.deepEqual(R.computeBadges({ moves: 'e4', analysis: [{ eval: -50, judgment: { name: 'Inaccuracy' } }] }, Chess).map((x) => x.kind), ['inaccuracy']);
  const b = R.computeBadges({ moves: 'e4 e5 Qh5', opening: { ply: 2 }, analysis: [{ eval: 30 }, { eval: 30 }, { eval: 25 }] }, Chess);
  assert.deepEqual(b.map((x) => x.kind), ['book', 'book', 'best']);
});
test('Great cap keeps the STRONGEST candidates, not the first ones', () => {
  const mk = (score) => ({ color: 'w', kind: 'great', base: 'best', cap: 2, greatScore: score });
  const a = mk(0.2), b = mk(0.3);
  const weak = { color: 'w', kind: 'best', base: 'best', cap: 2, swing: true, wa: 0.55, wb: 0.4, brilliantCand: false, greatCand: false };   // score .15
  const strong = { color: 'w', kind: 'best', base: 'best', cap: 2, swing: true, wa: 0.9, wb: 0.4, brilliantCand: false, greatCand: false }; // score .5
  assert.equal(R.upgrade([a, b, weak], weak, null), false);          // weaker than both -> rejected
  assert.equal(R.upgrade([a, b, strong], strong, null), true);       // stronger -> replaces the weakest
  assert.equal(a.kind, 'best'); assert.equal(strong.kind, 'great');
});
test('free captures and plain recaptures are not "only-move" Great candidates', () => {
  // White wins a loose knight for free (Qxf6-style): trivial capture, stays Best
  const free = R.computeBadges({ initialFen: '4k3/8/5n2/8/8/8/8/Q3K3 w - - 0 1', moves: 'Qxf6', startEval: 20, analysis: [{ eval: 900 }] }, Chess)[0];
  assert.equal(free.greatCand, false);
  // Rook trade: Rxa8+ (defended, not free, not a recapture) vs Kxa8 (recapture on the same square)
  const rec = R.computeBadges({ initialFen: 'rk6/8/8/8/8/8/8/R3K3 w - - 0 1', moves: 'Rxa8+ Kxa8', startEval: 0, analysis: [{ eval: 0 }, { eval: 0 }] }, Chess);
  assert.equal(rec[0].greatCand, true);
  assert.equal(rec[1].greatCand, false);
});

test('REGRESSION (Byrne-Fischer 1956, checked against Chess.com Game Review): 11...Na4, 15...Nxc3, 17...Be6 are sacrifices', () => {
  const fs = require('fs'), g = new Chess(); g.loadPgn(fs.readFileSync(__dirname + '/../pgn/byrne-fischer-1956.pgn', 'utf8'));
  const sans = g.history(), c = new Chess(), at = {};
  for (let i = 0; i < sans.length; i++) { at[i + 1] = c.fen(); c.move(sans[i]); }
  const run = (ply, startEval, evalAfter) => R.computeBadges({ initialFen: at[ply], moves: sans[ply - 1], startEval, analysis: [{ eval: evalAfter }] }, Chess)[0];
  assert.equal(run(22, -260, -280).brilliantCand, true);   // 11...Na4   (knight left en prise to the queen)
  assert.equal(run(30, -280, -280).brilliantCand, true);   // 15...Nxc3  (allows Bxf8 / Qxc3 instead of saving the rook)
  assert.equal(run(34, -290, -280).brilliantCand, true);   // 17...Be6!! (queen left to Bxb6 - it was ALREADY attacked, but a recapture exists)
  assert.equal(run(26, -280, -280).brilliantCand, false);  // 13...Nxe4  Chess.com: only Best
  assert.equal(run(32, -300, -280).brilliantCand, false);  // 16...Rfe8+ Chess.com: no label
});

test('cloud-eval orientation: Black lines given from the side-to-move are flipped to White POV', () => {
  const e = { color: 'b', evBefore: -280 };                       // Lichess says White -2.8 (Black +2.8)
  const stm = [{ moves: 'b6a4', cp: 280 }, { moves: 'f6e4', cp: 250 }];   // same lines, side-to-move POV
  assert.deepEqual(R.orient(e, stm).map((p) => p.cp), [-280, -250]);
  const white = [{ moves: 'b6a4', cp: -280 }, { moves: 'f6e4', cp: -250 }];
  assert.deepEqual(R.orient(e, white).map((p) => p.cp), [-280, -250]);   // already White POV: unchanged
  assert.deepEqual(R.orient({ color: 'w', evBefore: 300 }, [{ moves: 'a', cp: 300 }]).map((p) => p.cp), [300]);
});
test('Brilliant verdict is the same whichever perspective the cloud lines use (Byrne-Fischer 11...Na4)', () => {
  const fs = require('fs'), g = new Chess(); g.loadPgn(fs.readFileSync(__dirname + '/../pgn/byrne-fischer-1956.pgn', 'utf8'));
  const sans = g.history(), c = new Chess(); for (let i = 0; i < 21; i++) c.move(sans[i]);
  const e = R.computeBadges({ initialFen: c.fen(), moves: sans[21], startEval: -260, analysis: [{ eval: -280 }] }, Chess)[0];
  assert.equal(e.brilliantCand, true);
  assert.equal(R.refine(e, [{ moves: 'b6a4', cp: -280 }, { moves: 'f6e4', cp: -250 }]), 'brilliant');   // White POV
  assert.equal(R.refine(e, [{ moves: 'b6a4', cp: 280 }, { moves: 'f6e4', cp: 250 }]), 'brilliant');     // side-to-move POV
  assert.equal(R.refine(e, [{ moves: 'b6a4', cp: -280 }, { moves: 'f6e4', cp: 300 }]), 'brilliant');    // the alternative is much worse for Black
  assert.notEqual(R.refine(e, [{ moves: 'f6e4', cp: -900 }, { moves: 'b6a4', cp: -280 }]), 'brilliant'); // alternative crushes anyway (+9 for Black)
});

// ---- The three Brilliant cases (see README) ----
const one = (fen, san, before, after) => R.computeBadges({ initialFen: fen, moves: san, startEval: before, analysis: [{ eval: after }] }, Chess)[0];

test('CASE 1: a piece moved onto a capturable square, position stays good -> Brilliant (after verification)', () => {
  const e = one('4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', 'Rd6', 100, 110);          // rook steps en prise to the e7 pawn
  assert.equal(e.brilliantCand, true);
  assert.equal(R.refine(e, [{ moves: 'd1d6', cp: 110 }, { moves: 'd1d2', cp: 60 }]), 'brilliant');
  // ...but not if it throws the game away
  const bad = one('4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', 'Rd6', 100, -300);
  assert.equal(bad.brilliantCand, false); assert.notEqual(bad.kind, 'brilliant');           // never a Brilliant candidate (an error badge only comes from Lichess's own flag)
});

// White knight c3 is attacked by the b4 pawn and nothing defends it. White ignores it and attacks the a8 rook with Qd5.
const HANG = 'rnb1k3/8/8/8/1p6/2N5/8/3QK3 w - - 0 1';
test('CASE 2: another piece moves while one is hanging, and the move improves the position -> Brilliant, with or without cloud data', () => {
  const e = one(HANG, 'Qd5', 0, 60);
  assert.equal(e.brilliantCand, false);                                         // the moved piece itself is safe...
  assert.equal(e.hangCand, true);                                               // ...but the c3 knight is left to bxc3
  assert.equal(R.refine(e, null), 'brilliant');                                 // no cloud data: stored evals alone show the move paid off
  assert.equal(R.refine(e, [{ moves: 'd1d5', cp: 60 }, { moves: 'c3d5', cp: 0 }]), 'brilliant');
});
test('CASE 2 guards: no improvement / piece was doomed anyway -> not Brilliant', () => {
  const flat = one(HANG, 'Qd5', 0, 0);                                          // nothing gained by ignoring the knight
  assert.equal(flat.hangCand, true);
  assert.notEqual(R.refine(flat, null), 'brilliant');
  // cloud lines say every move that saves the knight is much worse than the played move -> the played move is just best, still no gain => not a choice
  assert.notEqual(R.refine(flat, [{ moves: 'd1d5', cp: 0 }, { moves: 'c3d5', cp: -400 }]), 'brilliant');
  // saving the piece (knight steps away) leaves nothing hanging at all
  assert.equal(one(HANG, 'Nd5', 0, 0).hangCand, false);
});

test('CASE 3: sacrifice that only shows up in the engine line (quiet first move) -> Brilliant', () => {
  const fen = '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1';
  const e = one(fen, 'Ke2', 100, 105);
  assert.equal(e.brilliantCand, false);
  assert.equal(e.pvCand, true);
  const line = 'e1e2 e8f8 d1d6 e7d6 e2e3 f8g8';                                  // the engine's plan gives the rook for a pawn
  assert.equal(R.refine(e, [{ moves: line, cp: 105 }, { moves: 'd1d2', cp: 50 }]), 'brilliant');
  assert.notEqual(R.refine(e, [{ moves: 'e1e2 e8f8 e2e3 f8g8 e3e4 g8f8', cp: 105 }, { moves: 'd1d2', cp: 50 }]), 'brilliant');  // quiet line, no material given up
  assert.notEqual(R.refine(e, null), 'brilliant');                              // needs the line: never guessed
});

test('Guards: leaving check, promoting, or already crushing never give Brilliant', () => {
  assert.equal(one('b3k3/8/8/8/8/8/4r3/4K2R w - - 0 1', 'Kf1', 0, 0).brilliantCand, false);   // escapes check leaving Rh1 en prise: forced, not a sacrifice
  assert.equal(one('3rk3/P7/8/8/8/8/8/3RK3 w - - 0 1', 'a8=Q', 0, 0)?.brilliantCand ?? false, false);
  const e = one('4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', 'Rd6', 100, 110);
  assert.notEqual(R.refine(e, [{ moves: 'd1d6', cp: 110 }, { moves: 'd1d2', cp: 900 }]), 'brilliant');   // wins anyway
});

test('Inaccuracy / Mistake / Blunder are LICHESS verdicts, copied exactly; our own bands never add or change one on the real game', () => {
  const run = (analysis, moves = 'e4') => R.computeBadges({ moves, startEval: 0, opening: { ply: 0 }, analysis }, Chess).map((x) => x.kind);
  assert.deepEqual(run([{ eval: -100, judgment: { name: 'Blunder' } }]), ['blunder']);          // not relabelled by any measure of ours
  assert.deepEqual(run([{ eval: -400, judgment: { name: 'Inaccuracy' } }]), ['inaccuracy']);
  assert.deepEqual(run([{ eval: -100, judgment: { name: 'Mistake' } }]), ['mistake']);
  assert.deepEqual(run([{ eval: -100 }]), ['good']);                                                // Lichess did not flag it: never an error badge, at worst Good
});
test('Miss: only after the opponent\'s Lichess Mistake/Blunder, and only replacing an Inaccuracy/Mistake', () => {
  const run = (a2) => R.computeBadges({ moves: 'e4 e5', startEval: 0, opening: { ply: 0 }, analysis: [{ eval: -100, judgment: { name: 'Mistake' } }, a2] }, Chess)[1].kind;     // 1.e4?: White's eval -1.00 = Black is +1.00
  assert.equal(run({ eval: 0, judgment: { name: 'Inaccuracy' } }), 'miss');          // 1...e5 only inaccuracy: Black let the advantage go -> Miss
  assert.equal(run({ eval: 0, judgment: { name: 'Mistake' } }), 'miss');
  assert.equal(run({ eval: 300, judgment: { name: 'Blunder' } }), 'blunder');         // a Blunder stays a Blunder
  assert.equal(run({ eval: -100 }), 'best');                                           // no flag from Lichess: not a Miss
});
test('side lines: centipawn drop 50 / 100 / 200 (Lichess shows nothing there)', () => {
  assert.equal(C.sideLineJudgment(20, -20), null);
  assert.equal(C.sideLineJudgment(20, -35), 'inaccuracy');
  assert.equal(C.sideLineJudgment(20, -90), 'mistake');
  assert.equal(C.sideLineJudgment(20, -200), 'blunder');
  assert.equal(C.sideLineJudgment(380, 160), 'blunder');       // 220 cp: a Blunder on the real game this was fitted to
});
