# Lichess Move Badges (unofficial)
Load `ext/` unpacked (Chrome 116+) (chrome://extensions -> Developer mode -> Load unpacked). Rebuild: `npx esbuild src/content.js --bundle --outfile=ext/dist/content.js --format=iife --minify`. Tests: `node --test tests/review.test.js tests/variation.test.js`.
Run Lichess "Request a computer analysis" on a finished game first; the extension reads that analysis (public `/game/export` JSON) and adds Brilliant / Great / Best / Excellent / Good / Book badges. Lichess's own Inaccuracy/Mistake/Blunder marks are untouched. A bundled Stockfish 19 (lite, single-thread WASM, GPLv3, in `ext/engine/`) runs locally in a Chrome offscreen document (`background.js` -> `offscreen.js`) to verify Brilliant/Great and to judge your own side-line moves; Lichess cloud-eval is only a fallback if the engine cannot start. It only ever runs on FINISHED games - live games are never touched.
Rules follow Chess.com's published definitions (support.chess.com "How are moves classified?"); Chess.com's exact thresholds are not public, so the numbers below are approximations (see `K` in `src/review.js`).
- **Best = the engine's first choice** (never a tie: exactly ONE move per position can be Best), exactly like Chess.com: a move that is only 0.03 pawns worse than the best one is Excellent, not Best. Excellent <=2%, Good <=5% win-chance loss (Lichess win% curve; Lichess itself marks Inaccuracy/Mistake/Blunder). Book = inside the opening Lichess detected.
- **Brilliant** = near-best (<=2% loss) + a real sacrifice + not a bad position afterwards (>=40% win chance) + you would NOT have been completely winning without it (best alternative on Lichess cloud-eval < ~+5.0; with no cloud data, the position before must not have been crushing). Never for a move that escapes check or a promotion. The sacrifice can be any of three kinds:
  1. **Piece moved onto a capturable square** - net material the move gives up after the opponent's best capture and a recapture on that square (>=2 = piece/exchange sacrifice; a 1-pawn sacrifice only counts if it gives check). Works from the stored Lichess evals alone.
  2. **Another piece moves while a piece is hanging** - a piece that was already en prise stays en prise, and ignoring it pays off: the move raises your win chance by >=5% (works without cloud data), or cloud lines show a move that saves the piece was about as good (<=10%), i.e. leaving it was a choice. A piece that was lost anyway is not a sacrifice.
  3. **Deferred / positional sacrifice** - nothing is capturable yet, but the engine's own cloud line (4-8 plies) ends with you >=2 pawns down in material. Needs cloud lines; never guessed.
- **Great** (rare: max 10% of a player's moves, min 2) = near-best AND either (a) a turning point in Lichess's evals (losing -> equal, or equal -> winning, gaining >=10% win chance) or (b) an only-move: it is the #1 cloud-eval line and >=15% (12% under 1500) better than the #2 line. Ordinary best moves stay "Best".
## Your own moves in side lines (v0.7.0)
Play any move on the analysis board (or open a saved side line) and the destination square gets a badge: Brilliant, Great, Best, Excellent, Good, **Inaccuracy `?!`, Mistake `?`, Missed chance, Blunder `??`** (Lichess marks none of these in side lines, so they are added here).
- The move is found from the board itself: piece positions are read off the chessground board and matched against the real game's positions plus every position you visited; the one legal move that leads there is the move you played. No dependence on the move-list markup.
- Evaluations come from the bundled Stockfish (depth 13 or 0.7-1 s, whichever comes first, 2 lines; both measured by the same engine so the loss is consistent). Lichess cloud-eval is used only if the engine cannot start. A move is judged in about 0.5-1 s: the position on screen is pre-analysed while you think, the move you just played always jumps the queue ahead of background work, and every engine result is cached on disk (re-opening a game is instant; first visit ~0.6 s per move in the background, nearest moves first).
- If you click several moves ahead in a saved line (up to 3 moves from the last position shown, or 2 from any known position) the position is still recognised.
- Same rules as the main game (sacrifice detection, only-move Great, turning point) with no per-player cap on Great; forced moves get no badge.
- Not supported: variants, and the free `/analysis` board (no game id).

Unverified: Lichess DOM selectors (board `.analyse__board .cg-wrap`, move list `.analyse__moves move.active`); not tested on the live site.

## Troubleshooting
Open the page console and filter for `Lichess Badges`. You should see `loaded v0.10.0`, the number of analysis entries vs moves, the Brilliant candidates, and one line per candidate such as
`move 22 Na4: 3 engine lines -> brilliant [badge updated]`. Side-line moves log `side line e4 | eval before .. after .. | 3 engine lines -> best`. If you see `engine unavailable: ...` the offscreen engine did not start (check chrome://extensions -> Errors). After reloading the extension, RELOAD THE LICHESS TAB too: old tabs keep running the old script.


## Real game: "Best" badges appear after the engine confirms them
Lichess's saved analysis only has the evaluation after each move, not the best move, so it cannot tell a first choice from a move 0.03 pawns worse. Every move it calls best is therefore checked with the bundled engine (nearest moves first); the badge shows once confirmed, as Best or Excellent/Good.

## If it feels slow
Small chips on the board show progress ("Checking moves 12/40", "Analysing move…"). The console (filter `Lichess Badges`) prints `engine: N searches, avg X ms, avg depth Y; Z answered from the disk cache` after the real game is verified and `side line took X ms` per move of yours. Lichess's own in-page engine (the "Computer analysis" switch on the analysis board) competes for the same CPU: turn it off while using the badges.

## Engine status chip (v0.9.2)
Top-left of the board: `Starting engine…` -> `Engine ready (vX)` (disappears after 5 s). If it turns red (`Engine not running (...)`) the bundled engine did not start: Best badges are then hidden (a stored-eval "best" cannot be told from "almost best") and side lines show nothing, instead of showing wrong badges. The reason is also in chrome://extensions > Lichess Move Badges > Errors.

## No page refresh needed (v0.9.3)
The extension now keeps going by itself: a failed request is retried with back-off; a game that is still being played is re-checked every 15 s (nothing is analysed until it has ended); a finished game whose analysis is not ready is re-checked every 4 s for 2 minutes, then every 20 s for 15 minutes; moving to another game inside the page loads it; and when you install/update/reload the extension, tabs that are already open get a fresh copy injected (the old copy stops itself). One-time exception: tabs still running a copy older than v0.9.3 need one refresh when you update from it.

## Pre-calculation (v0.9.3)
While you look at a position the engine analyses it, then the positions after its top `SPEC` (=3) replies, one at a time at low priority; it abandons them the moment you move on, and your own move always jumps the queue. Play one of those moves and the badge is instant (~0.15 s); any other move takes ~0.5 s. `SPEC` and `PV` are constants at the top of the engine section in `src/content.js` (SPEC 0 = off, 4 = more CPU). Rebuild with the esbuild command above after changing them.

## v0.10.9 - badge on the wrong piece
- A side-line badge could land on the wrong piece (e.g. a star on a pawn after you moved the bishop) when you jumped around inside a Lichess variation, because the move was guessed by comparing board positions. Now the move is read from Lichess's own move list (every move carries its path; the variation is replayed from the game position it branches from) and only used if it reproduces the position on the board. The old guessing remains as a fallback.
- A badge is only drawn if its square is one of the two squares Lichess highlights as the last move; otherwise it is hidden (the log says so) rather than shown on the wrong square.

## v0.10.8 - negative badges follow Lichess exactly
- **Real game:** Inaccuracy / Mistake / Blunder are Lichess's own verdicts, copied as they are. Nothing of ours relabels, adds or removes one (the board never contradicts the move list). A move Lichess did not flag is never shown as an error: at worst it is Good.
- **Miss** (Lichess has no such label): only when the opponent's previous move was a Lichess Mistake/Blunder, the mover is at least equal, and the mover's own move was flagged only Inaccuracy/Mistake. A Blunder stays a Blunder. (Chess.com: "fail to capitalize on your opponent's mistake".)
- **Side lines** (Lichess marks nothing there): centipawn drop 50-99 Inaccuracy, 100-199 Mistake, 200+ Blunder. Lichess's open-source rule started as 50 / 100 / 300; verdicts seen on a real game (Blunders from ~220 cp, a Mistake at ~200 cp, Inaccuracies at 60-90 cp) fit 50 / 100 / 200 better. This is an approximation, not an official number, and it applies to side lines only.
- Best / Excellent / Good, Book, Brilliant and Great are unchanged: they are the Chess.com-style labels Lichess does not offer.
- The win-chance curve (k = 0.0061, fitted to Chess.com's own evals) is only used for Best / Excellent / Good and for finding Brilliant / Great, never for the three error labels on the real game.

## v0.10.6
- Every move of the real game now gets a mark: Lichess-flagged moves inside the opening range (e.g. 2.dxc5?!), forced moves (shown as Best), the checkmating move, and moves Lichess did not flag but the Chess.com bands do. Only a move with no evaluation at all (analysis not finished, engine unavailable) stays unmarked until one exists.

## v0.10.5 - no move left unmarked
- A move still waiting for engine confirmation (or one the engine could not confirm) shows Excellent instead of nothing; it becomes Best only once confirmed as the engine's first choice.
- Moves that Chess.com's bands call Inaccuracy/Mistake/Blunder but Lichess did not flag now carry that mark too.
- The checkmating move (no stored eval) is marked Best.
- Still unmarked on purpose: forced moves (only one legal move).

## v0.10.6
- Every move of the real game now gets a mark: Lichess-flagged moves inside the opening range (e.g. 2.dxc5?!), forced moves (shown as Best), the checkmating move, and moves Lichess did not flag but the Chess.com bands do. Only a move with no evaluation at all (analysis not finished, engine unavailable) stays unmarked until one exists.

## v0.10.5
- Fixed badges landing on the wrong move (or none) later in a game. The move on screen was found by counting entries in Lichess's move list, which drifts once inline variation blocks appear. It is now checked against the position actually on the board.

## v0.10.4
- Lichess's own board glyph (the ?! / ? / ?? circle) is hidden so it no longer overlaps ours. The move list is unchanged.

## v0.10.3
- Moves Lichess itself marks as Inaccuracy / Mistake / Blunder now also get a badge on the board (same verdict as the move list), so no move is left unmarked.

## v0.10.2 fixes
- A Brilliant was awarded to 3...e6: the engine line was cut off mid-exchange and read as a 2-pawn sacrifice. A line now only counts once the position is truly quiet (neither side has a capture that wins material).
- Lichess cloud lines write castling as king-takes-rook (e8h8); these are now converted, which also fixes "Best" never being recognised on castling moves and a crash that stopped the verification pass.
- Every Brilliant logs why it was awarded (filter the console for `BRILLIANT because`).

## Built on the Chess.com reverse-engineering data (v0.10.0)
Source: the five research files (classification spec, research dossier, unknowns register, build handoff, per-move dataset of one reviewed game, ~3000-rated). Rule used throughout: **only what is Confirmed or Observed is implemented; anything marked Unknown or contradictory is left out.**

**Implemented**
- **Steeper win-chance curve** (`src/classify.js`, `k = 0.0061` per centipawn, was `0.00368` from Lichess). In the dataset Chess.com showed its own eval before and after a move for 8 labelled moves. Chess.com calls a 33-56 cp drop from an equal position an *Inaccuracy*; the old curve called those *Good*. The new curve reproduces 7 of the 8 labels (old: 4 of 8). `0.0061` is the *flattest* slope that fits them all. Pinned by `tests/chesscom-data.test.js`.
- **Two-pass verification of Brilliant/Great** (the method the research documents): a Brilliant/Great found by the quick search only stands if a deeper search (depth 18) agrees; otherwise the move falls back to its ordinary label. Cloud-eval lines are already deep and are not repeated.
- **Chess.com-style captions** in the badge tooltip: `e3 is the last book move +0.50`, `Qxa5 is brilliant +3.73`, `a5 is an inaccuracy +0.66` (eval = White's point of view, as in the review). Only the Best explanation ("The best move here, no doubt about it.") is added, because it is true by construction (Best = engine's first choice); other Chess.com explanation sentences depend on tactics this extension does not detect.
- Best stays strictly ONE move per position (the engine's first line). The research notes a third-party "tie within 10 cp still counts as Best" rule; it is not used because you asked for exactly one.

**Deliberately NOT implemented (Unknown or contradictory in the data)**
- *Rating-dependent flattening.* Confirmed to exist, but only one ~3000-rated game was measured, so the size of the effect is unknown. The curve above is therefore the one measured at ~3000; for lower-rated players Chess.com's curve is flatter, so our Inaccuracy labels may be somewhat stricter than theirs.
- *Saturation in lopsided positions.* One move (Qd2, +0.78 -> -0.87) is a Mistake at Chess.com but a Blunder here; no single logistic fits it and the 33 cp Inaccuracy together. Documented as a known deviation in the test.
- *Great in already-decided positions* (two Great moves at +6.7 / +8.7) and *Brilliant at +8* - contradicts the official "not already completely winning" text and the displayed eval (+3.73) differs from the independent engine's. Left as is.
- *Miss thresholds*, *Forced*, *accuracy / game rating* (CAPS2 is private), *which plies get a caption*, *book cut-off* - all Unknown.
- *Tactical Mistakes in decided positions* (Ke7 -8.36 -> -9.31 is a Mistake, Qe6 -8.96 -> -8.08 is Excellent): not explained by any rule in the data.

**Honest expectation** (from the data itself): even an independent implementation with the same engine settings reaches roughly 55-65% exact agreement; disagreements concentrate on Best / Excellent / Good. Mistake and Blunder agree most often.
