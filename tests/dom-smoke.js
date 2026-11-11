const { JSDOM } = require('jsdom'); const fs = require('fs');
const code = fs.readFileSync('ext/dist/content.js', 'utf8');
const sans = 'd4 d5 c4 c6 Nc3 Nf6 Bg5 Nbd7 cxd5 cxd5 Qa4 e6 e4 dxe4'.split(' ');
const evals = [20,20,30,30,30,40,-30,40,30,30,10,20,-20,-20];
const moves = sans.map((s, i) => `<move class="${i === 13 ? 'active' : ''}"><san>${s}</san></move>`).join('');
const dom = new JSDOM(`<main class="analyse"><div class="analyse__board main-board"><div class="cg-wrap orientation-white"><cg-board></cg-board></div></div>
 <div class="analyse__moves"><div class="tview2">${moves}</div></div></main>`, { url: process.argv[2] || 'https://lichess.org/abcd1234/black', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; const calls = [];
w.fetch = async (u) => { calls.push(u); return { ok: true, status: 200, json: async () => ({ status: 'mate', variant: 'standard', moves: sans.join(' '), opening: { ply: 6 }, analysis: evals.map((e) => ({ eval: e })) }) }; };
w.eval(code);
setTimeout(() => {
  const b = w.document.querySelector('.cs-badge');
  console.log('fetch calls:', calls.length, calls[0] || '');
  console.log('badge:', b ? b.className + ' ' + b.getAttribute('aria-label') + ' @ ' + w.document.querySelector('.cs-sq').style.cssText : 'NONE');
  process.exit(0);
}, 800);
