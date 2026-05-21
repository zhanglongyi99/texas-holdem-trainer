import assert from "node:assert/strict";
import {
  activePlayers,
  canAct,
  compareRanks,
  decisionPlayers,
  distributeShowdownPots,
  evaluateSeven,
  isStreetComplete,
  shouldRunOutToShowdown,
} from "../rules.js";

const card = (rank, suit = "s") => ({ id: String(rank), value: rankValue(rank), suit });

function rankValue(rank) {
  return { T: 10, J: 11, Q: 12, K: 13, A: 14 }[rank] || Number(rank);
}

function player(overrides) {
  return {
    id: overrides.id,
    name: overrides.name || overrides.id,
    stack: 1000,
    committed: 0,
    bet: 0,
    folded: false,
    allIn: false,
    acted: false,
    handRank: null,
    ...overrides,
  };
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

test("filters active and decision players correctly", () => {
  const players = [
    player({ id: "a" }),
    player({ id: "b", folded: true }),
    player({ id: "c", allIn: true, stack: 0 }),
  ];
  assert.equal(canAct(players[0]), true);
  assert.equal(canAct(players[1]), false);
  assert.deepEqual(activePlayers(players).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(decisionPlayers(players).map((p) => p.id), ["a"]);
});

test("street is complete only after all actors acted and matched the current bet", () => {
  const players = [
    player({ id: "a", bet: 100, acted: true }),
    player({ id: "b", bet: 100, acted: true }),
  ];
  assert.equal(isStreetComplete(players, 100), true);
  players[1].acted = false;
  assert.equal(isStreetComplete(players, 100), false);
  players[1].acted = true;
  players[1].bet = 60;
  assert.equal(isStreetComplete(players, 100), false);
});

test("does not run out when the only remaining actor still owes a call", () => {
  const players = [
    player({ id: "a", allIn: true, stack: 0, bet: 200 }),
    player({ id: "b", bet: 100, acted: false }),
  ];
  assert.equal(shouldRunOutToShowdown(players, 200), false);
});

test("runs out when all unresolved betting decisions are closed", () => {
  const allInPlayers = [
    player({ id: "a", allIn: true, stack: 0, bet: 200 }),
    player({ id: "b", allIn: true, stack: 0, bet: 200 }),
  ];
  assert.equal(shouldRunOutToShowdown(allInPlayers, 200), true);

  const oneActorMatched = [
    player({ id: "a", allIn: true, stack: 0, bet: 200 }),
    player({ id: "b", bet: 200, acted: true }),
  ];
  assert.equal(shouldRunOutToShowdown(oneActorMatched, 200), true);
});

test("evaluates wheel straight, flush, full house, and kicker comparisons", () => {
  const wheel = evaluateSeven([card("A", "s"), card("2", "h"), card("3", "d"), card("4", "c"), card("5", "s"), card("9", "h"), card("K", "d")]);
  assert.equal(wheel.name, "顺子");
  assert.equal(wheel.tiebreakers[0], 5);

  const flush = evaluateSeven([card("A", "h"), card("9", "h"), card("7", "h"), card("4", "h"), card("2", "h"), card("K", "s"), card("3", "d")]);
  const fullHouse = evaluateSeven([card("K"), card("K", "h"), card("K", "d"), card("2"), card("2", "c"), card("9"), card("4")]);
  assert.equal(compareRanks(fullHouse, flush) > 0, true);

  const pairA = evaluateSeven([card("A"), card("A", "h"), card("K"), card("Q"), card("9"), card("4"), card("2")]);
  const pairB = evaluateSeven([card("A"), card("A", "d"), card("K"), card("J"), card("9"), card("4"), card("2")]);
  assert.equal(compareRanks(pairA, pairB) > 0, true);
});

test("distributes main pot and side pot by committed amounts", () => {
  const players = [
    player({ id: "short", name: "Short", committed: 100, handRank: { category: 8, tiebreakers: [14], name: "同花顺" } }),
    player({ id: "mid", name: "Mid", committed: 200, handRank: { category: 1, tiebreakers: [14, 13, 12, 9], name: "一对" } }),
    player({ id: "big", name: "Big", committed: 200, handRank: { category: 4, tiebreakers: [9], name: "顺子" } }),
  ];
  const result = distributeShowdownPots(players);
  assert.equal(result.awards.get("short"), 300);
  assert.equal(result.awards.get("big"), 200);
  assert.equal(result.awards.get("mid") || 0, 0);
  assert.equal(result.primaryWinner.id, "short");
});

test("includes folded contributions in pots but excludes folded players from winning", () => {
  const players = [
    player({ id: "folded", committed: 100, folded: true, handRank: { category: 8, tiebreakers: [14], name: "同花顺" } }),
    player({ id: "hero", committed: 100, handRank: { category: 0, tiebreakers: [14], name: "高牌" } }),
    player({ id: "villain", committed: 100, handRank: { category: 1, tiebreakers: [2], name: "一对" } }),
  ];
  const result = distributeShowdownPots(players);
  assert.equal(result.awards.get("villain"), 300);
  assert.equal(result.awards.has("folded"), false);
});

console.log("all rules tests passed");
