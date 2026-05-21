import assert from "node:assert/strict";
import { applyPlayerAction, chipTotal, createHandState, getLegalActions, serializeHandHistory } from "../engine.js";

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

function basePlayers(stacks = [1000, 1000, 1000]) {
  return stacks.map((stack, index) => ({ id: `p${index}`, stack }));
}

function deterministicDeck() {
  return [
    card("A", "s"), card("K", "c"), card("5", "c"),
    card("A", "h"), card("Q", "d"), card("6", "d"),
    card("2", "s"), card("7", "h"), card("9", "c"), card("J", "s"), card("K", "d"),
    card("3", "s"), card("4", "h"), card("8", "d"), card("T", "c"), card("Q", "s"),
  ];
}

test("plays a complete checked-down three-player hand through river showdown", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  const before = chipTotal(state);

  assert.equal(state.activeIndex, 0);
  applyPlayerAction(state, "p0", "call");
  applyPlayerAction(state, "p1", "call");
  applyPlayerAction(state, "p2", "check");
  assert.equal(state.street, "flop");
  assert.equal(state.board.length, 3);
  assert.equal(state.activeIndex, 1);

  applyPlayerAction(state, "p1", "check");
  applyPlayerAction(state, "p2", "check");
  applyPlayerAction(state, "p0", "check");
  assert.equal(state.street, "turn");
  assert.equal(state.board.length, 4);

  applyPlayerAction(state, "p1", "check");
  applyPlayerAction(state, "p2", "check");
  applyPlayerAction(state, "p0", "check");
  assert.equal(state.street, "river");
  assert.equal(state.board.length, 5);

  applyPlayerAction(state, "p1", "check");
  applyPlayerAction(state, "p2", "check");
  applyPlayerAction(state, "p0", "check");
  assert.equal(state.street, "showdown");
  assert.equal(state.handActive, false);
  assert.equal(state.result.primaryWinner.id, "p0");
  assert.equal(chipTotal(state), before);
});

test("preserves big blind option when everyone only calls preflop", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  applyPlayerAction(state, "p0", "call");
  applyPlayerAction(state, "p1", "call");
  assert.equal(state.street, "preflop");
  assert.equal(state.activeIndex, 2);
  applyPlayerAction(state, "p2", "check");
  assert.equal(state.street, "flop");
});

test("short all-in raise does not reopen betting to an already-acted player", () => {
  const state = createHandState({ players: basePlayers([1000, 1000, 150]), deck: deterministicDeck(), dealer: 0 });
  applyPlayerAction(state, "p0", "raise", 120);
  applyPlayerAction(state, "p1", "call");
  applyPlayerAction(state, "p2", "raise", 150);
  assert.equal(state.activeIndex, 0);
  assert.throws(() => applyPlayerAction(state, "p0", "raise", 300), /not reopened/i);
  applyPlayerAction(state, "p0", "call");
  applyPlayerAction(state, "p1", "call");
  assert.equal(state.street, "flop");
});

test("heads-up all-in hand runs out to showdown and conserves chips", () => {
  const deck = [
    card("A", "s"), card("K", "c"),
    card("A", "h"), card("Q", "d"),
    card("2", "s"), card("7", "h"), card("9", "c"), card("J", "s"), card("K", "d"),
  ];
  const state = createHandState({ players: basePlayers([100, 100]), deck, dealer: 0 });
  const before = chipTotal(state);
  assert.equal(state.activeIndex, 0);
  applyPlayerAction(state, "p0", "raise", 100);
  applyPlayerAction(state, "p1", "call");
  assert.equal(state.street, "showdown");
  assert.equal(state.board.length, 5);
  assert.equal(state.handActive, false);
  assert.equal(chipTotal(state), before);
});

test("rejects out-of-turn and illegal check actions", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  assert.throws(() => applyPlayerAction(state, "p1", "call"), /not p1's turn/i);
  assert.throws(() => applyPlayerAction(state, "p0", "check"), /cannot check/i);
});

test("exposes legal actions with call amount and raise bounds", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  const legal = getLegalActions(state);
  assert.equal(legal.playerId, "p0");
  assert.equal(legal.toCall, 40);
  assert.deepEqual(legal.actions, ["fold", "call", "raise"]);
  assert.equal(legal.minRaiseTo, 80);
  assert.equal(legal.maxRaiseTo, 1000);
});

test("rejects below-minimum raises when player can make a legal full raise", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  assert.throws(() => applyPlayerAction(state, "p0", "raise", 60), /minimum legal raise/i);
});

test("records structured hand history for accurate review export", () => {
  const state = createHandState({ players: basePlayers(), deck: deterministicDeck(), dealer: 0 });
  applyPlayerAction(state, "p0", "call");
  applyPlayerAction(state, "p1", "call");
  applyPlayerAction(state, "p2", "check");

  const history = serializeHandHistory(state);
  assert.equal(history.version, 1);
  assert.equal(history.players.length, 3);
  assert.deepEqual(history.board, ["2s", "7h", "9c"]);
  assert.equal(history.actions[0].type, "blind");
  assert.equal(history.actions[2].type, "action");
  assert.equal(history.actions[2].playerId, "p0");
  assert.equal(history.actions[2].action, "call");
  assert.equal(history.actions[2].paid, 40);
  assert.equal(history.actions.at(-1).type, "street");
  assert.equal(history.actions.at(-1).street, "flop");
});

console.log("all engine tests passed");
