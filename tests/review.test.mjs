import assert from "node:assert/strict";
import { applyPlayerAction, createHandState, serializeHandHistory } from "../engine.js";
import { extractDecisionSpots, toReviewSummary, toSolverSpot } from "../review.js";

const card = (rank, suit = "s") => ({ id: String(rank), value: rankValue(rank), suit });

function rankValue(rank) {
  return { T: 10, J: 11, Q: 12, K: 13, A: 14 }[rank] || Number(rank);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function deck() {
  return [
    card("A", "s"), card("K", "c"), card("5", "c"),
    card("A", "h"), card("Q", "d"), card("6", "d"),
    card("2", "s"), card("7", "h"), card("9", "c"), card("J", "s"), card("K", "d"),
  ];
}

test("extracts player decision spots from exact action-time state", () => {
  const state = createHandState({
    players: [{ id: "hero", stack: 1000 }, { id: "sb", stack: 1000 }, { id: "bb", stack: 1000 }],
    deck: deck(),
    dealer: 0,
  });
  applyPlayerAction(state, "hero", "call");
  applyPlayerAction(state, "sb", "call");
  applyPlayerAction(state, "bb", "check");
  applyPlayerAction(state, "sb", "check");
  applyPlayerAction(state, "bb", "check");
  applyPlayerAction(state, "hero", "check");

  const history = serializeHandHistory(state);
  const spots = extractDecisionSpots(history, "hero");
  assert.equal(spots.length, 2);
  assert.equal(spots[0].street, "preflop");
  assert.equal(spots[0].toCall, 40);
  assert.deepEqual(spots[0].holeCards, ["As", "Ah"]);
  assert.deepEqual(spots[0].board, []);
  assert.equal(spots[1].street, "flop");
  assert.equal(spots[1].potBefore, 120);
  assert.deepEqual(spots[1].board, ["2s", "7h", "9c"]);
});

test("builds review summary with net result and decision list", () => {
  const state = createHandState({
    players: [{ id: "hero", stack: 1000 }, { id: "villain", stack: 1000 }],
    deck: [
      card("A", "s"), card("K", "c"),
      card("A", "h"), card("Q", "d"),
      card("2", "s"), card("7", "h"), card("9", "c"), card("J", "s"), card("K", "d"),
    ],
    dealer: 0,
  });
  applyPlayerAction(state, "hero", "raise", 100);
  applyPlayerAction(state, "villain", "call");

  const summary = toReviewSummary(serializeHandHistory(state), "hero");
  assert.equal(summary.playerId, "hero");
  assert.equal(summary.decisions.length, 1);
  assert.equal(summary.committed, 100);
  assert.equal(summary.net, summary.endingStack - summary.startingStack);
});

test("converts a decision spot to a stable solver-facing shape", () => {
  const spot = {
    playerId: "hero",
    seat: 0,
    street: "flop",
    holeCards: ["As", "Ah"],
    board: ["2s", "7h", "9c"],
    potBefore: 120,
    currentBetBefore: 0,
    playerBetBefore: 0,
    stackBefore: 960,
    toCall: 0,
    action: "check",
    targetBet: 0,
    paid: 0,
  };
  const solverSpot = toSolverSpot(spot);
  assert.equal(solverSpot.game, "nlhe");
  assert.equal(solverSpot.pot, 120);
  assert.deepEqual(solverSpot.hero.holeCards, ["As", "Ah"]);
  assert.equal(solverSpot.actionTaken.action, "check");
});

console.log("all review tests passed");
