# Architecture Notes

## Current Rule Boundary

The project now separates poker rules from UI and AI behavior:

- `rules.js`: pure rule helpers for action eligibility, betting constraints, hand evaluation, pot settlement, blind positions, and chip accounting.
- `engine.js`: pure hand state machine that can play a full hand from blinds to showdown without DOM or AI.
- `app.js`: browser UI, simple bot decisions, review/stat tracking.

GTO or solver work should not connect directly to `app.js`. It should consume hand states or exported hand histories from `engine.js`/`rules.js` shaped data.

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

## Next Architecture Step

Before adding GTO, the next clean step is to make `app.js` use `engine.js` as its single source of hand state. After that, solver integration can target a stable interface:

1. collect engine hand state and action history
2. normalize it into a solver spot representation
3. call a solver service or imported strategy table
4. store solver output on the completed hand review
5. render strategy frequencies and EV deltas in the review screen
