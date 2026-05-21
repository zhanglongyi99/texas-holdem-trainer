const STAGES = ["preflop", "flop", "turn", "river", "showdown"];
const STAGE_LABELS = {
  preflop: "翻前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
};

const SUITS = [
  { id: "s", symbol: "♠", red: false },
  { id: "h", symbol: "♥", red: true },
  { id: "d", symbol: "♦", red: true },
  { id: "c", symbol: "♣", red: false },
];
const RANKS = [
  { id: "2", value: 2 },
  { id: "3", value: 3 },
  { id: "4", value: 4 },
  { id: "5", value: 5 },
  { id: "6", value: 6 },
  { id: "7", value: 7 },
  { id: "8", value: 8 },
  { id: "9", value: 9 },
  { id: "T", value: 10 },
  { id: "J", value: 11 },
  { id: "Q", value: 12 },
  { id: "K", value: 13 },
  { id: "A", value: 14 },
];

const SEAT_POSITIONS = [
  { left: "43%", top: "6%" },
  { left: "70%", top: "16%" },
  { left: "75%", top: "67%" },
  { left: "43%", top: "77%" },
  { left: "8%", top: "67%" },
  { left: "5%", top: "16%" },
];

const PLAYERS = [
  { id: "coach", name: "稳健 AI", style: "tight" },
  { id: "loose", name: "松凶 AI", style: "loose" },
  { id: "math", name: "数学 AI", style: "math" },
  { id: "hero", name: "你", style: "hero" },
  { id: "calm", name: "跟注 AI", style: "caller" },
  { id: "wild", name: "娱乐 AI", style: "wild" },
];

const els = {
  players: document.querySelector("#players"),
  boardCards: document.querySelector("#boardCards"),
  heroCards: document.querySelector("#heroCards"),
  potAmount: document.querySelector("#potAmount"),
  heroStack: document.querySelector("#heroStack"),
  heroStackTop: document.querySelector("#heroStackTop"),
  stageLabel: document.querySelector("#stageLabel"),
  coachHint: document.querySelector("#coachHint"),
  reviewCards: document.querySelector("#reviewCards"),
  handLog: document.querySelector("#handLog"),
  handsPlayed: document.querySelector("#handsPlayed"),
  coachScore: document.querySelector("#coachScore"),
  decisionQuality: document.querySelector("#decisionQuality"),
  newHandBtn: document.querySelector("#newHandBtn"),
  foldBtn: document.querySelector("#foldBtn"),
  checkCallBtn: document.querySelector("#checkCallBtn"),
  raiseBtn: document.querySelector("#raiseBtn"),
  raiseSize: document.querySelector("#raiseSize"),
  raiseSizeLabel: document.querySelector("#raiseSizeLabel"),
  copyLogBtn: document.querySelector("#copyLogBtn"),
};

let state = createEmptyState();

function createEmptyState() {
  return {
    deck: [],
    board: [],
    players: PLAYERS.map((player, index) => ({
      ...player,
      seat: index,
      stack: 2000,
      bet: 0,
      acted: false,
      cards: [],
      folded: false,
      allIn: false,
      lastAction: "等待",
    })),
    dealer: 0,
    stageIndex: 0,
    pot: 0,
    currentBet: 0,
    activeIndex: 0,
    handActive: false,
    waitingForHero: false,
    log: [],
    handsPlayed: Number(localStorage.getItem("trainerHands") || 0),
    totalScore: Number(localStorage.getItem("trainerScore") || 0),
    decisions: Number(localStorage.getItem("trainerDecisions") || 0),
  };
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ ...rank, suit: suit.id, symbol: suit.symbol, red: suit.red });
    }
  }
  return shuffle(deck);
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startHand() {
  const previousHeroStack = state.players.find((player) => player.id === "hero")?.stack || 2000;
  state.deck = buildDeck();
  state.board = [];
  state.players = PLAYERS.map((player, index) => ({
    ...player,
    seat: index,
    stack: player.id === "hero" ? Math.max(400, previousHeroStack) : 2000,
    bet: 0,
    acted: false,
    cards: [state.deck.pop(), state.deck.pop()],
    folded: false,
    allIn: false,
    lastAction: "入局",
  }));
  state.dealer = (state.dealer + 1) % state.players.length;
  state.stageIndex = 0;
  state.pot = 0;
  state.currentBet = 40;
  state.activeIndex = nextSeat(state.dealer, 3);
  state.handActive = true;
  state.waitingForHero = false;
  state.log = [];
  postBlind(nextSeat(state.dealer, 1), 20, "小盲");
  postBlind(nextSeat(state.dealer, 2), 40, "大盲");
  log(`新手牌开始，庄位：${state.players[state.dealer].name}`);
  reviewDefault();
  render();
  runUntilHero();
}

