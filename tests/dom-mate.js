// Game that ends in checkmate: Lichess gives NO eval for the mating move (n-1 entries). Brilliant must still be confirmed.
const { JSDOM } = require('jsdom'); const fs = require('fs'); const { Chess } = require('chess.js');
const bundle = process.argv[2] || 'ext/dist/content.js'; const code = fs.readFileSync(bundle, 'utf8');
const g = new Chess(); g.loadPgn(fs.readFileSync('pgn/byrne-fischer-1956.pgn', 'utf8')); const sans = g.history();
const activePly = 22;                                                        // 11...Na4
const moves = sans.map((s, i) => `<move class="${i + 1 === activePly ? 'active' : ''}"><san>${s}</san></move>`).join('');
const dom = new JSDOM(`<main class="analyse"><div class="analyse__board"><div class="cg-wrap orientation-black"><cg-board></cg-board></div></div><div class="analyse__moves"><div class="tview2">${moves}</div></div></main>`,
  { url: 'https://lichess.org/game/AbCdEfGh', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.fetch = async (u) => u.includes('cloud-eval') ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ status: 'mate', variant: 'standard', moves: sans.join(' '), opening: { ply: 8 },
  analysis: sans.slice(0, -1).map(() => ({ eval: -280 })) }) };            // n-1 entries, like real Lichess for a mate
w.eval(code);
setTimeout(() => { const b = w.document.querySelector('.cs-badge'); console.log((bundle.includes('old') ? 'OLD code' : 'NEW code'), '-> badge on 11...Na4:', b ? b.getAttribute('aria-label') : 'none'); process.exit(0); }, 1500);
