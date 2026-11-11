// Relays engine requests from the Lichess page to the offscreen document that hosts Stockfish (created on first use).
let creating = null;
async function hasOffscreen() {
  try { if (chrome.runtime.getContexts) return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0; } catch (_) {}
  try { return await chrome.offscreen.hasDocument(); } catch (_) { return false; }
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run the bundled Stockfish engine to classify moves in finished games' }).finally(() => { creating = null; });
  await creating;
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'cs-warm') { ensureOffscreen().catch(() => {}); return false; }      // page opened: start loading the engine now, in parallel with fetching the game
  if (!msg || msg.type !== 'cs-engine' || msg.target) return false;
  ensureOffscreen().then(() => chrome.runtime.sendMessage({ ...msg, target: 'offscreen' })).then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

// Tabs that were open before the extension was installed / updated / reloaded still hold a dead copy of the old script (or none). Give them a fresh one,
// so no page refresh is needed. The new copy tells any old copy still on the page to stop (see 'cs-takeover' in content.js).
async function injectIntoOpenTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: 'https://lichess.org/*' }); } catch (_) { return; }
  for (const t of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['badges.css'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['dist/content.js'] });
    } catch (_) { /* tab not injectable (discarded, error page): it will load normally on its next navigation */ }
  }
}
chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);
