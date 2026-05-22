# Architecture Notes

For handoff context, read `docs/HANDOFF.md` first. This file focuses on engineering boundaries and rule/review architecture.

## Current Rule Boundary

The project now separates poker rules from UI and AI behavior:

- `rules.js`: pure rule helpers for action eligibility, betting constraints, hand evaluation, pot settlement, blind positions, and chip accounting.
- `engine.js`: pure hand state machine that can play a full hand from blinds to showdown without DOM or AI.
- `review.js`: pure review helpers that extract exact decision-time spots and solver-facing spot shapes from hand history.
- `app.js`: session controller and browser UI. It now uses `engine.js` as the active hand state source, persists completed hand histories, and drives review/stat views from saved hands.

GTO or solver work should not connect directly to UI state. It should consume serialized hand histories or `review.js` decision spots.

## Tested Coverage

The rule test suite covers:

- action eligibility
- street completion
- all-in runout
- minimum raise size
- full raise vs short all-in raise
- heads-up and multiway blind/action order
- hand ranking comparisons
- main pot and side pot settlement
- tied pot splitting
- folded contributions
- total chip conservation
- random side-pot stress tests

The engine test suite covers:

- full checked-down hand through river showdown
- big blind option after preflop limps
- short all-in raise not reopening betting
- heads-up all-in runout
- out-of-turn and illegal check rejection

The review test suite covers:

- extracting player decisions from exact action-time state
- preserving pot, call amount, board, stack, and hole cards at the decision point
- converting decisions into a stable solver-facing spot shape

## Implemented Page Architecture

The browser UI now has five top-level views:

- table play
- hand library
- review workbench
- data center
- table configuration

Completed hands are serialized and stored locally. Review can open any stored hand, not just the most recent one. The configuration view supports integrated presets such as HU, 6-max, 9-max, short stack, and deep stack, plus custom seat/blind/buy-in settings.

## Remaining Architecture Step

The major remaining architecture step before GTO is strategy isolation. Current bot behavior is still a lightweight in-app heuristic. Solver integration can target this stable interface:

1. collect engine hand state and action history
2. extract review decision spots with `review.js`
3. call a solver service, strategy table, or stronger AI policy
4. store solver output on the completed hand review
5. render strategy frequencies and EV deltas in the review screen

## Strategy Isolation Target

The next implementation milestone should move heuristic bot logic out of `app.js` into a strategy module. The strategy layer should:

- receive a read-only hand state snapshot and legal actions from `engine.js`
- return one legal action object
- never mutate the engine state directly
- be testable without DOM
- allow future policies such as beginner bots, stronger exploitative bots, range-table bots, Monte Carlo equity bots, or solver-backed GTO policies

This keeps GTO work behind a stable boundary instead of wiring solver decisions directly into UI event handlers.

## Review Accuracy Principle

Review must use action-time snapshots, not final-state inference. Every decision spot should carry:

- street
- board at the time
- player hole cards
- pot before action
- current bet before action
- player bet and stack before action
- exact call amount
- actual action and paid amount

This avoids a common bug where review explanations are computed from the final board or final pot instead of the actual decision point.
