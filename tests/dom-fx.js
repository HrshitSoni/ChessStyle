const { JSDOM } = require('jsdom'); const fs = require('fs');
const code = fs.readFileSync('ext/dist/content.js', 'utf8');
function run(game, activeIdx, flipped) {
  return new Promise((res) => {
    const mv = game.moves.split(' ').map((s, i) => `<move class="${i === activeIdx ? 'active' : ''}"><san>${s}</san></move>`).join('');
    const dom = new JSDOM(`<main class="analyse"><div class="analyse__board"><div class="cg-wrap ${flipped ? 'orientation-black' : 'orientation-white'}"><cg-board></cg-board></div></div><div class="analyse__moves"><div class="tview2">${mv}</div></div></main>`,
      { url: 'https://lichess.org/game/D3V9ebzj', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.fetch = async (u) => u.includes('cloud') ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => game };
    w.eval(code);
    setTimeout(() => res(w), 1000);
  });
}
(async () => {
  // Brilliant: Rd6 sacrifice position, ply 1 (a8..h1 orientation white) -> Rd6 lands on d6
  let w = await run({ status: 'mate', variant: 'standard', initialFen: '4k3/4p3/8/8/8/8/8/3RK3 w - - 0 1', moves: 'Rd6', analysis: [{ eval: 500 }] }, 0, false);
  const d = w.document, q = (s) => d.querySelector(s);
  console.log('brilliant badge:', !!q('.cs-badge.cs-brilliant'), '| label:', !!q('.cs-label'), '| rings:', d.querySelectorAll('.cs-ring').length, '| big:', !!q('.cs-big'),
    '| tint in cg-board:', !!q('cg-board .cs-tint-brilliant.cs-anim'), '| tint pos:', q('.cs-tint').style.cssText);
  // silent re-render (class mutation) must NOT replay the animation
  q('.cs-badge').remove(); q('.cs-sq').remove(); d.querySelector('main').classList.add('x');
  await new Promise((r) => setTimeout(r, 200));
  console.log('after silent re-render -> label replayed?', !!q('.cs-label'), '| badge still there?', !!q('.cs-badge.cs-brilliant'));
  // Book badge with SVG icon and tan tint
  w = await run({ status: 'mate', variant: 'standard', moves: 'e4 e5', opening: { ply: 2 }, analysis: [{ eval: 20 }, { eval: 20 }] }, 1, true);
  const d2 = w.document;
  console.log('book badge:', !!d2.querySelector('.cs-badge.cs-book svg'), '| tan tint:', !!d2.querySelector('cg-board .cs-tint-book'), '| no label/animation:', !d2.querySelector('.cs-label'), '| flipped e5 pos:', d2.querySelector('.cs-sq').style.cssText);
  process.exit(0);
})();
