// Turns Lichess's own server analysis into extra badges, following Chess.com's published definitions
// (support.chess.com "How are moves classified?"). Exact Chess.com thresholds are NOT public: constants below are approximations.
const C = require('./classify.js');
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const K = {
  nearBest: 0.02,      // Brilliant/Great must lose <= 2% win chance (Chess.com "Excellent" boundary)
  minAfter: 0.4,       // Brilliant: not a bad position afterwards
  altWin: 0.85,        // Brilliant: best ALTERNATIVE must not be "completely winning" (~ +5.0)
  fallbackBefore: 0.9, // Brilliant without cloud data: require the position wasn't already crushing
  losing: 0.30, winning: 0.70, swingMin: 0.10, // Great "turning point" thresholds
  gap: 0.15, gapLenient: 0.12,                 // Great "only move": best line beats 2nd line by this much win chance
  hangGap: 0.10,       // Brilliant (piece already hanging, cloud lines known): it was a choice, not a forced loss, if some move that SAVES the piece is within this much win chance of the played move
  hangGain: 0.05,      // Brilliant (piece already hanging, from stored evals alone): the played move must itself raise the win chance by this much, so ignoring the hanging piece paid off
  pvMin: 4, pvMax: 8,  // Brilliant (deferred sacrifice): look 4-8 plies into the cloud line of the played move
  sacMin: 2,                                   // Brilliant: net material given up (>=2 = exchange/piece sacrifice; a 1-pawn sacrifice counts only with check)
  lenientRating: 1500,
  greatFrac: 0.10,     // Great is rare by design: at most 10% of a player's moves (min 2)
};
const mat = (ch, c) => ch.board().flat().reduce((s, q) => (q && q.color === c ? s + VAL[q.type] : s), 0);
const matDiff = (ch, me) => mat(ch, me) - mat(ch, me === 'w' ? 'b' : 'w');
// `me` just moved (or passed); the opponent is to move. Worst material result for `me` after the opponent's best capture and our recapture on the SAME square.
// (Chess.com-style local measure: verified against Chess.com on Byrne-Fischer and Kasparov-Topalov; a full capture search over-recaptures and erases real sacrifices.)
function worstAfterOppCaptures(ch, me) {
  let worst = matDiff(ch, me);
  for (const r of ch.moves({ verbose: true }).filter((x) => x.captured)) {
    ch.move(r.san);
    let d = matDiff(ch, me);
    for (const x of ch.moves({ verbose: true }).filter((y) => y.captured && y.to === r.to)) { ch.move(x.san); d = Math.max(d, matDiff(ch, me)); ch.undo(); }
    worst = Math.min(worst, d);
    ch.undo();
  }
  return worst;
}
// Biggest piece the mover would ALREADY be losing for free if they simply passed (a capture nobody can answer by recapturing).
// Such a piece was not "sacrificed" by the move - it was just left hanging. Pieces that can be traded back DO still count.
function baselineFreeLoss(chess) {
  if (chess.isCheck()) return 0;
  const me = chess.turn(), p = chess.fen().split(' ');
  p[1] = me === 'w' ? 'b' : 'w'; p[3] = '-';
  let t; try { t = new chess.constructor(p.join(' ')); } catch (_) { return 0; }
  let free = 0;
  for (const r of t.moves({ verbose: true }).filter((x) => x.captured)) {
    t.move(r.san);
    if (!t.moves({ verbose: true }).some((y) => y.captured && y.to === r.to)) free = Math.max(free, VAL[r.captured]);
    t.undo();
  }
  return free;
}
// Material (in pawns) the MOVE gives up after exchanges. gross = everything at risk; base = a piece that was ALREADY hanging for free before the move
// (not a sacrifice by itself); net = gross - base.
function sacrificeParts(chess, san) {
  const me = chess.turn(), m0 = matDiff(chess, me), base = baselineFreeLoss(chess);
  chess.move(san);
  const worst = worstAfterOppCaptures(chess, me);
  chess.undo();
  return { gross: m0 - worst, base, net: (m0 - worst) - base };
}
const sacrificeNet = (chess, san) => sacrificeParts(chess, san).net;
const sacrifice = (chess, san, min = 2) => sacrificeNet(chess, san) >= min;
const ev = (a) => !a ? null : a.mate !== undefined ? (a.mate === 0 ? null : a.mate > 0 ? 10000 : -10000) : (a.eval ?? null);
const NEG = new Set(['inaccuracy', 'mistake', 'miss', 'blunder', 'forced']);
const state = (w) => w < K.losing ? 'losing' : w < K.winning ? 'equal' : 'winning';
// Great is rare: at most `cap` per player. When full, a stronger candidate (bigger swing / bigger gap) replaces the weakest one.
function placeGreat(list, e, score) {
  e.greatScore = score;
  const gs = list.filter((x) => x !== e && x.color === e.color && x.kind === 'great').sort((a, b) => a.greatScore - b.greatScore);
  if (gs.length < e.cap) { e.kind = 'great'; return true; }
  if (score > gs[0].greatScore) { gs[0].kind = gs[0].base; e.kind = 'great'; return true; }
  return false;
}
function greatScore(e, pvs) {
  pvs = orient(e, pvs);
  const s = e.color === 'w' ? 1 : -1;
  const w = (p) => C.winP(s * (p.mate !== undefined ? (p.mate > 0 ? 10000 : -10000) : p.cp));
  const gap = pvs && pvs.length >= 2 ? w(pvs[0]) - w(pvs[1]) : 0;
  return Math.max(e.swing ? e.wa - e.wb : 0, gap);
}