function postBlind(index, amount, label) {
  const player = state.players[index];
  const posted = Math.min(player.stack, amount);
  player.stack -= posted;
  player.bet += posted;
  state.pot += posted;
  player.lastAction = `${label} ${posted}`;
  log(`${player.name} 支付${label} ${posted}`);
}

function nextSeat(from, offset = 1) {
  return (from + offset) % state.players.length;
}

function activePlayers() {
  return state.players.filter((player) => !player.folded && (player.stack > 0 || player.bet > 0));
}

function playersInDecision() {
  return state.players.filter((player) => !player.folded && !player.allIn);
}

function runUntilHero() {
  if (!state.handActive) return;

  const active = activePlayers();
  if (active.length === 1) {
    awardPot(active[0], "其他玩家全部弃牌");
    return;
  }

  if (playersInDecision().length <= 1) {
    advanceStreet();
    return;
  }

  if (streetComplete()) {
    advanceStreet();
    return;
  }

  const player = state.players[state.activeIndex];
  if (player.folded || player.allIn || player.stack <= 0) {
    state.activeIndex = nextActionIndex(state.activeIndex);
    runUntilHero();
    return;
  }

  if (player.id === "hero") {
    state.waitingForHero = true;
    updateCoachForHero();
    render();
    return;
  }

  state.waitingForHero = false;
  render();
  window.setTimeout(() => {
    botAction(player);
    state.activeIndex = nextActionIndex(state.activeIndex);
    render();
    window.setTimeout(runUntilHero, 360);
  }, 480);
}

function streetComplete() {
  const contenders = playersInDecision();
  if (contenders.length <= 1) return false;
  return contenders.every((player) => {
    const matchedBet = player.bet === state.currentBet || player.stack === 0;
    return player.acted && matchedBet;
  });
}

function advanceStreet() {
  collectBets();
  const stage = STAGES[state.stageIndex];
  if (stage === "preflop") {
    state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    state.stageIndex = 1;
    log("发出翻牌");
  } else if (stage === "flop") {
    state.board.push(state.deck.pop());
    state.stageIndex = 2;
    log("发出转牌");
  } else if (stage === "turn") {
    state.board.push(state.deck.pop());
    state.stageIndex = 3;
    log("发出河牌");
  } else {
    showdown();
    return;
  }

  state.currentBet = 0;
  for (const player of state.players) {
    player.bet = 0;
    player.acted = false;
  }
  state.activeIndex = nextActionIndex(state.dealer);
  render();
  window.setTimeout(runUntilHero, 500);
}

function collectBets() {
  for (const player of state.players) {
    player.bet = 0;
  }
}

function nextActionIndex(from) {
  let index = nextSeat(from);
  for (let tries = 0; tries < state.players.length; tries += 1) {
    const player = state.players[index];
    if (!player.folded && !player.allIn && player.stack > 0) return index;
    index = nextSeat(index);
  }
  return index;
}

