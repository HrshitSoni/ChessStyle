const { Chess } = require('chess.js');
const { computeBadges, upgrade, refine, ev } = require('./review.js');
const V = require('./variation.js');
const { caption } = require('./caption.js');
const VERSION = '0.10.9';
const RESERVED = new Set(['analysis', 'training', 'practice', 'streamer', 'features']);
const LABEL = { brilliant: 'Brilliant move', great: 'Great move', best: 'Best move', excellent: 'Excellent move', good: 'Good move', book: 'Book move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', miss: 'Missed chance', blunder: 'Blunder' };
const GLYPH = { brilliant: '!!', great: '!', best: '★', excellent: '👍', good: '✓', inaccuracy: '?!', mistake: '?', miss: '✕', blunder: '??', book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M3.5 6c3.1 0 5.6.5 7.4 1.7v10.8C9.1 17.3 6.6 16.8 3.5 16.8zM20.5 6c-3.1 0-5.6.5-7.4 1.7v10.8c1.8-1.2 4.3-1.7 7.4-1.7z"/></svg>' };
let shownKey = '', tint = null;
let gameId = null, badges = new Map(), lastKey = '', node = null, scheduled = false;
// ---- side lines: badges for moves YOU play during review (see variation.js) ----
let main = null, lastFen = null, curPlacement = '', inVar = false, vEntry = null, vToken = 0, vTimer = null, vRetry = 0, pov = null, cloudBlockedUntil = 0;
const cloudCache = new Map(), vResults = new Map();
const log = (...a) => console.info('[Lichess Badges]', ...a);
let lastPath = '', lastBook = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POLL_MS = window.__CS_POLL_MS || 4000;   // base re-check interval while waiting for Lichess's analysis
let pollTimer = null, pollUntil = 0, greatStarted = false, pageStart = 0, fails = 0, warmed = false, dead = false;
const retryIn = (id, ms) => { clearTimeout(pollTimer); if (!dead && gameId === id) pollTimer = setTimeout(() => refresh(id), ms); };
async function load(id) {
  gameId = id; badges = new Map(); lastKey = ''; main = null; lastFen = null; curPlacement = ''; inVar = false; vEntry = null; vToken++; vResults.clear(); greatStarted = false; pollUntil = 0; fails = 0; warmed = false; pageStart = Date.now(); clearTimeout(pollTimer);
  setStatus('game', null); setStatus('move', null);
  if (!id) return render();
  await refresh(id);
}
// Fetches Lichess's saved analysis and keeps re-checking by itself until everything is ready - no page refresh needed:
//  - request failed (network, 429, not found yet): retry with back-off
//  - game still being played: look again every 15 s, so badges appear the moment it ends (live games themselves are never analysed or touched)
//  - finished but analysis missing / incomplete (Lichess auto-analysis, or requested in another tab): every few seconds for 2 min, then every 20 s up to 15 min
async function refresh(id) {
  if (dead || gameId !== id) return;
  let g;
  try {
    const r = await fetch(`/game/export/${id}?evals=true&opening=true&moves=true&clocks=false&literate=false`, { headers: { Accept: 'application/json' } });
    log('export request', id, 'HTTP', r.status);
    if (gameId !== id) return;
    if (!r.ok) { if (r.status === 429) return retryIn(id, 60000); if (++fails <= 6) return retryIn(id, Math.min(30000, 1000 * 2 ** (fails - 1))); return; }
    g = await r.json();
  } catch (e) { console.debug('[ChessStyle]', e); if (++fails <= 6) retryIn(id, Math.min(30000, 1000 * 2 ** (fails - 1))); return; }
  fails = 0;
  if (['created', 'started'].includes(g.status)) return retryIn(id, 15000);                // live: fail closed, just wait for the end
  if (g.variant && !['standard', 'fromPosition'].includes(g.variant)) return;
  if (!warmed) { warmed = true; warmEngine(); }
  const n = g.moves ? g.moves.split(' ').length : 0;
  // Lichess gives no eval for a checkmating move (n-1 entries); allow 1 more entry of slack to be safe.
  const done = !!g.analysis && g.analysis.length >= Math.max(1, n - 2);
  log('game status:', g.status, '| analysis entries:', g.analysis ? g.analysis.length : 'none yet', 'of', n, 'moves | complete:', done,
    '| opening ply:', g.opening && g.opening.ply, '| ratings:', g.players && g.players.white && g.players.white.rating, g.players && g.players.black && g.players.black.rating);
  try {
    setMainline(g);
    const list = computeBadges(g, Chess);
    list.forEach((e) => { e.pending = e.kind === 'best' && done && !e.forced; e.wasBest = e.kind === 'best'; });                  // shown only after the engine confirms it was the first choice
    badges = new Map(list.map((e) => [e.ply, e]));
    lastBook = Math.max(0, ...list.filter((e) => e.kind === 'book').map((e) => e.ply));
    lastKey = ''; render();
    log('badges computed:', list.length, '| Brilliant candidates:', list.filter((e) => e.brilliantCand).map((e) => e.ply + ' ' + e.san).join(', ') || 'none',
      '| Hanging-piece candidates:', list.filter((e) => e.hangCand).map((e) => e.ply + ' ' + e.san).join(', ') || 'none', '| Great candidates:', list.filter((e) => e.greatCand).length);
    if (done && !greatStarted) { greatStarted = true; refinePass(list, id); }
  } catch (e) { console.debug('[ChessStyle]', e); }
  if (!done) { const waited = Date.now() - pageStart; if (waited < 15 * 60000 || Date.now() < pollUntil) retryIn(id, waited < 120000 ? POLL_MS : 20000); }
}
// the tab came back to the foreground: don't wait for the next timer
document.addEventListener('visibilitychange', () => { if (!document.hidden && !dead && gameId && !greatStarted) { clearTimeout(pollTimer); refresh(gameId); } });
// After the user clicks "Request a computer analysis", poll (every few seconds, up to 5 min) until the analysis is saved.
document.addEventListener('click', (ev) => {
  const t = ev.target.closest && ev.target.closest('button, a, .button, [role=button]');
  if (t && gameId && /request/i.test(t.textContent || '') && /analys/i.test(t.textContent || '')) {
    log('analysis requested - waiting for it to finish');
    pollUntil = Date.now() + 5 * 60000; clearTimeout(pollTimer); refresh(gameId);
  }
}, true);
// Brilliant / Great verification using Lichess cloud-eval (3 lines per position, when Lichess has it cached).
// Small progress chips on the board so a slow machine never looks frozen: 'game' = verifying the real game's moves, 'move' = judging the move you just played.
const chips = {};
function setStatus(kind, text, err) {
  const wrap = boardWrap(); let c = chips[kind];
  if (!text || !wrap) { if (c) c.remove(); chips[kind] = null; return; }
  if (!c || !c.isConnected) { c = chips[kind] = document.createElement('div'); c.className = 'cs-status cs-status-' + kind; wrap.appendChild(c); }
  c.textContent = text; c.classList.toggle('cs-status-err', !!err);
}
// Real game: every "Best" (from Lichess's stored evals) is only shown once the engine confirms it was its first choice; Brilliant/Great are verified with the same lines.
// Moves nearest the one on screen are done first; results are cached on disk so the next visit is instant.
async function refinePass(list, id) {
  const cands = list.filter((e) => e.pending || e.brilliantCand || e.hangCand || e.greatCand || e.pvCand);
  const here = currentPly();
  cands.sort((x, y) => ((y.brilliantCand || y.hangCand) - (x.brilliantCand || x.hangCand)) || (Math.abs(x.ply - here) - Math.abs(y.ply - here)));
  log('verifying', cands.length, 'moves with the engine');
  let n = 0;
  for (const e of cands) {
    if (gameId !== id) return;
    let pvs; try { pvs = await lines(e.fen, PV, 0); } catch (err) { console.debug('[ChessStyle] lines', err); pvs = null; } e.pvs = pvs;
    if (!pvs && e.kind === 'best' && !e.forced) e.unverified = true;                       // without the engine a stored-eval "best" cannot be told from "almost best": hide it, never show a wrong Best
    let verdict = null, changed = false; try { verdict = refine(e, pvs); changed = upgrade(list, e, pvs); } catch (err) { log('move', e.ply, e.san, 'could not be checked:', String(err && err.message || err)); }
    if (pvs && e.kind === 'best') { const k = V.verifyBest(e, pvs); if (k !== e.kind) { e.kind = k; e.base = k; } }
    e.pending = false; lastKey = ''; render();
    if (e.kind === 'brilliant' && e.why) log(`move ${e.ply} ${e.san} BRILLIANT because ${e.why}`);
    if (e.brilliantCand || e.hangCand || verdict) log(`move ${e.ply} ${e.san}: ${pvs ? pvs.length + ' ' + pvs.src + ' lines' : 'no engine/cloud lines'} -> ${verdict || 'stays ' + e.kind}${changed ? ' [badge updated]' : ''}`);
    setStatus('game', `Checking moves ${++n}/${cands.length}`);
  }
  list.forEach((e) => { if (e.pending) { e.pending = false; e.unverified = e.kind === 'best'; } }); lastKey = ''; render();
  // Two-pass verification (the method published for ChessGrader and listed in the Chess.com research notes): Brilliant/Great from a quick search only stand if a DEEPER search
  // (engine depth 18) agrees. Lines from Lichess's cloud-eval are already deep (30+) and are not repeated.
  const rare = list.filter((e) => (e.kind === 'brilliant' || e.kind === 'great') && e.pvs && e.pvs.src === 'engine' && (e.pvs.depth || 0) < DEEP_DEPTH).sort((x, y) => Math.abs(x.ply - here) - Math.abs(y.ply - here));
  let q = 0;
  for (const e of rare) {
    if (gameId !== id) return;
    setStatus('game', `Verifying Brilliant/Great ${++q}/${rare.length}`);
    const d = await lines(e.fen, PV, 0, DEEP_DEPTH);
    if (!d) continue;
    e.pvs = d;
    const v = refine(e, d);
    if (v === e.kind) continue;
    const was = e.kind;
    if (v) e.kind = v;                                                            // brilliant <-> great
    else { e.kind = e.base; if (e.kind === 'best') { const k = V.verifyBest(e, d); if (k !== e.kind) { e.kind = k; e.base = k; } } }   // the deeper search does not support it: back to the ordinary label
    log(`move ${e.ply} ${e.san}: deeper verification ${was} -> ${e.kind}`); lastKey = ''; render();
  }
  // close calls (best moves a hundredth of a pawn apart) were ordered by a shallow search: settle them with a deeper one, nearest to the move on screen first
  const close = list.filter((e) => e.wasBest && e.pvs && e.pvs.src === 'engine' && V.needsDeeper(e.pvs, e.uci)).sort((x, y) => Math.abs(x.ply - here) - Math.abs(y.ply - here));
  let m = 0;
  for (const e of close) {
    if (gameId !== id) return;
    setStatus('game', `Re-checking close calls ${++m}/${close.length}`);
    const d = await lines(e.fen, PV, 0, DEEP_DEPTH);
    if (!d || !['best', 'excellent', 'good'].includes(e.kind)) continue;
    const k = V.verifyBest({ ...e, kind: 'best' }, d);
    if (k !== e.kind) { log(`move ${e.ply} ${e.san}: deeper check ${e.kind} -> ${k}`); e.kind = k; e.base = k; lastKey = ''; render(); }
  }
  setStatus('game', null);
  log(`engine: ${stats.n} searches, avg ${stats.n ? Math.round(stats.ms / stats.n) : 0} ms, avg depth ${stats.n ? (stats.depth / stats.n).toFixed(1) : 0}; ${stats.cached} answered from the disk cache`);
  log('refined:', list.filter((e) => e.kind === 'brilliant' || e.kind === 'great').map((e) => e.ply + ':' + e.kind).join(' ') || 'no brilliant/great moves');
}

// ---------------- side lines ----------------
const boardWrap = () => document.querySelector('.analyse__board .cg-wrap, .analyse__board cg-wrap, main .cg-wrap');
// Every position of the real game (known without any analysis), with Lichess's stored eval where there is one (White POV).
function setMainline(g) {
  try {
    const c = new Chess(g.initialFen || undefined), known = new Map(), evals = new Map(), byPly = [V.placementOf(c.fen())], fens = [c.fen()];
    const add = (fen, info, e) => { const k = V.placementOf(fen); if (!known.has(k)) { known.set(k, { fen, main: true, ...info }); if (e != null) evals.set(k, e); } };
    add(c.fen(), {}, g.analysis ? (g.startEval ?? 0) : null);
    (g.moves ? g.moves.split(' ') : []).forEach((san, i) => {
      const m = c.move(san); if (!m) return;
      byPly.push(V.placementOf(c.fen()));
      fens.push(c.fen());
      add(c.fen(), { to: m.to, san: m.san }, g.analysis && g.analysis[i] ? ev(g.analysis[i]) : null);
    });
    main = { known, evals, byPly, fens }; log('side lines: ready,', known.size, 'positions of this game known'); lastFen = known.values().next().value.fen; curPlacement = ''; scheduleVar(0);
  } catch (e) { console.debug('[ChessStyle] mainline', e); }
}
// Reads the position from the board's pieces (chessground: <piece class="white pawn" style="transform: translate(Xpx, Ypx)">). null = not readable / still animating.
let lastWhy = '';
const why = (msg) => { if (msg !== lastWhy) { lastWhy = msg; log('side lines: cannot read the board -', msg); } return null; };
function readPlacement() {
  const wrap = boardWrap(), board = wrap && wrap.querySelector('cg-board');
  if (!wrap) return why('board container not found (looked for .analyse__board .cg-wrap / cg-wrap, main .cg-wrap)');
  if (!board) return why('no <cg-board> inside the board container');
  const size = board.getBoundingClientRect().width;
  if (!size) return why('<cg-board> has zero width');
  const sq = size / 8, flipped = wrap.classList.contains('orientation-black'), pieces = [], T = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
  for (const el of board.querySelectorAll('piece')) {
    if (/\b(ghost|fading)\b/.test(el.className)) continue;
    if (/\bdragging\b/.test(el.className)) return null;
    const m = /translate\(\s*(-?[\d.]+)(px|%)\s*,\s*(-?[\d.]+)(px|%)/.exec(el.style.transform || '');
    const role = Object.keys(T).find((r) => el.classList.contains(r)), color = el.classList.contains('white') ? 'w' : el.classList.contains('black') ? 'b' : null;
    if (!m || !role || !color) continue;
    const gx = m[2] === '%' ? +m[1] / 100 : +m[1] / sq, gy = m[4] === '%' ? +m[3] / 100 : +m[3] / sq;
    if (Math.abs(gx - Math.round(gx)) > 0.08 || Math.abs(gy - Math.round(gy)) > 0.08) return null;     // mid-animation
    const x = Math.round(gx), y = Math.round(gy);
    pieces.push({ file: flipped ? 7 - x : x, rank: flipped ? y : 7 - y, color, type: T[role] });
  }
  const pl = V.placementFromPieces(pieces);
  if (!pl) { const f = board.querySelector('piece'); return why(`found ${pieces.length} usable pieces of ${board.querySelectorAll('piece').length} <piece> elements (need both kings, no overlaps). First piece: ${f ? f.outerHTML.slice(0, 160) : 'none'}`); }
  lastWhy = ''; return pl;
}
// Lichess cloud-eval (only positions Lichess already has). Returns raw pvs or null. Cached; backs off for a minute after HTTP 429.
async function cloud(fen, n) {
  const key = fen.split(' ').slice(0, 4).join(' ') + '|' + n;
  if (cloudCache.has(key)) return cloudCache.get(key);
  if (Date.now() < cloudBlockedUntil) return null;
  try {
    const r = await fetch(`/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${n}`);
    if (r.status === 429) { cloudBlockedUntil = Date.now() + 60000; log('cloud-eval rate limit - pausing side-line badges for a minute'); return null; }
    const pvs = r.ok ? (await r.json()).pvs || null : null;
    cloudCache.set(key, pvs);
    return pvs;
  } catch (_) { return null; }
}
function warmEngine() {
  try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'cs-warm' }); } catch (_) {}
  if (!engineOk && !engineDown) setStatus('eng', `Starting engine… (v${VERSION})`);
}
// Bundled Stockfish (offscreen document, see background.js). Resolves to White-POV lines, [] for a position with no legal move, or null if the engine is unavailable.
const ENGINE_DEPTH = 13, DEEP_DEPTH = 18, CLOUD_MAX_MOVE = 25, PV = 3, SPEC = 3;     // PV lines per position; SPEC = how many of the engine's top replies are analysed ahead of time (0 = off, 4 = more CPU)
const stats = { n: 0, ms: 0, depth: 0, cached: 0 };
let engineDown = false, engineOk = false;
function engineFail(why) {
  if (engineDown) return;
  engineDown = true; log('engine unavailable:', why);
  setStatus('eng', `Engine not running (${why}) - Best badges hidden. Details: chrome://extensions > Lichess Move Badges > Errors`, true);
}
function engine(fen, multiPv, prio, depth = ENGINE_DEPTH) {
  if (engineDown || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { engineFail('no answer after 30 s'); fin(null); }, 30000);          // never wait forever
    try {
      chrome.runtime.sendMessage({ type: 'cs-engine', fen, multiPv, depth, prio }, (r) => {
        if (chrome.runtime.lastError || !r || r.error || !Array.isArray(r.pvs)) { engineFail((chrome.runtime.lastError && chrome.runtime.lastError.message) || (r && r.error) || 'no reply'); fin(null); return; }
        if (!engineOk) { engineOk = true; setStatus('eng', `Engine ready (v${VERSION})`); setTimeout(() => setStatus('eng', null), 5000); }
        if (r.cached) stats.cached++; else if (r.ms != null) { stats.n++; stats.ms += r.ms; stats.depth += r.depth || 0; }
        r.pvs.depth = r.depth || depth; fin(r.pvs);
      });
    } catch (e) { engineFail(String(e && e.message || e)); fin(null); }
  });
}
// Lines for a position, White's point of view. Order of preference: Lichess cloud-eval (deep, depth 30+, and the same numbers you see on the page) for opening positions,
// else the bundled engine. A deeper answer replaces a shallower cached one. Properties: .src ('cloud'|'engine') and .depth.
const lineCache = new Map();
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((r) => setTimeout(() => r(null), ms))]);
async function lines(fen, n, prio = 3, depth = ENGINE_DEPTH) {            // prio: 3 = the move you just played, 2 = position on screen, 1 = likely replies / deeper re-check, 0 = background check of the real game
  const key = fen.split(' ').slice(0, 4).join(' ') + '|' + n;
  const hit = lineCache.get(key);
  if (hit === null) return null;
  if (hit && ((hit.depth || 0) >= depth || hit.src === 'cloud')) return hit;
  let pvs = null, src = 'cloud';
  if (+fen.split(' ')[5] <= CLOUD_MAX_MOVE && await ensurePov()) {
    const w = V.toWhitePov(await withTimeout(cloud(fen, n), 900), fen, pov);
    if (w && w.length) { pvs = V.fixCastling(w, fen, Chess); pvs.depth = 99; }
  }
  if (!pvs) {
    src = 'engine'; pvs = await engine(fen, n, prio, depth);
    if (pvs === null && !(await ensurePov() === null)) { src = 'cloud'; const w = V.toWhitePov(await cloud(fen, n), fen, pov); pvs = w && w.length ? V.fixCastling(w, fen, Chess) : null; if (pvs) pvs.depth = 99; }
  }
  if (pvs && !pvs.length) pvs = null;
  if (pvs) { pvs.whitePov = true; pvs.src = src; lineCache.set(key, pvs); }
  else if (src === 'engine' && engineDown) lineCache.set(key, null);
  return pvs;
}
async function ensurePov() {
  if (!pov) { pov = V.detectPov(await cloud(V.CALIBRATION_FEN, 1)); if (!pov) log('side lines: could not tell the cloud-eval sign convention - no badges'); else log('side lines: cloud-eval is from', pov === 'white' ? "White's" : "the side to move's", 'point of view'); }
  return pov;
}
async function analyseVar(info, deep) {
  const q = info.parentFen, p = info.fen, mainEval = (f) => main.evals.get(V.placementOf(f));
  const end = new Chess(p), over = end.isGameOver(), d = deep ? DEEP_DEPTH : ENGINE_DEPTH;
  // Everything is measured by the same source; the played move is compared with the best line INSIDE the search of the position before it.
  // The position after the move is searched too because it is the starting point of your next move - then that move is already half done.
  const [pvsB, pvsA] = await Promise.all([lines(q, PV, 3, d), over ? null : lines(p, PV, 3, ENGINE_DEPTH)]);
  let evA = mainEval(p);
  if (end.isCheckmate()) evA = end.turn() === 'b' ? 10000 : -10000; else if (over) evA = 0;
  const prevTo = (main.known.get(V.placementOf(q)) || {}).to || null;
  if (!pvsB) { log('side line', info.san, '| no engine lines -> no badge'); return null; }
  const r = V.classifyMove({ parentFen: q, san: info.san, evB: mainEval(q), evA, pvsB, pvsA, prevTo }, Chess);
  if (r && r.kind === 'brilliant') log('side line', info.san, 'BRILLIANT because', r.why);
  log('side line', info.san, '|', pvsB.length, pvsB.src, 'lines, depth', pvsB.depth, '->', r ? r.kind : 'no badge');
  if (!r) return null;
  // a close call between the best moves was ordered by a shallow search: say so, the caller re-checks it deeper in the background
  return { ...r, ply: 'v:' + V.placementOf(p), shallow: pvsB.src === 'engine' && (pvsB.depth || 0) < DEEP_DEPTH && V.needsDeeper(pvsB, r.uci) };
}
const clearBadge = () => { if (node) { node.remove(); node = null; } if (tint) { tint.remove(); tint = null; } lastKey = ''; shownKey = ''; };
// While you look at a position: analyse it (priority 2), then the positions after the engine's top SPEC moves (priority 1, one at a time, abandoned the moment you move on).
// Play one of those moves and its badge is instant; anything else costs one search. Your own move always jumps the queue.
function prefetchAround(fen, placement) {
  lines(fen, PV, 2).then(async (pvs) => {
    if (!pvs) return;
    for (const pv of pvs.slice(0, SPEC)) {
      if (dead || curPlacement !== placement) return;
      const u = pv.moves.split(' ')[0]; let child;
      try { const c = new Chess(fen); c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); child = c.fen(); } catch (_) { continue; }
      if (new Chess(child).isGameOver()) continue;
      await lines(child, PV, 1);
    }
    // finally, settle this position with a deeper search (only if its best moves are close): it decides which of your next moves is THE best one
    if (!dead && curPlacement === placement && pvs.src === 'engine' && V.needsDeeper(pvs)) await lines(fen, PV, 1, DEEP_DEPTH);
  });
}
function scheduleVar(ms = 50) { clearTimeout(vTimer); if (gameId && main) vTimer = setTimeout(varCheck, ms); }
// Lichess's own move list says exactly which move is selected: every <move> carries its path (p), and a variation is a chain of paths hanging off a game move.
// Replays that chain from the game position it branches from; the result is only used if it lands on the position the board actually shows.
function domVariationInfo(placement) {
  try {
    const active = document.querySelector('.analyse__moves move.active');
    if (!active || !main || !main.fens || !active.closest('lines, interrupt')) return null;
    const p = active.getAttribute('p'); if (!p || p.length < 2 || p.length % 2) return null;
    const sans = []; let branch = -1;
    for (let k = 1; k <= p.length / 2; k++) {
      const el = document.querySelector(`.analyse__moves move[p="${CSS.escape(p.slice(0, 2 * k))}"]`);
      if (!el) return null;
      if (branch < 0 && el.closest('lines, interrupt')) branch = k - 1;
      if (branch >= 0) { const sn = el.querySelector('san'); if (!sn) return null; sans.push(sn.textContent.trim()); }
    }
    if (branch < 0 || !main.fens[branch]) return null;
    const c = new Chess(main.fens[branch]); let parent = c.fen(), mv = null;
    for (const san of sans) { parent = c.fen(); mv = c.move(san); }       // chess.js throws on an illegal move
    if (!mv || V.placementOf(c.fen()) !== placement) return null;
    return { parentFen: parent, fen: c.fen(), san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), to: mv.to };
  } catch (_) { return null; }
}
// The two squares Lichess highlights as "last move" (chessground <square class="last-move">), as names like "e4". null = none/unreadable.
function lastMoveSquares(wrap) {
  try {
    const board = wrap.querySelector('cg-board'); if (!board) return null;
    const size = board.getBoundingClientRect().width, sq = size / 8, flipped = wrap.classList.contains('orientation-black'), out = [];
    board.querySelectorAll('square.last-move').forEach((el) => {
      const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(el.style.transform || ''); if (!m || !sq) return;
      const x = Math.round(+m[1] / sq), y = Math.round(+m[2] / sq); if (x < 0 || x > 7 || y < 0 || y > 7) return;
      out.push(String.fromCharCode(97 + (flipped ? 7 - x : x)) + (flipped ? y + 1 : 8 - y));
    });
    return out.length ? out : null;
  } catch (_) { return null; }
}
function varCheck() {
  if (!main) return;
  const placement = readPlacement();
  if (!placement) { if (vRetry++ < 6) scheduleVar(150); return; }
  if (curPlacement === '') log('side lines: board read OK');
  vRetry = 0;
  if (placement === curPlacement) return;
  curPlacement = placement;
  const m = main.known.get(placement);
  if (m && m.main) { inVar = false; vEntry = null; lastFen = m.fen; clearBadge(); setStatus('move', null); render(); prefetchAround(m.fen, placement); return; }      // a position of the real game: its badge comes from the saved analysis
  inVar = true; vEntry = null; clearBadge(); render();                                                    // clear any stale badge while the new one is worked out
  let info = domVariationInfo(placement);                // exact, from Lichess's own move list (checked against the board)
  if (info) main.known.set(placement, { ...info, main: false }); else info = main.known.get(placement);
  if (!info) {
    info = V.findMove(main.known, placement, Chess, lastFen);
    if (info) main.known.set(placement, { ...info, main: false });
    else {                                       // several moves at once (clicked ahead in a saved line): search a few moves from the last position
      const path = V.findPathAny(main.known, lastFen, placement, Chess);
      if (!path) { log('side line: could not tell which move was played (not within 3 moves of the last position shown or 2 of any known position)'); return; }
      path.forEach((st) => { const k = V.placementOf(st.fen); if (!main.known.has(k)) main.known.set(k, { ...st, main: false }); });
      info = path[path.length - 1];
    }
  }
  lastFen = info.fen;
  prefetchAround(info.fen, placement);                    // analyse this position AND the engine's top replies while you think: your next move is then usually already done
  if (vResults.has(placement)) { vEntry = vResults.get(placement); lastKey = ''; render(); return; }
  const token = ++vToken, t0 = Date.now();
  setStatus('move', 'Analysing move…');
  analyseVar(info).then(async (res) => {
    vResults.set(placement, res); log('side line took', Date.now() - t0, 'ms');
    if (token === vToken) setStatus('move', null);
    if (token === vToken && curPlacement === placement) { vEntry = res; lastKey = ''; render(); }
    // close call ordered by a shallow search: re-check with a deeper one and correct the badge if the verdict changes
    if (res && res.shallow) {
      const r2 = await analyseVar(info, true);
      if (r2 && r2.kind !== res.kind) {
        log('side line', info.san, 'deeper check changed', res.kind, '->', r2.kind);
        vResults.set(placement, r2);
        if (curPlacement === placement) { vEntry = r2; clearBadge(); render(); }
      }
    }
  }).catch((e) => console.debug('[ChessStyle] side line', e));
}
// Which move of the real game is on screen? Counting <move> elements drifts (Lichess adds extra elements around inline variations), so the candidates
// (the move's own path attribute, then the count) are CHECKED against the position actually on the board; a candidate that does not match is rejected.
function currentPly() {
  const active = document.querySelector('.analyse__moves move.active');
  if (!active) return 0;
  if (active.closest('lines, interrupt')) return -1;                    // inside a variation: no badge
  const all = [...document.querySelectorAll('.analyse__moves move')].filter((m) => !m.classList.contains('empty') && !m.closest('lines, interrupt'));
  const cands = [], path = active.getAttribute('p');
  if (path && path.length % 2 === 0) cands.push(path.length / 2);
  cands.push(all.indexOf(active) + 1);
  const pl = main && main.byPly ? readPlacement() : null;
  if (!pl) return cands[0];                                             // board unreadable (animating): best guess
  const hit = cands.find((c) => main.byPly[c] === pl);
  if (hit !== undefined) return hit;
  const any = main.byPly.indexOf(pl);                                   // neither candidate fits: the board itself says where we are
  return any > 0 ? any : -1;
}
function render() {
  const wrap = document.querySelector('.analyse__board .cg-wrap, .analyse__board cg-wrap, main .cg-wrap');
  const m = !inVar && badges.get(currentPly()); let e = wrap && (inVar ? vEntry : (m ? (m.pending || m.unverified ? { ...m, kind: 'excellent' } : m) : null));   // not yet confirmed as THE best move: show Excellent (never a false Best) instead of nothing
  const flipped = !!wrap && wrap.classList.contains('orientation-black');
  if (e && !V.badgeSquareOk(e, wrap && lastMoveSquares(wrap))) { if (!window.__csSq) { window.__csSq = 1; log('badge for', e.san, 'on', e.to, 'does not match the move Lichess highlights - hidden instead of shown on the wrong square'); } e = null; }
  if (wrap && badges.size && !e && !window.__csWarned) { window.__csWarned = 1; log('board found, but no badge for ply', currentPly(), '(active move element:', !!document.querySelector('.analyse__moves move.active'), ')'); }
  const key = e ? `${e.ply}${e.kind}${flipped}` : '';
  if (key === lastKey && (!key || (node && node.isConnected))) return;
  lastKey = key;
  if (node) { node.remove(); node = null; }
  if (tint) { tint.remove(); tint = null; }
  const replay = key !== shownKey; shownKey = key;            // animate only when the move is newly shown, not on silent re-renders
  if (!e) return;
  const f = e.to.charCodeAt(0) - 97, r = +e.to[1] - 1;
  const x = flipped ? 7 - f : f, y = flipped ? r : 7 - r;
  const board = wrap.querySelector('cg-board');
  if (board && (e.kind === 'brilliant' || e.kind === 'book')) {  // square tint sits UNDER the pieces, inside the board
    tint = document.createElement('div');
    tint.className = 'cs-tint cs-tint-' + e.kind + (replay && e.kind === 'brilliant' ? ' cs-anim' : '');
    tint.style.left = x * 12.5 + '%'; tint.style.top = y * 12.5 + '%';
    board.appendChild(tint);
  }
  const tip = (caption(e, !inVar && e.kind === 'book' && e.ply === lastBook) || LABEL[e.kind]).replace(/"/g, '');
  node = document.createElement('div');
  node.className = 'cs-sq' + (x === 7 ? ' cs-edge-r' : x === 0 ? ' cs-edge-l' : '') + (y === 0 ? ' cs-top' : '');
  node.style.left = x * 12.5 + '%';
  node.style.top = y * 12.5 + '%';
  const fx = replay && e.kind === 'brilliant'
    ? '<span class="cs-ring"></span><span class="cs-ring cs-ring2"></span><span class="cs-big" aria-hidden="true">!!</span><span class="cs-label" aria-hidden="true">Brilliant!</span>' : '';
  node.innerHTML = fx + `<span class="cs-badge cs-${e.kind}${fx ? ' cs-pop' : ''}" role="img" aria-label="${tip}" title="${tip}">${GLYPH[e.kind]}</span>`;
  wrap.appendChild(node);
}
const INSTANCE = Math.random().toString(36).slice(2);
const extAlive = () => { try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
// Switch this copy of the script off: the extension was reloaded/updated (the page keeps the old copy, whose connection to the extension is gone) or a newer copy took over.
function teardown(why) {
  if (dead) return; dead = true; log('stopped:', why);
  try { observer.disconnect(); clearInterval(safety); } catch (_) {}
  clearTimeout(pollTimer); clearTimeout(vTimer); clearBadge(); ['game', 'move', 'eng'].forEach((k) => setStatus(k, null));
}
document.addEventListener('cs-takeover', (e) => { if (e.detail !== INSTANCE) teardown('a newer copy of the extension took over'); });
function tick() {
  scheduled = false;
  if (dead) return;
  if (!extAlive()) return teardown('extension was reloaded - the background page injects a fresh copy');
  const m = location.pathname.match(/^\/(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?$/);
  const id = m && !RESERVED.has(m[1]) ? m[1] : null;
  if (location.pathname !== lastPath) { lastPath = location.pathname; log('page', location.pathname, '-> game id:', id); }
  if (id !== gameId) load(id);
  else {
    // a side-line badge belongs to ONE position: remove it the moment the board changes instead of leaving it on the wrong square until the new one is ready
    if (inVar && vEntry && readPlacement() !== curPlacement) { vEntry = null; clearBadge(); }
    render(); scheduleVar();
  }
}
const observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(tick); } });
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
const safety = setInterval(() => { if (!scheduled) tick(); }, 2000);                 // safety net: pick up page changes even if the DOM observer missed them
document.dispatchEvent(new CustomEvent('cs-takeover', { detail: INSTANCE }));         // an older copy still running on this page stops itself
log('loaded v' + VERSION);
tick();
