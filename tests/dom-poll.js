// Simulates: finished game, no analysis yet -> click "Request a computer analysis" -> analysis appears without reload.
const { JSDOM } = require('jsdom'); const fs = require('fs');
const code = fs.readFileSync('ext/dist/content.js', 'utf8');
const sans = 'd4 d5 c4 c6 Nc3 Nf6 Bg5 Nbd7 cxd5 cxd5 Qa4 e6 e4 dxe4'.split(' ');
const evals = [20,20,30,30,30,40,-30,40,30,30,10,20,-20,-20];
const moves = sans.map((s, i) => `<move class="${i === 13 ? 'active' : ''}"><san>${s}</san></move>`).join('');
const dom = new JSDOM(`<main class="analyse"><div class="analyse__board main-board"><div class="cg-wrap orientation-white"><cg-board></cg-board></div></div>
 <div class="analyse__moves"><div class="tview2">${moves}</div></div><button id="req"><span>Request a computer analysis</span></button><button id="tab">Computer analysis</button></main>`,
 { url: 'https://lichess.org/game/D3V9ebzj', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; w.__CS_POLL_MS = 100; let analysed = false, exportCalls = 0;
w.fetch = async (u) => { if (u.includes('cloud-eval')) return { ok: false, status: 404 }; exportCalls++;
  return { ok: true, status: 200, json: async () => ({ status: 'mate', variant: 'standard', moves: sans.join(' '), opening: { ply: 6 }, ...(analysed ? { analysis: evals.map((e) => ({ eval: e })) } : {}) }) }; };
w.eval(code);
const has = () => !!w.document.querySelector('.cs-badge');
setTimeout(() => { console.log('before click: badge?', has(), '| export calls', exportCalls);
  w.document.querySelector('#tab').click();                       // other button must NOT start polling
  setTimeout(() => { const c = exportCalls; console.log('after unrelated click: no polling ->', c === exportCalls);
    w.document.querySelector('#req span').click(); analysed = true; // click on inner span of the request button
    setTimeout(() => { console.log('after request + analysis ready: badge?', has(), '| export calls', exportCalls);
      const c2 = exportCalls; setTimeout(() => { console.log('polling stopped after completion:', c2 === exportCalls); process.exit(0); }, 400); }, 600); }, 300); }, 400);