function botAction(player) {
  const toCall = Math.max(0, state.currentBet - player.bet);
  const strength = estimateStrength(player.cards, state.board);
  const looseness = {
    tight: -0.12,
    loose: 0.08,
    math: 0,
    caller: 0.04,
    wild: Math.random() * 0.2 - 0.02,
  }[player.style];
  const adjusted = strength + looseness;

  if (toCall > 0 && adjusted < 0.36 && Math.random() > 0.22) {
    player.folded = true;
    player.acted = true;
    player.lastAction = "弃牌";
    log(`${player.name} 弃牌`);
    return;
  }

  const canRaise = player.stack > toCall + 80;
  if (canRaise && adjusted > 0.68 && Math.random() > 0.36) {
    const target = Math.min(player.bet + toCall + Math.round(state.pot * 0.55), player.bet + player.stack);
    commitToBet(player, Math.max(target, state.currentBet + 80));
    markActed(player, true);
    player.lastAction = `加注到 ${player.bet}`;
    log(`${player.name} 加注到 ${player.bet}`);
    return;
  }

  if (toCall > 0) {
    commitChips(player, toCall);
    player.acted = true;
    player.lastAction = `跟注 ${toCall}`;
    log(`${player.name} 跟注 ${toCall}`);
  } else {
    player.lastAction = "过牌";
    player.acted = true;
    log(`${player.name} 过牌`);
  }
}

function heroAction(kind) {
  if (!state.waitingForHero || !state.handActive) return;

  const hero = state.players.find((player) => player.id === "hero");
  const toCall = Math.max(0, state.currentBet - hero.bet);
  const advice = getAdvice(hero);

  if (kind === "fold") {
    hero.folded = true;
    hero.acted = true;
    hero.lastAction = "弃牌";
    log(`你弃牌`);
    scoreDecision(kind, advice.best);
  }

  if (kind === "call") {
    if (toCall > 0) {
      commitChips(hero, toCall);
      hero.acted = true;
      hero.lastAction = `跟注 ${toCall}`;
      log(`你跟注 ${toCall}`);
    } else {
      hero.lastAction = "过牌";
      hero.acted = true;
      log("你过牌");
    }
    scoreDecision(kind, advice.best);
  }

  if (kind === "raise") {
    const multiplier = Number(els.raiseSize.value);
    const raiseTo = state.currentBet === 0
      ? Math.min(hero.bet + Math.max(60, Math.round(state.pot * 0.55)), hero.bet + hero.stack)
      : Math.min(state.currentBet * multiplier, hero.bet + hero.stack);
    commitToBet(hero, Math.max(raiseTo, state.currentBet + 60));
    markActed(hero, true);
    hero.lastAction = `加注到 ${hero.bet}`;
    log(`你加注到 ${hero.bet}`);
    scoreDecision(kind, advice.best);
  }

  state.waitingForHero = false;
  state.activeIndex = nextActionIndex(state.activeIndex);
  render();
  window.setTimeout(runUntilHero, 440);
}

function scoreDecision(actual, best) {
  let delta = 55;
  if (actual === best) delta = 92;
  if ((best === "raise" && actual === "call") || (best === "call" && actual === "raise")) delta = 72;
  if (best === "fold" && actual === "raise") delta = 38;
  state.totalScore += delta;
  state.decisions += 1;
  localStorage.setItem("trainerScore", String(state.totalScore));
  localStorage.setItem("trainerDecisions", String(state.decisions));

  const quality = delta >= 85 ? "good" : delta >= 65 ? "warn" : "bad";
  els.decisionQuality.className = `pill ${quality}`;
  els.decisionQuality.textContent = delta >= 85 ? "清晰选择" : delta >= 65 ? "可以接受" : "偏离建议";
}

