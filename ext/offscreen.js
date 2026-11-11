// Runs Stockfish (bundled, lite single-thread WASM) for the content script, in an offscreen document (MV3 service workers cannot host Workers).
// Request : { target:'offscreen', type:'cs-engine', fen, multiPv, depth, prio }   prio 2 = the move you just played, 1 = the position on screen, 0 = background
// Response: { pvs:[{ moves, cp | mate }] }  White's point of view; [] when the position has no legal move.
// - one search at a time, highest priority first; a higher-priority request stops a running lower-priority search, which is restarted later
// - identical requests are merged (a background request is upgraded when the same position is asked for urgently)
// - finished results are kept in localStorage, so re-opening a game is instant
let worker = null, ready = null, onLine = null, cur = null;
const jobs = new Map();                                   // key -> { key, msg, prio, waiters:[fn], running, preempted }
const keyOf = (m) => m.fen.split(' ').slice(0, 4).join(' ') + '|' + m.multiPv + '|' + m.depth;

const CK = 'cs2:', CAP = 12000;
function cacheGet(k) { try { const v = localStorage.getItem(CK + k); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
function cacheSet(k, pvs) {
  const slim = pvs.map((p) => ({ ...p, moves: p.moves.split(' ').slice(0, 10).join(' ') }));
  try { localStorage.setItem(CK + k, JSON.stringify(slim)); }
  catch (_) { try { for (const x of Object.keys(localStorage)) if (x.startsWith(CK)) localStorage.removeItem(x); localStorage.setItem(CK + k, JSON.stringify(slim)); } catch (__) { /* storage full or blocked: just run uncached */ } }
  try { if (localStorage.length > CAP) for (const x of Object.keys(localStorage).slice(0, 2000)) if (x.startsWith(CK)) localStorage.removeItem(x); } catch (_) {}
}

function start() {
  if (ready) return ready;
  worker = new Worker('engine/stockfish-19-lite-single.js');
  worker.onmessage = (e) => { if (onLine) onLine(String(e.data)); };
  ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('engine start timeout')), 20000);
    onLine = (l) => { if (l === 'uciok') { worker.postMessage('setoption name Hash value 64'); worker.postMessage('isready'); } else if (l === 'readyok') { clearTimeout(t); onLine = null; resolve(); } };
    worker.onerror = (e) => { clearTimeout(t); reject(new Error('engine error ' + (e.message || ''))); };
    worker.postMessage('uci');
  });
  ready.catch(() => { ready = null; worker = null; });
  return ready;
}

function search(job) {
  return new Promise((resolve) => {
    const { fen, multiPv, depth } = job.msg, turn = fen.split(' ')[1] === 'b' ? -1 : 1, best = {}, t0 = Date.now(); let reached = 0;
    const guard = setTimeout(() => worker.postMessage('stop'), 8000);       // never let one position hang the queue
    onLine = (l) => {
      if (l.startsWith('bestmove')) { clearTimeout(guard); onLine = null; const out = Object.keys(best).map(Number).sort((a, b) => a - b).map((k) => best[k]); out.ms = Date.now() - t0; out.depth = reached; return resolve(out); }
      if (!l.startsWith('info') || !l.includes(' pv ') || / (lower|upper)bound/.test(l)) return;
      reached = Math.max(reached, +((/ depth (\d+)/.exec(l) || [0, 0])[1]));
      const n = +((/ multipv (\d+)/.exec(l) || [0, 1])[1]), cp = /score cp (-?\d+)/.exec(l), mt = /score mate (-?\d+)/.exec(l);
      if (!cp && !mt) return;
      const moves = l.split(' pv ')[1].trim();
      best[n] = cp ? { moves, cp: turn * +cp[1] } : { moves, mate: turn * +mt[1] };
    };
    worker.postMessage('setoption name MultiPV value ' + multiPv);
    worker.postMessage('position fen ' + fen);
    worker.postMessage('go depth ' + depth + ' movetime ' + (depth >= 17 ? 3500 : job.prio > 0 ? 1000 : 700));        // depth OR time, whichever comes first: a slow machine gets a slightly shallower answer, never a long wait
  });
}

async function pump() {
  if (cur) return;
  let next = null;
  for (const j of jobs.values()) if (!j.running && (!next || j.prio > next.prio)) next = j;         // Map order = arrival order among equal priorities
  if (!next) return;
  cur = next; next.running = true;
  let pvs = null, err = null;
  try { await start(); pvs = await search(next); } catch (e) { err = String((e && e.message) || e); }
  cur = null; next.running = false;
  if (!err && next.preempted) { next.preempted = false; }                                           // stopped for something more urgent: keep the job, run it again later
  else {
    jobs.delete(next.key);
    if (!err && pvs) cacheSet(next.key, pvs);
    for (const w of next.waiters) w(err ? { error: err } : { pvs: pvs || [], ms: pvs && pvs.ms, depth: pvs && pvs.depth });
  }
  pump();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'cs-engine') return false;
  const m = { fen: msg.fen, multiPv: Math.max(1, Math.min(5, msg.multiPv | 0 || 1)), depth: Math.max(6, Math.min(22, msg.depth | 0 || 13)) }, prio = msg.prio | 0, k = keyOf(m);
  const hit = cacheGet(k);
  if (hit) { sendResponse({ pvs: hit, cached: true, depth: m.depth }); return false; }
  let job = jobs.get(k);
  if (job) { job.waiters.push(sendResponse); job.prio = Math.max(job.prio, prio); }
  else { job = { key: k, msg: m, prio, waiters: [sendResponse], running: false, preempted: false }; jobs.set(k, job); }
  if (cur && cur !== job && job.prio > cur.prio && !cur.preempted) { cur.preempted = true; worker.postMessage('stop'); }
  pump();
  return true;
});
start().catch(() => {});                                                                             // warm up: load the engine before the first request
