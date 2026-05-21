import {
  activePlayers,
  applyBetOrRaise,
  blindIndexes,
  canAct,
  commitChips,
  distributeShowdownPots,
  evaluateSeven,
  firstPostflopActor,
  firstPreflopActor,
  isStreetComplete,
  minRaiseTo,
  shouldRunOutToShowdown,
  totalChips,
} from "./rules.js";

export const STREETS = ["preflop", "flop", "turn", "river", "showdown"];

export function createHandState({ players, deck, dealer = 0, smallBlind = 20, bigBlind = 40 }) {
  if (!players || players.length < 2) throw new Error("At least two players are required");
  if (!deck || deck.length < players.length * 2 + 5) throw new Error("Deck does not contain enough cards");

  const state = {
    players: players.map((player, seat) => ({
      name: player.name || player.id,
      ...player,
      seat,
      stack: player.stack,
      startingStack: player.stack,
      committed: 0,
      bet: 0,
      cards: [],
      folded: false,
      allIn: false,
      acted: false,
      handRank: null,
    })),
    deck: [...deck],
    board: [],
    dealer,
    smallBlind,
    bigBlind,
    street: "preflop",
    pot: 0,
    currentBet: bigBlind,
    lastFullRaise: bigBlind,
    activeIndex: firstPreflopActor(dealer, players.length),
    handActive: true,
    log: [],
    history: [],
    result: null,
  };

  dealHoleCards(state);
  const blinds = blindIndexes(dealer, state.players.length);
  postBlind(state, blinds.smallBlind, smallBlind);
  postBlind(state, blinds.bigBlind, bigBlind);
  return state;
}

export function applyPlayerAction(state, playerId, action, targetBet = 0) {
  if (!state.handActive) throw new Error("Hand is already complete");
  const player = state.players[state.activeIndex];
  if (!player || player.id !== playerId) throw new Error(`It is not ${playerId}'s turn`);
  if (!needsAction(player, state.currentBet)) throw new Error(`${playerId} does not need to act`);

  const toCall = Math.max(0, state.currentBet - player.bet);
  const before = actionSnapshot(state, player, action, targetBet);
  if (action === "fold") {
    player.folded = true;
    player.acted = true;
    state.log.push(`${player.id} folds`);
  } else if (action === "check") {
    if (toCall > 0) throw new Error("Cannot check facing a bet");
    player.acted = true;
    state.log.push(`${player.id} checks`);
  } else if (action === "call") {
    const paid = commitToPot(state, player, toCall);
    player.acted = true;
    state.log.push(`${player.id} ${paid ? `calls ${paid}` : "checks"}`);
  } else if (action === "raise") {
    if (player.acted && player.bet < state.currentBet) {
      throw new Error("Action was not reopened by a full raise");
    }
    validateRaiseTarget(state, player, targetBet);
    const result = applyBetOrRaise({
      player,
      targetBet,
      currentBet: state.currentBet,
      lastFullRaise: state.lastFullRaise,
      bigBlind: state.bigBlind,
    });
    state.pot += result.paid;
    state.currentBet = result.nextCurrentBet;
    state.lastFullRaise = result.nextLastFullRaise;
    if (result.isFullRaise) resetActedAfterFullRaise(state, player);
    else player.acted = true;
    state.log.push(`${player.id} raises to ${player.bet}`);
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  recordAction(state, before, player);
  progressHand(state);
  return state;
}

export function getLegalActions(state) {
  if (!state.handActive) return { actions: [], reason: "hand-complete" };
  const player = state.players[state.activeIndex];
  if (!needsAction(player, state.currentBet)) return { playerId: player?.id, actions: [], reason: "no-action-needed" };
  const toCall = Math.max(0, state.currentBet - player.bet);
  const maxTarget = player.bet + player.stack;
  const minRaise = minRaiseTo(state.currentBet, state.lastFullRaise, state.bigBlind);
  const canFullRaise = maxTarget >= minRaise;
  const canAllInRaise = maxTarget > state.currentBet && maxTarget < minRaise;
  return {
    playerId: player.id,
    street: state.street,
    toCall,
    currentBet: state.currentBet,
    minRaiseTo: canFullRaise ? minRaise : null,
    maxRaiseTo: maxTarget,
    actions: [
      ...(toCall > 0 ? ["fold", "call"] : ["check"]),
      ...(canFullRaise || canAllInRaise ? ["raise"] : []),
    ],
  };
}

export function progressHand(state) {
  const active = activePlayers(state.players);
  if (active.length === 1) {
    finishByFold(state, active[0]);
    return state;
  }

  if (shouldRunOutToShowdown(state.players, state.currentBet)) {
    runOutToShowdown(state);
    return state;
  }

  if (isStreetComplete(state.players, state.currentBet)) {
    advanceStreet(state);
    return state;
  }

  state.activeIndex = nextActor(state, state.activeIndex);
  return state;
}

export function chipTotal(state) {
  return totalChips(state.players, state.pot);
}

export function serializeHandHistory(state) {
  return {
    version: 1,
    game: "nlhe",
    blinds: { small: state.smallBlind, big: state.bigBlind },
    dealerSeat: state.dealer,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      startingStack: player.startingStack,
      endingStack: player.stack,
      committed: player.committed,
      holeCards: player.cards.map(cardText),
      folded: player.folded,
      allIn: player.allIn,
    })),
    board: state.board.map(cardText),
    actions: state.history,
    result: state.result ? {
      type: state.result.type,
      winnerId: state.result.primaryWinner?.id,
      summary: state.result.summary,
      awards: state.result.awards ? Object.fromEntries(state.result.awards) : undefined,
    } : null,
  };
}

