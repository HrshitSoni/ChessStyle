// Pure classification math. cp values are from the MOVER's perspective.
const CFG = { bestTol: 0.01, excellent: 0.02, good: 0.05, inaccuracy: 0.10, mistake: 0.20, k: 0.0061 };
const winP = (cp) => 1 / (1 + Math.exp(-CFG.k * Math.max(-10000, Math.min(10000, cp))));
function classify(cpBefore, cpAfter, f = {}) {
  if (f.inBook) return 'book';
  if (f.isForced) return 'forced';
  const loss = Math.max(0, winP(cpBefore) - winP(cpAfter));
  if (loss <= CFG.bestTol || f.isBestMove) {
    if (f.sacrifice && winP(cpAfter) >= 0.4) return 'brilliant';
    if (f.isOnlyGoodMove && winP(cpBefore) - (f.secondBestWinP ?? 0) >= 0.15) return 'great';
    return 'best';
  }
  if (loss <= CFG.excellent) return 'excellent';
  if (loss <= CFG.good) return 'good';
  if (winP(cpBefore) >= 0.75 && winP(cpAfter) < 0.65 && loss > CFG.inaccuracy) return 'miss';
  if (loss <= CFG.inaccuracy) return 'inaccuracy';
  if (loss <= CFG.mistake) return 'mistake';
  return 'blunder';
}
// Lichess marks nothing inside side lines, so there its verdict has to be imitated. The open-source rule it started from is a centipawn drop of 50 / 100 / 300; the verdicts seen on a real
// game (Inaccuracy 60-90 cp, Mistake ~200, Blunder from ~220) put the Blunder line nearer 200, so 50 / 100 / 200 is used. NOT an official number: it only ever applies to side lines.
const cp = (x) => Math.max(-1000, Math.min(1000, x));
function sideLineJudgment(before, after) {     // mover's point of view
  const drop = cp(before) - cp(after);
  return drop >= 200 ? 'blunder' : drop >= 100 ? 'mistake' : drop >= 50 ? 'inaccuracy' : null;
}
module.exports = { CFG, winP, classify, sideLineJudgment };
