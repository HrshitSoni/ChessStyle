// Badges for moves YOU play in a side line during review (Lichess has no saved analysis for those).
// Everything here is pure (no DOM, no fetch) so it can be unit-tested; content.js does the DOM reading and the cloud-eval requests.
//
// How a position is recognised without relying on Lichess's move-list markup: the board's pieces give a piece-placement string; it is matched
// against positions we already know (the real game + every position visited), then we look for the ONE legal move that leads there.
const R = require('./review.js');
const C = require('./classify.js');

const placementOf = (fen) => fen.split(' ')[0];
const uciOf = (m) => m.from + m.to + (m.promotion || '');

// pieces: [{ file 0-7 (a-h), rank 0-7 (1-8), color 'w'|'b', type 'p'|'n'|'b'|'r'|'q'|'k' }] -> FEN piece placement, or null if it is not a sane position.
function placementFromPieces(pieces) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of pieces) {
    if (p.file < 0 || p.file > 7 || p.rank < 0 || p.rank > 7 || grid[p.rank][p.file]) return null;   // off-board or two pieces on one square (mid-animation)
    grid[p.rank][p.file] = p.color === 'w' ? p.type.toUpperCase() : p.type;
  }
  const flat = grid.flat();
  if (flat.filter((x) => x === 'K').length !== 1 || flat.filter((x) => x === 'k').length !== 1) return null;
  return grid.slice().reverse().map((row) => {
    let out = '', gap = 0;
    for (const c of row) { if (c) { if (gap) out += gap; gap = 0; out += c; } else gap++; }
    return out + (gap || '');
  }).join('/');
}

// known: Map(placement -> { fen, ... }). Find a known position + one legal move that produces `placement`. `hintFen` (the position shown last) is tried first.
function findMove(known, placement, Chess, hintFen, limit = 600) {
  const tried = new Set(), order = [];
  if (hintFen) order.push(hintFen);
  const all = [...known.values()];
  for (let i = all.length - 1; i >= 0 && order.length < limit; i--) order.push(all[i].fen);
  for (const fen of order) {
    if (tried.has(fen)) continue; tried.add(fen);
    let c; try { c = new Chess(fen); } catch (_) { continue; }
    for (const m of c.moves({ verbose: true })) {
      c.move(m);
      if (placementOf(c.fen()) === placement) return { parentFen: fen, fen: c.fen(), san: m.san, uci: uciOf(m), to: m.to };
      c.undo();
    }
  }
  return null;
}