function dealHoleCards(state) {
  for (let round = 0; round < 2; round += 1) {
    for (const player of state.players) {
      player.cards.push(state.deck.shift());
    }
  }
}

function postBlind(state, index, amount) {
  const paid = commitToPot(state, state.players[index], amount);
  state.players[index].acted = false;
  state.log.push(`${state.players[index].id} posts ${paid}`);
  recordEvent(state, "blind", {
    playerId: state.players[index].id,
    amount: paid,
    betAfter: state.players[index].bet,
    potAfter: state.pot,
  });
}

function commitToPot(state, player, amount) {
  const paid = commitChips(player, amount);
  state.pot += paid;
  return paid;
}

function needsAction(player, currentBet) {
  return canAct(player) && (!player.acted || player.bet < currentBet);
}

function nextActor(state, from) {
  let index = (from + 1) % state.players.length;
  for (let tries = 0; tries < state.players.length; tries += 1) {
    if (needsAction(state.players[index], state.currentBet)) return index;
    index = (index + 1) % state.players.length;
  }
  return index;
}

function resetActedAfterFullRaise(state, actor) {
  for (const player of state.players) {
    if (canAct(player)) player.acted = false;
  }
  actor.acted = true;
}

function advanceStreet(state) {
  if (state.street === "preflop") {
    state.board.push(state.deck.shift(), state.deck.shift(), state.deck.shift());
    state.street = "flop";
    recordEvent(state, "street", { street: state.street, board: state.board.map(cardText) });
  } else if (state.street === "flop") {
    state.board.push(state.deck.shift());
    state.street = "turn";
    recordEvent(state, "street", { street: state.street, board: state.board.map(cardText) });
  } else if (state.street === "turn") {
    state.board.push(state.deck.shift());
    state.street = "river";
    recordEvent(state, "street", { street: state.street, board: state.board.map(cardText) });
  } else {
    showdown(state);
    return;
  }

  state.currentBet = 0;
  state.lastFullRaise = state.bigBlind;
  for (const player of state.players) {
    player.bet = 0;
    player.acted = false;
  }
  state.activeIndex = firstPostflopActor(state.dealer, state.players);
}

function runOutToShowdown(state) {
  while (state.board.length < 5) {
    state.board.push(state.deck.shift());
  }
  recordEvent(state, "runout", { board: state.board.map(cardText) });
  showdown(state);
}

function showdown(state) {
  for (const player of activePlayers(state.players)) {
    player.handRank = evaluateSeven([...player.cards, ...state.board]);
  }
  const result = distributeShowdownPots(state.players);
  for (const player of state.players) {
    player.stack += result.awards.get(player.id) || 0;
  }
  state.pot = 0;
  state.street = "showdown";
  state.handActive = false;
  state.result = {
    type: "showdown",
    ...result,
  };
  recordEvent(state, "showdown", {
    board: state.board.map(cardText),
    winnerId: result.primaryWinner?.id,
    awards: Object.fromEntries(result.awards),
    summary: result.summary,
  });
}

function finishByFold(state, winner) {
  winner.stack += state.pot;
  state.pot = 0;
  state.handActive = false;
  state.result = {
    type: "fold",
    primaryWinner: winner,
    summary: `${winner.id} wins uncontested`,
  };
  recordEvent(state, "finish", {
    reason: "fold",
    winnerId: winner.id,
    summary: state.result.summary,
  });
}

function validateRaiseTarget(state, player, targetBet) {
  const maxTarget = player.bet + player.stack;
  if (targetBet <= state.currentBet) throw new Error("Raise target must exceed the current bet");
  const fullRaiseTo = minRaiseTo(state.currentBet, state.lastFullRaise, state.bigBlind);
  if (targetBet < fullRaiseTo && maxTarget >= fullRaiseTo) {
    throw new Error("Raise target is below the minimum legal raise");
  }
}

function actionSnapshot(state, player, action, targetBet) {
  return {
    type: "action",
    playerId: player.id,
    action,
    targetBet,
    street: state.street,
    potBefore: state.pot,
    betBefore: player.bet,
    stackBefore: player.stack,
    committedBefore: player.committed,
    currentBetBefore: state.currentBet,
    toCallBefore: Math.max(0, state.currentBet - player.bet),
    board: state.board.map(cardText),
  };
}

function recordAction(state, before, player) {
  recordEvent(state, "action", {
    ...before,
    paid: player.committed - before.committedBefore,
    betAfter: player.bet,
    stackAfter: player.stack,
    potAfter: state.pot,
    currentBetAfter: state.currentBet,
  });
}

function recordEvent(state, type, data) {
  state.history.push({
    seq: state.history.length + 1,
    type,
    street: state.street,
    ...data,
  });
}

function cardText(card) {
  return `${card.id}${card.suit}`;
}
