// Coach-style caption for a badge tooltip. Wording follows what Chess.com's review shows ("<san> is a book move +0.21", "... is the last book move",
// "... is brilliant", "... is best"); only the Best sentence is reproduced, because it is the one explanation that is true by construction here
// (Best = the engine's first choice). The other explanation sentences Chess.com shows depend on tactics we do not detect, so none is guessed.
const PHRASE = { brilliant: 'is brilliant', great: 'is a great move', best: 'is best', excellent: 'is excellent', good: 'is good', book: 'is a book move',
  inaccuracy: 'is an inaccuracy', mistake: 'is a mistake', miss: 'is a miss', blunder: 'is a blunder' };
const NEGATIVE = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const NOTE = { best: 'The best move here, no doubt about it.' };
// Evaluation after the move, White's point of view, like the review shows it. Mate scores (stored as +-10000) are left out rather than faked.
function evalText(cp) {
  if (cp == null || !isFinite(cp) || Math.abs(cp) >= 9000) return '';
  const v = Math.round(cp) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}
function caption(e, lastBook) {
  if (!e || !PHRASE[e.kind]) return '';
  const phrase = e.kind === 'book' && lastBook ? 'is the last book move' : PHRASE[e.kind];
  const ev = evalText(e.evAfter);
  const lost = NEGATIVE.has(e.kind) && e.loss != null && isFinite(e.loss) ? ` (lost ${Math.round(e.loss * 100)}% win chance)` : '';   // the measure behind the label: 5-10% inaccuracy, 10-20% mistake, over 20% blunder
  return `${e.san} ${phrase}${ev ? ' ' + ev : ''}${lost}${NOTE[e.kind] ? '. ' + NOTE[e.kind] : ''}`;
}
module.exports = { caption, evalText, PHRASE };
