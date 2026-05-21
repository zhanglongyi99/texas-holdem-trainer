export function canAct(player) {
  return player && !player.folded && !player.allIn && player.stack > 0;
}

export function activePlayers(players) {
  return players.filter((player) => !player.folded);
}

export function decisionPlayers(players) {
  return players.filter(canAct);
}

export function isStreetComplete(players, currentBet) {
  const actors = decisionPlayers(players);
  if (!actors.length) return false;
  return actors.every((player) => player.acted && (player.bet === currentBet || player.stack === 0));
}

export function shouldRunOutToShowdown(players, currentBet) {
  const active = activePlayers(players);
  const actors = decisionPlayers(players);
  if (active.length <= 1) return false;
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    const actor = actors[0];
    return currentBet === 0 || actor.bet === currentBet;
  }
  return false;
}

export function minRaiseTo(currentBet, lastFullRaise, bigBlind) {
  if (currentBet <= 0) return bigBlind;
  return currentBet + Math.max(lastFullRaise, bigBlind);
}

export function applyBetOrRaise({ player, targetBet, currentBet, lastFullRaise, bigBlind }) {
  if (!canAct(player)) {
    throw new Error("Player cannot bet or raise");
  }
  const previousBet = player.bet;
  const legalFullRaiseTo = minRaiseTo(currentBet, lastFullRaise, bigBlind);
  const cappedTarget = Math.min(Math.max(targetBet, currentBet || bigBlind), previousBet + player.stack);
  const paid = commitChips(player, cappedTarget - previousBet);
  const raiseSize = player.bet - currentBet;
  const isAggressive = player.bet > currentBet;
  const isFullRaise = isAggressive && player.bet >= legalFullRaiseTo;
  const nextCurrentBet = Math.max(currentBet, player.bet);
  const nextLastFullRaise = isFullRaise ? raiseSize : lastFullRaise;

  return {
    paid,
    isAggressive,
    isFullRaise,
    raiseSize,
    nextCurrentBet,
    nextLastFullRaise,
  };
}

export function commitChips(player, amount) {
  if (amount < 0) {
    throw new Error("Cannot commit a negative chip amount");
  }
  const paid = Math.min(player.stack, Math.max(0, Math.round(amount)));
  player.stack -= paid;
  player.bet += paid;
  player.committed += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

export function nextSeat(from, seats, offset = 1) {
  return (from + offset) % seats;
}

export function firstPreflopActor(dealer, seats) {
  if (seats === 2) return dealer;
  return nextSeat(dealer, seats, 3);
}

export function firstPostflopActor(dealer, players) {
  let index = nextSeat(dealer, players.length);
  for (let tries = 0; tries < players.length; tries += 1) {
    if (canAct(players[index])) return index;
    index = nextSeat(index, players.length);
  }
  return index;
}

export function blindIndexes(dealer, seats) {
  if (seats < 2) throw new Error("At least two seats are required");
  if (seats === 2) {
    return { smallBlind: dealer, bigBlind: nextSeat(dealer, seats) };
  }
  return {
    smallBlind: nextSeat(dealer, seats),
    bigBlind: nextSeat(dealer, seats, 2),
  };
}

export function totalChips(players, pot = 0) {
  return players.reduce((sum, player) => sum + player.stack, pot);
}

export function evaluateSeven(cards) {
  if (cards.length < 5) {
    return {
      category: 0,
      tiebreakers: cards.map((card) => card.value).sort((a, b) => b - a),
      name: "高牌",
    };
  }
  return combinations(cards, 5).map(evaluateFive).sort(compareRanks).at(-1);
}

export function compareRanks(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

export function distributeShowdownPots(players) {
  const awards = new Map();
  const summaries = [];
  const levels = [...new Set(players.map((player) => player.committed).filter((amount) => amount > 0))].sort((a, b) => a - b);
  let previous = 0;

  for (const level of levels) {
    const participants = players.filter((player) => player.committed >= level);
    const eligible = participants.filter((player) => !player.folded);
    const contribution = level - previous;
    const amount = contribution * participants.length;
    previous = level;
    if (!amount) continue;
    if (!eligible.length) {
      for (const participant of participants) {
        awards.set(participant.id, (awards.get(participant.id) || 0) + contribution);
      }
      continue;
    }

    const best = eligible.map((player) => player.handRank).sort(compareRanks).at(-1);
    const winners = eligible.filter((player) => compareRanks(player.handRank, best) === 0);
    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    for (const winner of winners) {
      const paid = share + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      awards.set(winner.id, (awards.get(winner.id) || 0) + paid);
    }
  }

  for (const player of players) {
    const amount = awards.get(player.id) || 0;
    if (amount > 0) summaries.push(`${player.name} 以 ${player.handRank.name} 赢得 ${amount}`);
  }

  const primaryWinner = [...players].sort((a, b) => (awards.get(b.id) || 0) - (awards.get(a.id) || 0))[0];
  return {
    awards,
    primaryWinner,
    heroWon: (awards.get("hero") || 0) > 0,
    summary: summaries.join("；") || "摊牌无人获得底池",
  };
}

function evaluateFive(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const counts = countBy(values);
  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = getStraightHigh(values);
  if (flush && straightHigh) return rank(8, [straightHigh], "同花顺");
  if (groups[0].count === 4) return rank(7, [groups[0].value, kicker(values, [groups[0].value])], "四条");
  if (groups[0].count === 3 && groups[1]?.count === 2) return rank(6, [groups[0].value, groups[1].value], "葫芦");
  if (flush) return rank(5, values, "同花");
  if (straightHigh) return rank(4, [straightHigh], "顺子");
  if (groups[0].count === 3) return rank(3, [groups[0].value, ...kickers(values, [groups[0].value], 2)], "三条");
  if (groups[0].count === 2 && groups[1]?.count === 2) {
    return rank(2, [groups[0].value, groups[1].value, kicker(values, [groups[0].value, groups[1].value])], "两对");
  }
  if (groups[0].count === 2) return rank(1, [groups[0].value, ...kickers(values, [groups[0].value], 3)], "一对");
  return rank(0, values, "高牌");
}

function rank(category, tiebreakers, name) {
  return { category, tiebreakers, name };
}

function getStraightHigh(values) {
  const unique = [...new Set(values)];
  if (unique.includes(14)) unique.push(1);
  unique.sort((a, b) => b - a);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) return slice[0];
  }
  return 0;
}

function combinations(items, size) {
  const result = [];
  const walk = (start, combo) => {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i < items.length; i += 1) walk(i + 1, [...combo, items[i]]);
  };
  walk(0, []);
  return result;
}

function kicker(values, excluded) {
  return values.find((value) => !excluded.includes(value)) || 0;
}

function kickers(values, excluded, amount) {
  return values.filter((value) => !excluded.includes(value)).slice(0, amount);
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}
