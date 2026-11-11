# Lichess Move Badges

A Chrome extension that adds Chess.com-style move badges (Brilliant, Great, Best, Excellent, Good, Book) to finished games on Lichess, including the moves you play yourself in side lines.

Lichess already marks inaccuracies, mistakes and blunders. It does not tell you which move was the engine's first choice, which one was a real sacrifice, or which was the only move that saved the position. This fills that gap.

Unofficial. Not affiliated with Lichess or Chess.com.

## Features

- Badges on the board for every move of a finished game, drawn on the destination square.
- Works on your own moves in side lines: play a move on the analysis board and it is judged in about half a second.
- Runs a bundled Stockfish 19 locally. Nothing is sent to a third-party server.
- Only touches finished games. Live games are never analysed.

| Badge | Meaning |
| --- | --- |
| Brilliant | Best or near-best move that really sacrifices material, and you are not in a bad position afterwards |
| Great | The only move that saves or turns the position (rare) |
| Best | The engine's first choice. Exactly one move per position can be Best |
| Excellent | Within 2% win chance of the best move |
| Good | Within 5% win chance of the best move |
| Book | Inside the opening Lichess recognises |
| Inaccuracy, Mistake, Blunder | Lichess's own verdicts, copied unchanged |
| Miss | You failed to punish a Lichess Mistake or Blunder by your opponent |

In side lines Lichess marks nothing, so errors are judged by centipawn drop: 50-99 Inaccuracy, 100-199 Mistake, 200+ Blunder.

## Install

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and select the `ext/` folder.
4. Reload any open Lichess tabs.

Requires Chrome 116 or newer (the engine runs in an offscreen document).

## Use

1. Open a finished game on lichess.org (imported games work too).
2. Click Request a computer analysis.
3. Badges appear as the analysis finishes. No refresh needed.

Best badges show after the engine confirms them, nearest moves first. Small chips on the board show progress ("Checking moves 12/40", "Analysing move...").

Tip: turn off Lichess's own in-browser engine while using this. They compete for the same CPU.

## How moves are judged

Lichess's saved analysis gives the evaluation after each move. That is converted to a win chance, and the loss between positions decides the label. The Best check and your side-line moves use the bundled engine (about depth 13, two lines, results cached on disk).

- **Win-chance curve:** logistic with `k = 0.0061` per centipawn, fitted to evaluations Chess.com showed on a reviewed game.
- **Best:** must be the engine's first line. A move 0.03 pawns worse is Excellent.
- **Brilliant:** near-best, a real sacrifice, at least 40% win chance afterwards, and you were not already completely winning. A deeper engine pass has to agree before it stands.
- **Great:** the engine's first line, and every alternative is clearly worse. Capped at 10% of a player's moves.

Chess.com's exact thresholds are not public, so these are approximations. Expect roughly 55-65% exact agreement with Chess.com. Most disagreements are between Best, Excellent and Good. Rating-dependent behaviour is not modelled.

## Privacy and fair play

- Analysis runs locally in the browser.
- The only network requests go to lichess.org: the game export, and cloud-eval as a fallback if the engine cannot start.
- No data is collected and nothing is sent anywhere else.
- Live games are never touched: nothing runs until a game has finished.

## Development

```
npx esbuild src/content.js --bundle --outfile=ext/dist/content.js --format=iife --minify
node --test tests/review.test.js tests/variation.test.js
```

Reload the extension and the Lichess tab after rebuilding.

```
ext/        manifest, background.js, offscreen.js, badge CSS, bundled engine
src/        content.js, review.js, classify.js, variation.js, caption.js
tests/
```

Tuning constants: the rules are in `K` at the top of `src/review.js`, the curve in `src/classify.js`, and `PV` / `SPEC` (engine lines, pre-calculation) in the engine section of `src/content.js`.

## Troubleshooting

Open the page console and filter for `Lichess Badges`.

- `Engine not running`: the bundled engine did not start. Check chrome://extensions, Lichess Move Badges, Errors. Until it is back, an unconfirmed Best shows as Excellent.
- No badges at all: make sure the game is finished and the computer analysis has been requested.
- Stale behaviour after updating: reload the Lichess tab.

## Limitations

- Finished games only. Variants are not supported.
- The free `/analysis` board (no game id) is not supported.
- Relies on Lichess's page structure, so a Lichess redesign can break it.

## Credits and license

Stockfish 19 (lite, single-thread WASM) is bundled in `ext/engine/` under GPLv3. See `ext/engine/LICENSE-stockfish-GPLv3.txt`. Move categories follow Chess.com's published classification article. No Chess.com assets are used.