// The position may be several moves away (clicking forward in a saved line, jumping around): breadth-first search up to `maxPlies` from `startFen`.
// Returns the list of steps [{ parentFen, fen, san, uci, to }] ending at `placement`, or null. Every step is returned so intermediate positions become known too.
const expand = (placement) => placement.replace(/\d/g, (d) => ' '.repeat(+d)).replace(/\//g, '');
const diffSquares = (a, b) => { let n = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++; return n; };
function findPath(startFen, placement, Chess, maxPlies = 3, maxNodes = 60000) {
  // A move changes at most 4 squares (castling), so a position that differs from the target by more than 4 per remaining move cannot be on the way: not expanded.
  const goal = expand(placement), reach = (fen, left) => diffSquares(expand(placementOf(fen)), goal) <= 4 * left;
  if (!reach(startFen, maxPlies)) return null;
  let level = [{ fen: startFen, trail: [] }], nodes = 0;
  for (let ply = 1; ply <= maxPlies; ply++) {
    const next = [];
    for (const { fen, trail } of level) {
      let c; try { c = new Chess(fen); } catch (_) { continue; }
      for (const m of c.moves({ verbose: true })) {
        if (++nodes > maxNodes) return null;
        c.move(m);
        const f = c.fen(), step = { parentFen: fen, fen: f, san: m.san, uci: uciOf(m), to: m.to };
        if (placementOf(f) === placement) return [...trail, step];
        if (ply < maxPlies && reach(f, maxPlies - ply)) next.push({ fen: f, trail: [...trail, step] });
        c.undo();
      }
    }
    level = next;
  }
  return null;
}

// Jump anywhere: up to 3 moves from the position shown last, else up to 2 moves from any known position (most recent first), e.g. clicking into another branch.
function findPathAny(known, hintFen, placement, Chess) {
  const p = hintFen && findPath(hintFen, placement, Chess, 3, 60000);
  if (p) return p;
  const roots = [...known.values()].map((k) => k.fen).reverse().slice(0, 150);
  for (const fen of roots) { const q = findPath(fen, placement, Chess, 2, 4000); if (q) return q; }
  return null;
}

// Lichess cloud-eval centipawns are either from White's point of view or from the side to move's. Decide once from a position whose true sign is known
// (after 1.e4 with Black to move White is slightly better), then convert every response to White's point of view.
const CALIBRATION_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
function detectPov(pvs) {
  const p = pvs && pvs[0];
  if (!p || p.mate !== undefined || typeof p.cp !== 'number' || Math.abs(p.cp) < 3) return null;
  return p.cp > 0 ? 'white' : 'stm';
}
function toWhitePov(pvs, fen, pov) {
  if (!pvs || !pvs.length || !pov) return null;
  const flip = pov === 'stm' && fen.split(' ')[1] === 'b';
  return pvs.map((p) => (p.mate !== undefined ? { moves: p.moves, mate: flip ? -p.mate : p.mate } : { moves: p.moves, cp: flip ? -p.cp : p.cp }));
}
// Lichess cloud-eval writes castling as KING-TAKES-ROOK (e1h1, e8a8); chess.js and the UCI moves we compare with use e1g1 / e8c8. Replays each line and rewrites those moves
// (only a king standing on the square, moving onto its own rook, is castling - a rook moving e1->h1 is a normal rook move). A line that cannot be replayed is cut where it breaks.
function fixCastling(pvs, fen, Chess) {
  if (!pvs) return pvs;
  for (const p of pvs) {
    let ch; try { ch = new Chess(fen); } catch (_) { return pvs; }
    const out = [];
    for (const u of p.moves.split(' ')) {
      const from = u.slice(0, 2); let to = u.slice(2, 4);
      const a = ch.get(from), b = ch.get(to);
      if (a && a.type === 'k' && b && b.type === 'r' && b.color === a.color) to = (to[0] > from[0] ? 'g' : 'c') + to[1];
      try { ch.move({ from, to, promotion: u[4] }); } catch (_) { break; }
      out.push(from + to + (u[4] || ''));
    }
    if (out.length) p.moves = out.join(' ');
  }
  return pvs;
}
const pvEval = (p) => (!p ? null : p.mate !== undefined ? (p.mate === 0 ? null : p.mate > 0 ? 10000 : -10000) : p.cp);

const firstMove = (p) => p.moves.split(' ')[0];
// Exactly ONE move per position is Best: the engine's first line. Equal evaluations do not make a second Best (the engine's order decides); everything else is Excellent or worse.
function isTopMove(pvs, uci) {
  if (!pvs || !pvs.length) return null;                                  // unknown
  return firstMove(pvs[0]) === uci;
}
// A close call: the engine's first two lines (or the played move and the first line) are within `tol` win chance of each other. A shallow search cannot be trusted to ORDER them,
// so these positions get a deeper search before "which move is the one Best" is decided.
function needsDeeper(pvs, uci, tol = 0.03) {
  if (!pvs || pvs.length < 2) return false;
  const w = (p) => C.winP(pvEval(p));
  if (Math.abs(w(pvs[0]) - w(pvs[1])) < tol) return true;
  const mine = uci && pvs.find((p) => firstMove(p) === uci);
  return !!mine && mine !== pvs[0] && Math.abs(w(pvs[0]) - w(mine)) < tol;
}
// A mainline move that the stored Lichess evals call "best" (loss <= 1%) is only really Best if it is the engine's first choice; otherwise rank it by its own loss in the same search.
function verifyBest(e, pvs) {
  if (!pvs || !pvs.length) return e.kind;
  const top = isTopMove(pvs, e.uci);
  if (top) return 'best';
  const mine = pvs.find((p) => firstMove(p) === e.uci), s = e.color === 'w' ? 1 : -1;
  if (!mine) return 'excellent';                                         // outside the engine's top lines, yet within 1% by the stored evals
  const d = C.winP(s * pvEval(pvs[0])) - C.winP(s * pvEval(mine));
  return d <= C.CFG.excellent ? 'excellent' : 'good';
}

// One move played from `parentFen`. pvsB = engine lines of the position BEFORE the move, pvsA = lines AFTER it (both White POV, may be null).
// evB / evA = fallback White-POV centipawns (e.g. Lichess's stored evals) used only when there are no lines. Returns { kind, to, uci, san } or null (forced / unknown).
function classifyMove({ parentFen, san, evB, evA, pvsB, pvsA, prevTo }, Chess) {
  let uci; try { const m = new Chess(parentFen).move(san); uci = uciOf(m); } catch (_) { return null; }
  // Measure the move inside ONE search where possible: best line vs the played move's own line (same depth, same engine) - no cross-search noise.
  const played = pvsB && pvsB.find((p) => firstMove(p) === uci);
  if (pvsB && pvsB.length) evB = pvEval(pvsB[0]);
  if (played) evA = pvEval(played);
  else if (pvsA && pvsA.length) evA = pvEval(pvsA[0]);
  if (evB == null || evA == null) return null;
  const [e] = R.computeBadges({ initialFen: parentFen, moves: san, startEval: evB, analysis: [{ eval: evA }], variation: true, prevTo }, Chess);
  if (!e) return null;                                          // forced (only legal move) or unreadable
  let kind = e.kind;
  const verdict = R.refine(e, pvsB);
  if (verdict) kind = verdict;                                  // brilliant / great; no per-player cap for a single side-line move
  else {
    const top = isTopMove(pvsB, e.uci);
    if (top === true) kind = 'best';
    else if (top === false && kind === 'best') kind = 'excellent';
  }
  return { kind, to: e.to, uci: e.uci, san: e.san, evAfter: evA, loss: e.loss, why: kind === 'brilliant' ? e.why : '' };
}

// A badge belongs on the square the moved piece landed on, which is one of the two squares Lichess highlights as the last move (castling: the king may be highlighted on its
// rook's square, so any highlighted square on the same rank counts). No highlight information = no objection.
function badgeSquareOk(e, last) {
  if (!e || !last || !last.length) return true;
  if (last.includes(e.to)) return true;
  return /^O-O/.test(e.san || '') && last.some((q) => q[1] === e.to[1]);
}
module.exports = { badgeSquareOk, fixCastling, placementOf, placementFromPieces, findMove, findPath, findPathAny, detectPov, toWhitePov, pvEval, isTopMove, needsDeeper, verifyBest, classifyMove, CALIBRATION_FEN };
