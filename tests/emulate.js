// Offline stand-in for Lichess: Stockfish (local, depth D, 3 lines) -> game JSON -> same badge pipeline as the extension.
const { spawn } = require('child_process'); const fs = require('fs'); const { Chess } = require('chess.js'); const R = require('../src/review.js'); const C = require('../src/classify.js');
const file = process.argv[2], D = +(process.argv[3] || 11);
const g = new Chess(); g.loadPgn(fs.readFileSync(file, 'utf8'));
const sans = g.history(); const c = new Chess(); const fens = [c.fen()]; for (const m of sans) { c.move(m); fens.push(c.fen()); }
const sf = spawn('node', ['node_modules/stockfish/bin/stockfish-19-lite-single.js']); let buf = '', cb = null;
sf.stdout.on('data', (d) => { buf += d; if (cb && /bestmove/.test(buf)) { const o = buf; buf = ''; const f = cb; cb = null; f(o); } });
const send = (s) => sf.stdin.write(s + '\n');
const search = (fen) => new Promise((res) => { cb = res; send('setoption name MultiPV value 3'); send('position fen ' + fen); send('go depth ' + D); });
function parse(out, fen) {
  const turn = fen.split(' ')[1] === 'w' ? 1 : -1, lines = {};
  for (const l of out.split('\n')) { if (!l.startsWith('info') || !l.includes(' pv ') || !/ depth (\d+)/.test(l)) continue;
    const d = +/ depth (\d+)/.exec(l)[1]; if (d < D) continue; const n = +(/multipv (\d+)/.exec(l) || [0, 1])[1];
    const cp = /score cp (-?\d+)/.exec(l), mt = /score mate (-?\d+)/.exec(l);
    lines[n] = { moves: l.split(' pv ')[1].trim(), ...(cp ? { cp: turn * +cp[1] } : { mate: turn * +mt[1] }) }; }
  return Object.keys(lines).sort().map((k) => lines[k]);
}
(async () => {
  const pvs = [];
  for (let i = 0; i < fens.length; i++) { const t = new Chess(fens[i]); if (t.isGameOver()) { pvs.push([]); continue; } pvs.push(parse(await search(fens[i]), fens[i])); }
  const analysis = sans.map((_, i) => { const l = pvs[i + 1][0]; return l ? (l.mate !== undefined ? { mate: l.mate } : { eval: l.cp }) : { mate: 0 }; });
  // emulate Lichess's own judgments (loss >= 10% win chance)
  for (let i = 0; i < sans.length; i++) { const s = i % 2 ? -1 : 1, b = i === 0 ? 0 : pvs[i][0] && (pvs[i][0].mate !== undefined ? (pvs[i][0].mate > 0 ? 10000 : -10000) : pvs[i][0].cp);
    const a = analysis[i].mate !== undefined ? (analysis[i].mate === 0 ? null : analysis[i].mate > 0 ? 10000 : -10000) : analysis[i].eval;
    if (a !== null && b !== null && C.winP(s * b) - C.winP(s * a) >= 0.1) analysis[i].judgment = { name: 'Inaccuracy' }; }
  const game = { moves: sans.join(' '), analysis, opening: { ply: 8 }, players: { white: { rating: 2400 }, black: { rating: 2400 } } };
  const list = R.computeBadges(game, Chess);
  for (const e of list) { if (e.brilliantCand || e.greatCand || e.swing) R.upgrade(list, e, pvs[e.ply - 1]); }
  for (const ply of (process.env.SHOW || '').split(',').filter(Boolean).map(Number)) { const e = list.find((x) => x.ply === ply); const a = analysis[ply - 1], b = ply > 1 ? analysis[ply - 2] : { eval: 0 };
    console.log('  ply', ply, game.moves.split(' ')[ply - 1], '| eval before/after (white POV):', JSON.stringify(b.eval ?? b.mate), JSON.stringify(a.eval ?? a.mate), a.judgment ? '| (emulated Lichess judgment: ' + a.judgment.name + ')' : '', e ? '| brilliantCand=' + e.brilliantCand + ' kind=' + e.kind + ' wb=' + e.wb.toFixed(2) + ' wa=' + e.wa.toFixed(2) : '| no badge'); }
  const label = (e) => `${Math.ceil(e.ply / 2)}${e.color === 'w' ? '.' : '...'}${e.san}`;
  const by = (k) => list.filter((e) => e.kind === k).map(label).join('  ') || '-';
  console.log(file.split('/').pop(), `(depth ${D})`);
  console.log('  Brilliant:', by('brilliant')); console.log('  Great    :', by('great'));
  console.log('  counts   :', ['book','best','excellent','good','great','brilliant'].map((k) => k + '=' + list.filter((e) => e.kind === k).length).join(' '));
  sf.kill(); process.exit(0);
})();