function computeBadges(game, Chess) {
  const out = [];
  if (!game.analysis || !game.moves) return out;
  const sans = game.moves.split(' ');
  const total = { w: Math.ceil(sans.length / 2), b: Math.floor(sans.length / 2) };
  const chess = new Chess(game.initialFen || undefined);
  const bookPly = game.opening?.ply || 0;
  let prevTo = game.prevTo || null;   // game.variation: a single move played in a side line (see variation.js); prevTo = square of the move before it
  for (let i = 0; i < sans.length; i++) {
    const color = chess.turn(), s = color === 'w' ? 1 : -1;
    const legal = chess.moves().length, fen = chess.fen();
    const a = game.analysis[i];
    const before = i === 0 ? (game.startEval ?? 0) : ev(game.analysis[i - 1]), after = ev(a);
    const flagged = a?.judgment && /inaccuracy|mistake|blunder/i.test(a.judgment.name || '');
    const known = !flagged && after !== null && before !== null;
    const wb = known ? C.winP(s * before) : 0, wa = known ? C.winP(s * after) : 0, loss = Math.max(0, wb - wa);
    const rating = game.players?.[color === 'w' ? 'white' : 'black']?.rating;
    const lenient = rating != null && rating < K.lenientRating;
    const isBook = i < bookPly;
    // Chess.com never awards Brilliant to a move that escapes check (forced) or to a promotion.
    const sacOk = known && !isBook && legal > 1 && loss <= K.nearBest && wa >= K.minAfter && !chess.isCheck() && !/=/.test(sans[i]);
    const parts = sacOk ? sacrificeParts(chess, sans[i]) : { gross: 0, base: 0, net: 0 }, net = parts.net, mat0 = matDiff(chess, color);
    const mv = chess.move(sans[i]);
    if (!mv) break;
    const trivialCapture = !!mv.captured && (mv.to === prevTo || !chess.moves({ verbose: true }).some((m) => m.captured && m.to === mv.to)); // recapture, or wins a piece nobody can retake
    prevTo = mv.to;
    // Lichess's own Inaccuracy / Mistake / Blunder: put the same badge on the board, so no move is left unmarked.
    if (flagged && legal > 1 && !game.variation) {
      // Lichess has already judged this move (it sees data the stored evals do not show), so ITS verdict is the badge: the board never contradicts the move list.
      let jk = String(a.judgment.name).toLowerCase(); const lost = null;
      // Miss (Lichess has none; Chess.com: "fail to capitalize on your opponent's mistake"): the opponent's previous move was a Lichess Mistake/Blunder, the mover is at least equal,
      // and this move is only an Inaccuracy/Mistake. A Blunder stays a Blunder.
      const prevJ = i > 0 && game.analysis[i - 1] && game.analysis[i - 1].judgment ? String(game.analysis[i - 1].judgment.name).toLowerCase() : '';
      if ((jk === 'inaccuracy' || jk === 'mistake') && /^(mistake|blunder)$/.test(prevJ) && before !== null && s * before >= 0) jk = 'miss';
      out.push({ ply: i + 1, san: sans[i], evAfter: after, evBefore: before, to: mv.to, uci: mv.from + mv.to + (mv.promotion || ''), kind: jk, base: jk, loss: lost, color, fen, legal, wb: 0, wa: 0, net: 0 });
      continue;
    }
    // The checkmating move has no stored eval (Lichess gives none): it is by definition the best move.
    if (!known && !flagged && !isBook && /#/.test(mv.san) && legal > 1) { out.push({ ply: i + 1, san: sans[i], evAfter: after, evBefore: before, to: mv.to, uci: mv.from + mv.to + (mv.promotion || ''), kind: 'best', base: 'best', color, fen, legal, wb: 0, wa: 0, net: 0 }); continue; }
    // The only legal move: nothing to judge, it is trivially the best move (Chess.com's handling of a "forced" label is not documented, so no separate label is invented).
    if (legal === 1 && !isBook) { out.push({ ply: i + 1, san: sans[i], evAfter: after, evBefore: before, to: mv.to, uci: mv.from + mv.to + (mv.promotion || ''), kind: 'best', base: 'best', forced: true, color, fen, legal, wb: 0, wa: 0, net: 0 }); continue; }
    if (!known) continue;
    let kind;
    if (isBook) kind = 'book';
    else {
      kind = C.classify(s * before, s * after, {});
      // Real game: Lichess did NOT flag this move, so it is never shown as an error (a stricter label would contradict its own move list): at worst Good.
      // Side line: Lichess says nothing there, so the side-line rule applies (classify.js).
      if (game.variation) kind = C.sideLineJudgment(s * before, s * after) || (NEG.has(kind) ? 'good' : kind);
      else if (NEG.has(kind)) kind = 'good';
    }
    const e = {
      ply: i + 1, san: sans[i], evAfter: after, loss, evBefore: i === 0 ? (game.startEval ?? 0) : before, net, to: mv.to, uci: mv.from + mv.to + (mv.promotion || ''), kind, color, fen, legal, wb, wa,
      brilliantCand: sacOk && (net >= K.sacMin || (net >= 1 && /[+#]/.test(mv.san))),
      // Brilliant case 2: a piece was ALREADY hanging and the player moved something else. Only counts when the piece could have been saved at little cost (checked with cloud lines in refine()).
      hangCand: sacOk && parts.base > 0 && net < K.sacMin && parts.gross >= K.sacMin,
      gain: wa - wb,
      // Brilliant case 3: deferred / positional sacrifice - nothing capturable right now, but the engine's own line gives material up (checked with cloud lines in refine()).
      pvCand: sacOk && parts.gross < 1 && !trivialCapture && wb >= 0.15 && wb <= 0.92,
      mat0, mk: (f) => new Chess(f), base: kind,
      // Great (case 1): turning point judged from Lichess's stored evals (needs a previous eval, so not ply 1)
      swing: !isBook && (i > 0 || game.variation) && loss === 0 && wa - wb >= K.swingMin &&
        ((state(wb) === 'losing' && state(wa) !== 'losing') || (state(wb) === 'equal' && state(wa) === 'winning')),
      // Great (case 2): "only move" - decided later with cloud-eval alternatives
      greatCand: !isBook && kind === 'best' && wb >= 0.08 && wb <= 0.92 && !trivialCapture,
      gapMin: lenient ? K.gapLenient : K.gap,
      cap: Math.max(2, Math.ceil(K.greatFrac * total[color])),
    };
    out.push(e);
    if (e.swing) placeGreat(out, e, e.wa - e.wb);
  }
  return out;
}
// Cloud-eval lines should be White's point of view; if Black's lines look like they are from the side to move, flip them.
function orient(e, pvs) {
  if (pvs && pvs.whitePov) return pvs;           // engine lines are already White's point of view
  if (!pvs || !pvs.length || e.color === 'w' || e.evBefore == null) return pvs;
  const raw = pvs[0].mate !== undefined ? (pvs[0].mate > 0 ? 10000 : -10000) : pvs[0].cp;
  if (Math.abs(-raw - e.evBefore) + 100 < Math.abs(raw - e.evBefore)) return pvs.map((p) => (p.mate !== undefined ? { moves: p.moves, mate: -p.mate } : { moves: p.moves, cp: -p.cp }));
  return pvs;
}
// Is there a capture `color` could make right now that wins material (takes an undefended piece, or a bigger one than it risks)? If so the position is mid-exchange, not settled.
function winningCaptureFor(ch, color) {
  const p = ch.fen().split(' '); p[1] = color; p[3] = '-';
  let t; try { t = new ch.constructor(p.join(' ')); } catch (_) { return false; }
  if (t.isCheck()) return false;
  for (const r of t.moves({ verbose: true }).filter((x) => x.captured)) {
    t.move(r.san);
    const back = t.moves({ verbose: true }).some((y) => y.captured && y.to === r.to);
    t.undo();
    if (VAL[r.captured] - (back ? VAL[r.piece] : 0) > 0) return true;
  }
  return false;
}
// Material the mover is down (pawns) at the end of the cloud line that starts with the played move, measured where the position is quiet
// (last non-capture, non-check ply within pvMax plies) so a line cut off in the middle of an exchange is not mistaken for a sacrifice.
function pvMaterialDrop(e, line) {
  if (!e.mk || !line || line.mate !== undefined) return 0;
  const ms = line.moves.split(' ').slice(0, K.pvMax);
  if (ms.length < K.pvMin) return 0;
  const ch = e.mk(e.fen); let settled = null;
  for (let i = 0; i < ms.length; i++) {
    let mv; try { mv = ch.move({ from: ms[i].slice(0, 2), to: ms[i].slice(2, 4), promotion: ms[i][4] }); } catch (_) { return 0; }
    // settled = a quiet ply where NEITHER side has a capture that wins material: a line cut off mid-exchange (...Nxe4 Nxe4 d5, with ...dxe4 still to come) is not a sacrifice
    if (i >= K.pvMin - 1 && !mv.captured && !mv.promotion && !/[+#]/.test(mv.san) && !winningCaptureFor(ch, 'w') && !winningCaptureFor(ch, 'b')) settled = matDiff(ch, e.color);
  }
  return settled === null ? 0 : e.mat0 - settled;
}
// Could the hanging piece have been saved by another move that is nearly as good? Then leaving it was a deliberate sacrifice, not a forced loss.
function deliberateHang(e, pvs, w, first) {
  if (!e.mk || !pvs) return false;
  const me = e.color, played = pvs.find((p) => first(p) === e.uci);
  const wp = played ? w(played) : e.wa;
  return pvs.some((p) => {
    if (first(p) === e.uci) return false;
    const ch = e.mk(e.fen), u = first(p);
    try { ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch (_) { return false; }
    const gross = matDiff(e.mk(e.fen), me) - worstAfterOppCaptures(ch, me);
    return gross < 1 && w(p) >= wp - K.hangGap;
  });
}
// Decide Brilliant/Great for one candidate. pvs = Lichess cloud-eval lines (white perspective) or null if unavailable.
function refine(e, pvs) {
  pvs = orient(e, pvs);
  const s = e.color === 'w' ? 1 : -1;
  const w = (p) => C.winP(s * (p.mate !== undefined ? (p.mate > 0 ? 10000 : -10000) : p.cp));
  const first = (p) => p.moves.split(' ')[0];
  // Brilliant needs a sacrifice: (1)+(3 immediate) measured on the board, (2) a piece left hanging on purpose, (3) a sacrifice that only shows in the engine line.
  let sac = !!e.brilliantCand, needsLines = false; e.why = sac ? `case 1: board sacrifice, net ${e.net} pawns` : '';
  if (!sac && e.hangCand) { sac = e.gain >= K.hangGain || (!!pvs && deliberateHang(e, pvs, w, first)); if (sac) e.why = 'case 2: a piece was already hanging and the move was not forced'; }
  if (!sac && e.pvCand && pvs) {
    const line = pvs.find((p) => first(p) === e.uci), drop = line ? pvMaterialDrop(e, line) : 0;
    sac = !!line && drop >= K.sacMin; needsLines = true;
    if (sac) e.why = `case 3: engine line gives up ${drop} pawns of material: ${line.moves.split(' ').slice(0, K.pvMax).join(' ')} (${pvs.src || 'cloud'} lines, depth ${pvs.depth || '?'})`;
  }
  if (sac) {
    const alt = pvs && pvs.find((p) => first(p) !== e.uci);      // best line that is NOT the played move
    if (alt ? w(alt) < K.altWin : (!needsLines && e.wb < K.fallbackBefore)) return 'brilliant';
  }
  e.why = '';
  if (e.swing) return 'great';
  if (e.greatCand && pvs && pvs.length >= 2 && first(pvs[0]) === e.uci && w(pvs[0]) - w(pvs[1]) >= e.gapMin) return 'great';
  return null;
}
function upgrade(list, e, pvs) {
  const k = refine(e, pvs);
  if (!k || e.kind === k) return false;
  if (k === 'great') return placeGreat(list, e, greatScore(e, pvs));
  e.kind = k; return true;
}
module.exports = { pvMaterialDrop, ev, orient, K, sacrifice, sacrificeNet, sacrificeParts, computeBadges, refine, upgrade };