function commitChips(player, amount) {
  const paid = Math.min(player.stack, amount);
  player.stack -= paid;
  player.bet += paid;
  state.pot += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

function commitToBet(player, targetBet) {
  const needed = Math.max(0, targetBet - player.bet);
  commitChips(player, needed);
  state.currentBet = Math.max(state.currentBet, player.bet);
}

function markActed(actor, wasRaise = false) {
  if (wasRaise) {
    for (const player of state.players) {
      if (!player.folded && !player.allIn && player.stack > 0) player.acted = false;
    }
  }
  actor.acted = true;
}

function showdown() {
  state.stageIndex = 4;
  const contenders = activePlayers();
  let best = null;
  for (const player of contenders) {
    const rank = evaluateSeven([...player.cards, ...state.board]);
    player.handRank = rank;
    if (!best || compareRanks(rank, best.handRank) > 0) best = player;
  }
  awardPot(best, `${best.name} 以 ${best.handRank.name} 赢下底池`);
}

function awardPot(player, reason) {
  player.stack += state.pot;
  log(`${reason}，获得 ${state.pot}`);
  state.pot = 0;
  state.handActive = false;
  state.waitingForHero = false;
  state.handsPlayed += 1;
  localStorage.setItem("trainerHands", String(state.handsPlayed));
  finalReview(player);
  render();
}

function updateCoachForHero() {
  const hero = state.players.find((player) => player.id === "hero");
  const advice = getAdvice(hero);
  els.coachHint.textContent = advice.hint;
  els.reviewCards.innerHTML = advice.reasons
    .map((item) => `<article class="review-item"><strong>${item.title}</strong><p>${item.text}</p></article>`)
    .join("");
  els.checkCallBtn.textContent = state.currentBet > hero.bet ? `跟注 ${state.currentBet - hero.bet}` : "过牌";
}

function getAdvice(hero) {
  const toCall = Math.max(0, state.currentBet - hero.bet);
  const strength = estimateStrength(hero.cards, state.board);
  const potOdds = toCall === 0 ? 0 : toCall / (state.pot + toCall);
  const position = hero.seat === state.dealer ? "按钮位附近" : hero.seat > state.dealer ? "中后位" : "前位";
  let best = "call";

  if (toCall > 0 && strength < potOdds + 0.08) best = "fold";
  if (strength > 0.68 && hero.stack > toCall + 80) best = "raise";
  if (toCall === 0 && strength > 0.58) best = "raise";

  const actionText = {
    fold: "建议弃牌，先保护筹码。",
    call: toCall > 0 ? "建议跟注，价格还算合适。" : "建议过牌，继续观察。",
    raise: "建议加注，用强牌或优势范围施压。",
  }[best];

  return {
    best,
    hint: `${actionText} 当前估算胜率约 ${Math.round(strength * 100)}%，底池赔率约 ${Math.round(potOdds * 100)}%。`,
    reasons: [
      {
        title: "当前牌力",
        text: `你的组合强度估算为 ${Math.round(strength * 100)}%。这不是完整 GTO，只是帮助新手先建立“牌力和价格”的直觉。`,
      },
      {
        title: "底池赔率",
        text: toCall > 0
          ? `你需要支付 ${toCall} 去争夺 ${state.pot + toCall}，需要大约 ${Math.round(potOdds * 100)}% 的胜率。`
          : "当前无需投入更多筹码，可以用过牌控制底池，或用加注拿主动权。",
      },
      {
        title: "位置意识",
        text: `${position}行动。越靠后信息越多，可以适当扩大继续范围；越靠前越要谨慎。`,
      },
    ],
  };
}

function finalReview(winner) {
  const hero = state.players.find((player) => player.id === "hero");
  const won = winner.id === "hero";
  els.coachHint.textContent = won
    ? "这手你赢了。复盘时别只看结果，更要看每一街投入是否有理由。"
    : "这手结束了。输牌不一定是错，重点看行动是否符合牌力、赔率和位置。";
  els.reviewCards.innerHTML = [
    {
      title: won ? "结果" : "本手结果",
      text: won ? "你赢下这手牌。继续观察自己是否因为赢牌而高估了冒险行动。" : `${winner.name} 赢下这手牌。复盘时先看关键决策点，而不是只看河牌结果。`,
    },
    {
      title: "下一步 GTO 接口",
      text: "后续可以把这一手的公共牌、筹码、下注树导出给 TexasSolver，回填每个节点的策略频率和 EV 偏差。",
    },
  ]
    .map((item) => `<article class="review-item"><strong>${item.title}</strong><p>${item.text}</p></article>`)
    .join("");
  if (hero.folded) {
    revealOnlyHero();
  }
}

function reviewDefault() {
  els.decisionQuality.className = "pill";
  els.decisionQuality.textContent = "未行动";
  els.reviewCards.innerHTML = [
    {
      title: "练习目标",
      text: "先学会看三件事：自己的牌力、跟注价格、位置。熟练后再逐步接入更精细的 GTO 频率。",
    },
    {
      title: "AI 对手",
      text: "这一桌包含稳健、松凶、跟注和娱乐型 AI，用来模拟不同新手常见桌况。",
    },
  ]
    .map((item) => `<article class="review-item"><strong>${item.title}</strong><p>${item.text}</p></article>`)
    .join("");
}

function revealOnlyHero() {
  const hero = state.players.find((player) => player.id === "hero");
  hero.lastAction = "已弃牌";
}

function estimateStrength(cards, board) {
  if (board.length === 0) return preflopStrength(cards);
  const known = [...cards, ...board];
  const rank = evaluateSeven(known);
  const made = Math.min(0.92, rank.score / 9000000);
  const highCards = cards.reduce((sum, card) => sum + card.value, 0) / 28;
  return clamp(made * 0.78 + highCards * 0.22 + drawBonus(cards, board), 0.05, 0.96);
}

function preflopStrength(cards) {
  const [a, b] = cards;
  const high = Math.max(a.value, b.value);
  const low = Math.min(a.value, b.value);
  const pair = a.value === b.value ? 0.36 : 0;
  const suited = a.suit === b.suit ? 0.06 : 0;
  const connected = Math.abs(a.value - b.value) <= 2 ? 0.05 : 0;
  return clamp(0.12 + high / 20 + low / 38 + pair + suited + connected, 0.12, 0.94);
}

function drawBonus(cards, board) {
  const all = [...cards, ...board];
  const suits = countBy(all.map((card) => card.suit));
  const flushDraw = Object.values(suits).some((count) => count === 4) ? 0.08 : 0;
  const values = [...new Set(all.map((card) => card.value === 14 ? 1 : card.value).concat(all.map((card) => card.value)))].sort((a, b) => a - b);
  let straightDraw = 0;
  for (let start = 1; start <= 10; start += 1) {
    const needed = [start, start + 1, start + 2, start + 3, start + 4];
    const hits = needed.filter((value) => values.includes(value)).length;
    if (hits === 4) straightDraw = 0.07;
  }
  return flushDraw + straightDraw;
}

function evaluateSeven(cards) {
  if (cards.length < 5) {
    return { score: 1000000 + cards.reduce((sum, card) => sum + card.value, 0), name: "高牌潜力" };
  }
  const combos = combinations(cards, 5);
  return combos.map(evaluateFive).sort(compareRanks).at(-1);
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
  const score = category * 1000000 + tiebreakers.reduce((sum, value, index) => sum + value * (100 ** (4 - index)), 0);
  return { category, tiebreakers, score, name };
}

function compareRanks(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (diff) return diff;
  }
  return 0;
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

function kicker(values, excluded) {
  return values.find((value) => !excluded.includes(value)) || 0;
}

function kickers(values, excluded, amount) {
  return values.filter((value) => !excluded.includes(value)).slice(0, amount);
}

function combinations(items, size) {
  const result = [];
  const walk = (start, combo) => {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      walk(i + 1, [...combo, items[i]]);
    }
  };
  walk(0, []);
  return result;
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function log(message) {
  state.log.push(message);
}

function cardHtml(card, hidden = false) {
  if (hidden) return `<span class="card back" aria-label="暗牌"></span>`;
  return `
    <span class="card ${card.red ? "red" : ""}" aria-label="${card.id}${card.symbol}">
      <span class="rank">${card.id}</span>
      <span class="suit">${card.symbol}</span>
      <span class="mini">${card.id}</span>
    </span>`;
}

function render() {
  const hero = state.players.find((player) => player.id === "hero");
  const stage = STAGES[state.stageIndex] || "preflop";
  els.players.innerHTML = state.players.map(renderPlayer).join("");
  els.boardCards.innerHTML = state.board.length
    ? state.board.map((card) => cardHtml(card)).join("")
    : Array.from({ length: 5 }, () => cardHtml(null, true)).join("");
  els.heroCards.innerHTML = hero.cards.length ? hero.cards.map((card) => cardHtml(card)).join("") : "";
  els.potAmount.textContent = state.pot;
  els.heroStack.textContent = hero.stack;
  els.heroStackTop.textContent = hero.stack;
  els.stageLabel.textContent = state.handActive ? STAGE_LABELS[stage] : "等待开始";
  els.handsPlayed.textContent = state.handsPlayed;
  els.coachScore.textContent = state.decisions ? Math.round(state.totalScore / state.decisions) : "--";
  els.handLog.innerHTML = state.log.map((item) => `<li>${item}</li>`).join("");
  els.handLog.scrollTop = els.handLog.scrollHeight;

  const heroTurn = state.waitingForHero && state.handActive;
  els.foldBtn.disabled = !heroTurn || state.currentBet === hero.bet;
  els.checkCallBtn.disabled = !heroTurn;
  els.raiseBtn.disabled = !heroTurn || hero.stack <= 0;
  els.newHandBtn.textContent = state.handActive ? "重新发牌" : "开始新手牌";
}

function renderPlayer(player) {
  const pos = SEAT_POSITIONS[player.seat];
  const isHero = player.id === "hero";
  const reveal = !state.handActive && !player.folded;
  const cards = isHero || reveal
    ? player.cards.map((card) => cardHtml(card)).join("")
    : player.cards.map(() => cardHtml(null, true)).join("");
  return `
    <article class="player-seat ${isHero ? "hero" : ""} ${player.folded ? "folded" : ""}" style="left:${pos.left};top:${pos.top}">
      <div class="seat-top">
        <span class="player-name">${player.name}</span>
        ${player.seat === state.dealer ? '<span class="dealer-chip">D</span>' : ""}
      </div>
      <div class="stack-line">筹码 ${player.stack} ${player.bet ? ` / 已投 ${player.bet}` : ""}</div>
      <div class="seat-cards">${cards}</div>
      <span class="badge">${player.lastAction}</span>
    </article>`;
}

function copyLog() {
  const hero = state.players.find((player) => player.id === "hero");
  const payload = {
    board: state.board.map(cardToText),
    hero: hero.cards.map(cardToText),
    pot: state.pot,
    actions: state.log,
  };
  navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
  els.coachHint.textContent = "牌局记录已整理为 JSON。后续可以直接作为复盘求解器的输入雏形。";
}

function cardToText(card) {
  return `${card.id}${card.suit}`;
}

els.newHandBtn.addEventListener("click", startHand);
els.foldBtn.addEventListener("click", () => heroAction("fold"));
els.checkCallBtn.addEventListener("click", () => heroAction("call"));
els.raiseBtn.addEventListener("click", () => heroAction("raise"));
els.copyLogBtn.addEventListener("click", copyLog);
els.raiseSize.addEventListener("input", () => {
  els.raiseSizeLabel.textContent = `${els.raiseSize.value}x`;
});

reviewDefault();
render();
