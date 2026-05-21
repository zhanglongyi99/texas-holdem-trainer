import {
  activePlayers as getActivePlayers,
  canAct as canPlayerAct,
  compareRanks,
  decisionPlayers as getDecisionPlayers,
  distributeShowdownPots as settleShowdownPots,
  evaluateSeven,
  isStreetComplete,
  shouldRunOutToShowdown as shouldRunOut,
} from "./rules.js";

const SMALL_BLIND = 20;
const BIG_BLIND = 40;
const STARTING_STACK = 2000;
const STAGES = ["preflop", "flop", "turn", "river", "showdown"];
const STAGE_LABELS = { preflop: "翻前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };
const POSITION_LABELS = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
const STAT_KEY = "holdemTrainerStatsV2";

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

const BASE_PLAYERS = [
  { id: "tag", name: "标准 TAG", style: "tag" },
  { id: "reg", name: "常规 Reg", style: "reg" },
  { id: "nit", name: "紧手玩家", style: "nit" },
  { id: "hero", name: "你", style: "hero" },
  { id: "caller", name: "跟注玩家", style: "caller" },
  { id: "lag", name: "松凶玩家", style: "lag" },
];

const SEAT_POSITIONS = [
  { left: "43%", top: "6%" },
  { left: "70%", top: "16%" },
  { left: "75%", top: "67%" },
  { left: "43%", top: "77%" },
  { left: "8%", top: "67%" },
  { left: "5%", top: "16%" },
];

const els = {
  views: document.querySelectorAll(".view"),
  tabs: document.querySelectorAll(".tab"),
  viewJump: document.querySelectorAll("[data-view-jump]"),
  players: document.querySelector("#players"),
  boardCards: document.querySelector("#boardCards"),
  heroCards: document.querySelector("#heroCards"),
  potAmount: document.querySelector("#potAmount"),
  heroStack: document.querySelector("#heroStack"),
  stageLabel: document.querySelector("#stageLabel"),
  heroPosition: document.querySelector("#heroPosition"),
  toCallAmount: document.querySelector("#toCallAmount"),
  effectiveStack: document.querySelector("#effectiveStack"),
  handsPlayed: document.querySelector("#handsPlayed"),
  turnBadge: document.querySelector("#turnBadge"),
  handLog: document.querySelector("#handLog"),
  resultPanel: document.querySelector("#resultPanel"),
  resultText: document.querySelector("#resultText"),
  reviewSummary: document.querySelector("#reviewSummary"),
  decisionReview: document.querySelector("#decisionReview"),
  statsGrid: document.querySelector("#statsGrid"),
  leakReport: document.querySelector("#leakReport"),
  newHandBtn: document.querySelector("#newHandBtn"),
  nextHandBtn: document.querySelector("#nextHandBtn"),
  reviewHandBtn: document.querySelector("#reviewHandBtn"),
  foldBtn: document.querySelector("#foldBtn"),
  checkCallBtn: document.querySelector("#checkCallBtn"),
  raiseBtn: document.querySelector("#raiseBtn"),
  raiseSize: document.querySelector("#raiseSize"),
  raiseSizeLabel: document.querySelector("#raiseSizeLabel"),
  copyLogBtn: document.querySelector("#copyLogBtn"),
  resetStatsBtn: document.querySelector("#resetStatsBtn"),
};

let state = {
  deck: [],
  board: [],
  players: createPlayers(),
  dealer: -1,
  stageIndex: 0,
  pot: 0,
  currentBet: 0,
  activeIndex: 0,
  handActive: false,
  waitingForHero: false,
  log: [],
  preflopRaiseCount: 0,
  preflopAggressor: null,
  streetAggressor: null,
  streetBetCount: 0,
  flopCbetBy: null,
  hand: null,
  lastReview: null,
  stats: loadStats(),
};

function defaultStats() {
  return {
    hands: 0,
    netChips: 0,
    vpip: 0,
    pfr: 0,
    threeBet: 0,
    sawFlop: 0,
    wonWhenSawFlop: 0,
    wentShowdown: 0,
    wonShowdown: 0,
    betsRaises: 0,
    calls: 0,
    cbetOpp: 0,
    cbetMade: 0,
    foldToCbetOpp: 0,
    foldToCbet: 0,
  };
}

function loadStats() {
  try {
    return { ...defaultStats(), ...JSON.parse(localStorage.getItem(STAT_KEY) || "{}") };
  } catch {
    return defaultStats();
  }
}

function saveStats() {
  localStorage.setItem(STAT_KEY, JSON.stringify(state.stats));
}

function createPlayers() {
  return BASE_PLAYERS.map((player, seat) => ({
    ...player,
    seat,
    stack: STARTING_STACK,
    committed: 0,
    cards: [],
    bet: 0,
    folded: false,
    allIn: false,
    acted: false,
    lastAction: "等待",
  }));
}

function startHand() {
  const previousHeroStack = hero()?.stack || STARTING_STACK;
  state.deck = buildDeck();
  state.board = [];
  state.players = createPlayers();
  for (const player of state.players) {
    player.stack = player.id === "hero" ? clamp(previousHeroStack, 400, 6000) : STARTING_STACK;
    player.cards = [state.deck.pop(), state.deck.pop()];
    player.lastAction = "入局";
  }
  state.dealer = (state.dealer + 1) % state.players.length;
  state.stageIndex = 0;
  state.pot = 0;
  state.currentBet = BIG_BLIND;
  state.preflopRaiseCount = 0;
  state.preflopAggressor = null;
  state.streetAggressor = null;
  state.streetBetCount = 0;
  state.flopCbetBy = null;
  state.handActive = true;
  state.waitingForHero = false;
  state.log = [];
  state.lastReview = null;
  state.hand = createHandMetrics();

  postBlind(nextSeat(state.dealer), SMALL_BLIND, "小盲");
  postBlind(nextSeat(state.dealer, 2), BIG_BLIND, "大盲");
  state.activeIndex = nextSeat(state.dealer, 3);
  log(`新手牌开始，庄位：${state.players[state.dealer].name}`);
  switchView("play");
  render();
  runUntilHero();
}

function createHandMetrics() {
  return {
    startStack: hero()?.stack || STARTING_STACK,
    heroCards: [],
    vpip: false,
    pfr: false,
    threeBet: false,
    sawFlop: false,
    wonWhenSawFlop: false,
    wentShowdown: false,
    wonShowdown: false,
    betsRaises: 0,
    calls: 0,
    cbetOpp: false,
    cbetMade: false,
    foldToCbetOpp: false,
    foldToCbet: false,
    decisions: [],
  };
}

function postBlind(index, amount, label) {
  const player = state.players[index];
  commitChips(player, amount);
  player.lastAction = `${label} ${amount}`;
  log(`${player.name} 支付${label} ${amount}`);
}

function runUntilHero() {
  if (!state.handActive) return;
  const active = activePlayers();
  if (active.length === 1) {
    finishHand(active[0], "其他玩家全部弃牌");
    return;
  }
  if (shouldRunOutToShowdown()) {
    runOutToShowdown();
    return;
  }
  if (streetComplete()) {
    advanceStreet();
    return;
  }

  const player = state.players[state.activeIndex];
  if (!canAct(player)) {
    state.activeIndex = nextActionIndex(state.activeIndex);
    runUntilHero();
    return;
  }

  if (player.id === "hero") {
    state.waitingForHero = true;
    markHeroOpportunities();
    render();
    return;
  }

  state.waitingForHero = false;
  render();
  window.setTimeout(() => {
    performBotAction(player);
    state.activeIndex = nextActionIndex(state.activeIndex);
    render();
    window.setTimeout(runUntilHero, 360);
  }, 420);
}

function streetComplete() {
  return isStreetComplete(state.players, state.currentBet);
}

function shouldRunOutToShowdown() {
  return shouldRunOut(state.players, state.currentBet);
}

function canAct(player) {
  return canPlayerAct(player);
}

function activePlayers() {
  return getActivePlayers(state.players);
}

function decisionPlayers() {
  return getDecisionPlayers(state.players);
}

function advanceStreet() {
  if (STAGES[state.stageIndex] === "preflop") {
    state.board.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    state.stageIndex = 1;
    state.hand.sawFlop = !hero().folded;
    log("发出翻牌");
  } else if (STAGES[state.stageIndex] === "flop") {
    state.board.push(state.deck.pop());
    state.stageIndex = 2;
    log("发出转牌");
  } else if (STAGES[state.stageIndex] === "turn") {
    state.board.push(state.deck.pop());
    state.stageIndex = 3;
    log("发出河牌");
  } else {
    showdown();
    return;
  }

  state.currentBet = 0;
  state.streetAggressor = null;
  state.streetBetCount = 0;
  state.flopCbetBy = STAGES[state.stageIndex] === "flop" ? null : state.flopCbetBy;
  for (const player of state.players) {
    player.bet = 0;
    player.acted = false;
  }
  state.activeIndex = nextActionIndex(state.dealer);
  render();
  window.setTimeout(runUntilHero, 420);
}

function runOutToShowdown() {
  while (state.board.length < 5) {
    state.board.push(state.deck.pop());
    if (state.board.length === 3) log("发出翻牌");
    if (state.board.length === 4) log("发出转牌");
    if (state.board.length === 5) log("发出河牌");
  }
  log("所有未弃牌玩家已全下，直接摊牌");
  showdown();
}

function performBotAction(player) {
  const decision = chooseBotAction(player);
  applyAction(player, decision.type, decision.target);
}

function chooseBotAction(player) {
  const stage = currentStage();
  const toCall = Math.max(0, state.currentBet - player.bet);
  if (stage === "preflop") return choosePreflopAction(player, toCall);
  return choosePostflopAction(player, toCall);
}

function choosePreflopAction(player, toCall) {
  const score = startingHandScore(player.cards);
  const pos = positionName(player.seat);
  const openThresholds = { UTG: 0.63, HJ: 0.56, CO: 0.50, BTN: 0.43, SB: 0.53, BB: 0.34 };
  const styleAdj = { nit: 0.08, tag: 0.02, reg: 0, caller: -0.04, lag: -0.08 };
  const threshold = openThresholds[pos] + (styleAdj[player.style] || 0);
  const facingRaise = state.preflopRaiseCount > 0;
  const canRaise = player.stack > toCall + BIG_BLIND * 4;

  if (toCall === 0) {
    if (score > threshold + 0.12 && canRaise) return { type: "raise", target: roundBet(BIG_BLIND * 3) };
    return { type: "check" };
  }

  if (!facingRaise) {
    if (score > threshold + 0.17 && canRaise) return { type: "raise", target: roundBet(BIG_BLIND * (pos === "SB" ? 3.5 : 3)) };
    if (score > threshold || (pos === "BB" && score > threshold - 0.08)) return { type: "call" };
    return { type: "fold" };
  }

  if (score > threshold + 0.28 && canRaise) return { type: "raise", target: roundBet(state.currentBet * 3) };
  if (score > threshold + 0.10 || (pos === "BB" && score > threshold + 0.02)) return { type: "call" };
  return { type: "fold" };
}

function choosePostflopAction(player, toCall) {
  const strength = strategyStrength(player.cards, state.board);
  const draw = drawBonus(player.cards, state.board);
  const potOdds = toCall ? toCall / (state.pot + toCall) : 0;
  const styleAdj = { nit: -0.06, tag: 0, reg: 0.02, caller: 0.04, lag: 0.08 }[player.style] || 0;
  const adjusted = strength + draw + styleAdj;
  const canRaise = player.stack > toCall + BIG_BLIND * 3;

  if (toCall === 0) {
    const cbetSpot = currentStage() === "flop" && state.preflopAggressor === player.id && state.streetBetCount === 0;
    if (strength > 0.64 || (cbetSpot && adjusted > 0.48) || (draw > 0.07 && Math.random() < 0.35)) {
      return { type: "raise", target: player.bet + betSize(strength) };
    }
    return { type: "check" };
  }

  if (strength > 0.80 && canRaise) {
    return { type: "raise", target: roundBet(state.currentBet + Math.max(toCall * 2, state.pot * 0.65)) };
  }
  if (adjusted > potOdds + 0.18 || (draw > 0.09 && adjusted > potOdds + 0.08)) return { type: "call" };
  return { type: "fold" };
}

function applyAction(player, type, target = 0) {
  const toCall = Math.max(0, state.currentBet - player.bet);
  if (type === "fold") {
    player.folded = true;
    player.acted = true;
    player.lastAction = "弃牌";
    log(`${player.name} 弃牌`);
    return;
  }
  if (type === "check") {
    player.acted = true;
    player.lastAction = "过牌";
    log(`${player.name} 过牌`);
    return;
  }
  if (type === "call") {
    const paid = commitChips(player, toCall);
    player.acted = true;
    player.lastAction = paid ? `跟注 ${paid}` : "过牌";
    log(`${player.name} ${paid ? `跟注 ${paid}` : "过牌"}`);
    return;
  }
  if (type === "raise") {
    const oldBet = state.currentBet;
    const minTarget = oldBet ? oldBet + BIG_BLIND : BIG_BLIND;
    const cappedTarget = Math.min(Math.max(target, minTarget), player.bet + player.stack);
    commitChips(player, cappedTarget - player.bet);
    state.currentBet = Math.max(state.currentBet, player.bet);
    resetActedAfterRaise(player);
    player.lastAction = oldBet ? `加注到 ${player.bet}` : `下注 ${player.bet}`;
    log(`${player.name} ${oldBet ? `加注到 ${player.bet}` : `下注 ${player.bet}`}`);
    markAggression(player, oldBet);
  }
}

function heroAction(type) {
  if (!state.waitingForHero || !state.handActive) return;
  const player = hero();
  const toCall = Math.max(0, state.currentBet - player.bet);
  const rec = recommendHeroAction(type);

  if (type === "fold") {
    state.hand.decisions.push(rec);
    if (state.flopCbetBy && currentStage() === "flop" && toCall > 0) state.hand.foldToCbet = true;
    applyAction(player, "fold");
  }
  if (type === "call") {
    state.hand.decisions.push(rec);
    if (toCall > 0) {
      state.hand.vpip = currentStage() === "preflop" || state.hand.vpip;
      state.hand.calls += 1;
    }
    applyAction(player, toCall ? "call" : "check");
  }
  if (type === "raise") {
    state.hand.decisions.push(rec);
    const oldRaiseCount = state.preflopRaiseCount;
    const multiplier = Number(els.raiseSize.value);
    const target = currentStage() === "preflop"
      ? roundBet(Math.max(state.currentBet * multiplier, BIG_BLIND * 3))
      : roundBet(state.currentBet ? state.currentBet + Math.max(toCall * 2, state.pot * 0.65) : state.pot * 0.6);
    applyAction(player, "raise", Math.min(target, player.bet + player.stack));
    state.hand.vpip = true;
    state.hand.betsRaises += 1;
    if (currentStage() === "preflop") {
      state.hand.pfr = true;
      if (oldRaiseCount >= 1) state.hand.threeBet = true;
    }
    if (currentStage() === "flop" && state.hand.cbetOpp) state.hand.cbetMade = true;
  }

  state.waitingForHero = false;
  state.activeIndex = nextActionIndex(state.activeIndex);
  render();
  window.setTimeout(runUntilHero, 360);
}

function markAggression(player, oldBet) {
  if (currentStage() === "preflop" && player.bet > BIG_BLIND) {
    state.preflopRaiseCount += 1;
    state.preflopAggressor = player.id;
  }
  if (currentStage() !== "preflop") {
    if (currentStage() === "flop" && state.streetBetCount === 0 && state.preflopAggressor === player.id) {
      state.flopCbetBy = player.id;
    }
    state.streetBetCount += 1;
    state.streetAggressor = player.id;
  }
}

function markHeroOpportunities() {
  const toCall = Math.max(0, state.currentBet - hero().bet);
  if (currentStage() === "flop" && state.preflopAggressor === "hero" && state.streetBetCount === 0) {
    state.hand.cbetOpp = true;
  }
  if (currentStage() === "flop" && state.flopCbetBy && state.flopCbetBy !== "hero" && toCall > 0) {
    state.hand.foldToCbetOpp = true;
  }
}

function recommendHeroAction(actual) {
  const player = hero();
  const stage = currentStage();
  const toCall = Math.max(0, state.currentBet - player.bet);
  const strength = stage === "preflop" ? startingHandScore(player.cards) : strategyStrength(player.cards, state.board) + drawBonus(player.cards, state.board);
  const potOdds = toCall ? toCall / (state.pot + toCall) : 0;
  const pos = positionName(player.seat);
  let best = "call";
  let reason = "";

  if (stage === "preflop") {
    const threshold = { UTG: 0.62, HJ: 0.55, CO: 0.49, BTN: 0.42, SB: 0.52, BB: 0.34 }[pos];
    if (toCall > 0 && strength < threshold) best = "fold";
    if (strength >= threshold && toCall > 0) best = "call";
    if (strength > threshold + 0.16) best = "raise";
    reason = `${pos} 位置的起手牌强度约 ${pct(strength)}，需要跟注 ${toCall}。`;
  } else {
    if (toCall > 0 && strength < potOdds + 0.12) best = "fold";
    if (toCall === 0 && strength < 0.60) best = "call";
    if (strength > 0.72) best = "raise";
    reason = `当前牌力/听牌综合约 ${pct(strength)}，底池赔率约 ${pct(potOdds)}。`;
  }

  const score = actual === best ? "good" : compatibleAction(actual, best) ? "warn" : "bad";
  return { stage, actual, best, score, toCall, pot: state.pot, strength, potOdds, reason };
}

function compatibleAction(actual, best) {
  return (best === "raise" && actual === "call") || (best === "call" && actual === "raise");
}

function showdown() {
  state.stageIndex = 4;
  const contenders = activePlayers();
  for (const player of contenders) {
    player.handRank = evaluateSeven([...player.cards, ...state.board]);
  }
  const result = distributeShowdownPots();
  state.hand.wentShowdown = !hero().folded;
  state.hand.wonShowdown = result.heroWon;
  finishHand(result.primaryWinner, result.summary, { skipPotAward: true });
}

function distributeShowdownPots() {
  const result = settleShowdownPots(state.players);
  for (const player of state.players) player.stack += result.awards.get(player.id) || 0;
  state.pot = 0;
  return result;
}

function finishHand(winner, reason, options = {}) {
  const player = winner;
  if (!options.skipPotAward) {
    player.stack += state.pot;
    log(`${reason}，获得 ${state.pot}`);
    state.pot = 0;
  } else {
    log(reason);
  }
  state.handActive = false;
  state.waitingForHero = false;
  state.hand.heroCards = hero().cards.map(cardToText);
  state.hand.board = state.board.map(cardToText);
  state.hand.endStack = hero().stack;
  state.hand.net = state.hand.endStack - state.hand.startStack;
  state.hand.winner = winner.name;
  state.hand.wonHand = winner.id === "hero";
  state.hand.wonWhenSawFlop = state.hand.sawFlop && winner.id === "hero";
  state.lastReview = { ...state.hand, log: [...state.log] };
  applyHandToStats();
  renderReview();
  renderStats();
  render();
}

function applyHandToStats() {
  const hand = state.hand;
  state.stats.hands += 1;
  state.stats.netChips += hand.net;
  if (hand.vpip) state.stats.vpip += 1;
  if (hand.pfr) state.stats.pfr += 1;
  if (hand.threeBet) state.stats.threeBet += 1;
  if (hand.sawFlop) state.stats.sawFlop += 1;
  if (hand.wonWhenSawFlop) state.stats.wonWhenSawFlop += 1;
  if (hand.wentShowdown) state.stats.wentShowdown += 1;
  if (hand.wonShowdown) state.stats.wonShowdown += 1;
  state.stats.betsRaises += hand.betsRaises;
  state.stats.calls += hand.calls;
  if (hand.cbetOpp) state.stats.cbetOpp += 1;
  if (hand.cbetMade) state.stats.cbetMade += 1;
  if (hand.foldToCbetOpp) state.stats.foldToCbetOpp += 1;
  if (hand.foldToCbet) state.stats.foldToCbet += 1;
  saveStats();
}

function commitChips(player, amount) {
  const paid = Math.min(player.stack, Math.max(0, Math.round(amount)));
  player.stack -= paid;
  player.bet += paid;
  player.committed += paid;
  state.pot += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

function resetActedAfterRaise(actor) {
  for (const player of state.players) {
    if (canAct(player)) player.acted = false;
  }
  actor.acted = true;
}

function nextSeat(from, offset = 1) {
  return (from + offset) % state.players.length;
}

function nextActionIndex(from) {
  let index = nextSeat(from);
  for (let tries = 0; tries < state.players.length; tries += 1) {
    if (canAct(state.players[index])) return index;
    index = nextSeat(index);
  }
  return index;
}

function currentStage() {
  return STAGES[state.stageIndex] || "preflop";
}

function hero() {
  return state.players.find((player) => player.id === "hero");
}

function positionName(seat) {
  return POSITION_LABELS[(seat - state.dealer + state.players.length) % state.players.length] || "--";
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ ...rank, suit: suit.id, symbol: suit.symbol, red: suit.red });
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

function startingHandScore(cards) {
  const [a, b] = cards;
  const high = Math.max(a.value, b.value);
  const low = Math.min(a.value, b.value);
  const pair = a.value === b.value ? 0.32 + high / 35 : 0;
  const suited = a.suit === b.suit ? 0.055 : 0;
  const gap = Math.abs(a.value - b.value);
  const connected = gap === 1 ? 0.055 : gap === 2 ? 0.035 : gap === 3 ? 0.015 : 0;
  const broadway = high >= 11 && low >= 10 ? 0.09 : 0;
  const ace = high === 14 ? 0.08 : 0;
  return clamp(0.06 + high / 32 + low / 46 + pair + suited + connected + broadway + ace, 0.05, 0.98);
}

function strategyStrength(cards, board) {
  const rank = evaluateSeven([...cards, ...board]);
  const made = [0.18, 0.48, 0.68, 0.78, 0.84, 0.88, 0.91, 0.96, 0.99][rank.category] || 0.18;
  const topCards = cards.reduce((sum, card) => sum + card.value, 0) / 60;
  return clamp(made + topCards, 0.06, 0.98);
}

function drawBonus(cards, board) {
  const all = [...cards, ...board];
  const suits = countBy(all.map((card) => card.suit));
  const flushDraw = Object.values(suits).some((count) => count === 4) ? 0.09 : 0;
  const values = [...new Set(all.flatMap((card) => card.value === 14 ? [14, 1] : [card.value]))].sort((a, b) => a - b);
  let straightDraw = 0;
  for (let start = 1; start <= 10; start += 1) {
    const hits = [start, start + 1, start + 2, start + 3, start + 4].filter((value) => values.includes(value)).length;
    if (hits === 4) straightDraw = 0.08;
  }
  return flushDraw + straightDraw;
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function betSize(strength) {
  const fraction = strength > 0.78 ? 0.72 : 0.52;
  return roundBet(Math.max(BIG_BLIND, state.pot * fraction));
}

function roundBet(amount) {
  return Math.max(BIG_BLIND, Math.round(amount / SMALL_BLIND) * SMALL_BLIND);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function log(message) {
  state.log.push(message);
}

function cardToText(card) {
  return `${card.id}${card.suit}`;
}

function cardHtml(card, hidden = false) {
  if (hidden || !card) return `<span class="card back" aria-label="暗牌"></span>`;
  return `<span class="card ${card.red ? "red" : ""}" aria-label="${card.id}${card.symbol}">
    <span class="rank">${card.id}</span><span class="suit">${card.symbol}</span><span class="mini">${card.id}</span>
  </span>`;
}

function render() {
  const h = hero();
  const stage = currentStage();
  const toCall = h ? Math.max(0, state.currentBet - h.bet) : 0;
  const eff = Math.min(h?.stack || 0, ...state.players.filter((p) => p.id !== "hero" && !p.folded).map((p) => p.stack || STARTING_STACK));

  els.players.innerHTML = state.players.map(renderPlayer).join("");
  els.boardCards.innerHTML = state.board.length ? state.board.map((card) => cardHtml(card)).join("") : Array.from({ length: 5 }, () => cardHtml(null, true)).join("");
  els.heroCards.innerHTML = h?.cards.length ? h.cards.map((card) => cardHtml(card)).join("") : "";
  els.potAmount.textContent = state.pot;
  els.heroStack.textContent = h?.stack ?? STARTING_STACK;
  els.stageLabel.textContent = state.handActive ? STAGE_LABELS[stage] : "等待开始";
  els.heroPosition.textContent = state.handActive ? positionName(h.seat) : "--";
  els.toCallAmount.textContent = toCall;
  els.effectiveStack.textContent = state.handActive ? eff : "--";
  els.handsPlayed.textContent = state.stats.hands;
  els.turnBadge.textContent = state.waitingForHero ? "轮到你" : state.handActive ? `${state.players[state.activeIndex]?.name || "对手"}行动` : "等待发牌";
  els.turnBadge.className = `pill ${state.waitingForHero ? "live" : ""}`;
  els.checkCallBtn.textContent = toCall ? `跟注 ${toCall}` : "过牌";
  els.foldBtn.disabled = !state.waitingForHero || !toCall;
  els.checkCallBtn.disabled = !state.waitingForHero;
  els.raiseBtn.disabled = !state.waitingForHero || h.stack <= 0;
  els.newHandBtn.textContent = state.handActive ? "重新发牌" : "开始新手牌";
  els.handLog.innerHTML = state.log.map((item) => `<li>${item}</li>`).join("");
  els.handLog.scrollTop = els.handLog.scrollHeight;
  els.resultPanel.classList.toggle("hidden", state.handActive || !state.lastReview);
  els.resultText.textContent = state.lastReview ? `${state.lastReview.winner} 赢下本手。你的净结果：${state.lastReview.net >= 0 ? "+" : ""}${state.lastReview.net}` : "";
}

function renderPlayer(player) {
  const pos = SEAT_POSITIONS[player.seat];
  const isHero = player.id === "hero";
  const reveal = !state.handActive && !player.folded;
  const cards = isHero || reveal ? player.cards.map((card) => cardHtml(card)).join("") : player.cards.map(() => cardHtml(null, true)).join("");
  return `<article class="player-seat ${isHero ? "hero" : ""} ${player.folded ? "folded" : ""} ${state.activeIndex === player.seat && state.handActive ? "active" : ""}" style="left:${pos.left};top:${pos.top}">
    <div class="seat-top"><span class="player-name">${player.name}</span>${player.seat === state.dealer ? '<span class="dealer-chip">D</span>' : ""}</div>
    <div class="stack-line">${positionName(player.seat)} · 筹码 ${player.stack}${player.bet ? ` / 已投 ${player.bet}` : ""}</div>
    <div class="seat-cards">${cards}</div>
    <span class="badge">${player.lastAction}</span>
  </article>`;
}

function renderReview() {
  if (!state.lastReview) {
    els.reviewSummary.textContent = "还没有完成的手牌。先打一手，再来看复盘。";
    els.decisionReview.textContent = "等待你的行动记录。";
    return;
  }
  const r = state.lastReview;
  els.reviewSummary.className = "review-summary";
  els.reviewSummary.innerHTML = [
    ["你的手牌", r.heroCards.join(" ")],
    ["公共牌", r.board.join(" ") || "未发出公共牌"],
    ["结果", `${r.winner} 赢下本手，你的净结果 ${r.net >= 0 ? "+" : ""}${r.net}`],
    ["关键方向", r.net >= 0 ? "赢牌也要看决策是否可复现，别只奖励结果。" : "输牌先看投入是否有理由，单手结果不能代表策略对错。"],
  ].map(([label, value]) => `<div class="summary-line"><span>${label}</span><strong>${value}</strong></div>`).join("");

  if (!r.decisions.length) {
    els.decisionReview.className = "decision-list empty-state";
    els.decisionReview.textContent = "这手没有记录到你的主动决策。";
    return;
  }
  els.decisionReview.className = "decision-list";
  els.decisionReview.innerHTML = r.decisions.map((d, index) => {
    const title = `${index + 1}. ${STAGE_LABELS[d.stage]}：你选择${actionLabel(d.actual)}，建议${actionLabel(d.best)}`;
    const detail = `${d.reason} 这个建议来自简化策略模型，不是完整 solver 频率。`;
    return `<article class="decision-item ${d.score}"><h3>${title}</h3><p>${detail}</p></article>`;
  }).join("");
}

function renderStats() {
  const s = state.stats;
  const hands = Math.max(1, s.hands);
  const statDefs = [
    ["手数", s.hands, "样本越大，数据越有参考价值。", "good"],
    ["bb/100", ((s.netChips / BIG_BLIND) / hands * 100).toFixed(1), "长期盈亏速度，短样本波动很大。", "neutral"],
    ["VPIP", pct(s.vpip / hands), "自愿入池率。6-max 新手可先观察 18%-28%。", gradeRange(s.vpip / hands, 0.18, 0.28)],
    ["PFR", pct(s.pfr / hands), "翻前加注率。通常需要接近 VPIP，避免只跟不加。", gradeRange(s.pfr / hands, 0.14, 0.24)],
    ["3Bet", pct(s.threeBet / hands), "再加注频率。样本很小时波动会很明显。", gradeRange(s.threeBet / hands, 0.05, 0.12)],
    ["AF", aggressionFactor(), "激进因子，约等于下注/加注次数除以跟注次数。", gradeRange(Number(aggressionFactor()), 1.4, 3.8)],
    ["WTSD", pct(s.sawFlop ? s.wentShowdown / s.sawFlop : 0), "看到翻牌后进入摊牌的比例。", gradeRange(s.sawFlop ? s.wentShowdown / s.sawFlop : 0, 0.20, 0.34)],
    ["W$SD", pct(s.wentShowdown ? s.wonShowdown / s.wentShowdown : 0), "摊牌胜率，短样本不要过度解读。", gradeRange(s.wentShowdown ? s.wonShowdown / s.wentShowdown : 0, 0.45, 0.62)],
    ["WWSF", pct(s.sawFlop ? s.wonWhenSawFlop / s.sawFlop : 0), "看到翻牌后赢下底池的比例。", gradeRange(s.sawFlop ? s.wonWhenSawFlop / s.sawFlop : 0, 0.38, 0.55)],
    ["CBet", pct(s.cbetOpp ? s.cbetMade / s.cbetOpp : 0), "作为翻前进攻者在翻牌继续下注的比例。", gradeRange(s.cbetOpp ? s.cbetMade / s.cbetOpp : 0, 0.42, 0.70)],
    ["Fold to CBet", pct(s.foldToCbetOpp ? s.foldToCbet / s.foldToCbetOpp : 0), "面对翻牌持续下注时弃牌的比例。", gradeRange(s.foldToCbetOpp ? s.foldToCbet / s.foldToCbetOpp : 0, 0.30, 0.58)],
  ];
  els.statsGrid.innerHTML = statDefs.map(([name, value, note, grade]) => `<article class="stat-card ${grade}"><span>${name}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
  renderLeaks();
}

function renderLeaks() {
  const s = state.stats;
  const hands = Math.max(1, s.hands);
  const leaks = [];
  const vpip = s.vpip / hands;
  const pfr = s.pfr / hands;
  if (s.hands < 20) leaks.push(["样本偏小", "先累积 20-50 手牌，再认真看 VPIP/PFR/WTSD 这类频率。", "warn"]);
  if (vpip - pfr > 0.12) leaks.push(["翻前跟注过多", "VPIP 和 PFR 差距较大，说明你可能经常只跟注入池。优先练习可加注入池的范围。", "bad"]);
  if (vpip > 0.32) leaks.push(["入池太松", "VPIP 偏高，容易在弱范围里支付太多后续街。先收紧前位和小盲位。", "bad"]);
  if (pfr < 0.10 && s.hands >= 10) leaks.push(["主动性不足", "PFR 偏低，说明你很少用加注拿主动权。新手可以先学习按钮位、CO 位开池范围。", "warn"]);
  const af = Number(aggressionFactor());
  if (af < 1.2 && s.calls + s.betsRaises > 5) leaks.push(["后续街偏被动", "下注/加注相对跟注太少。复盘时重点看是否错过价值下注或半诈唬机会。", "warn"]);
  const foldCbet = s.foldToCbetOpp ? s.foldToCbet / s.foldToCbetOpp : 0;
  if (s.foldToCbetOpp >= 4 && foldCbet > 0.65) leaks.push(["面对 CBet 弃牌过多", "如果你经常被一枪打走，对手会更容易用范围下注获利。留意后门听牌和对子继续范围。", "warn"]);
  if (!leaks.length) leaks.push(["暂无明显问题", "继续累积样本。下一步可以按位置拆分 VPIP/PFR，找到最容易漏钱的位置。", "good"]);
  els.leakReport.innerHTML = leaks.map(([title, text, grade]) => `<article class="leak-item ${grade}"><h3>${title}</h3><p>${text}</p></article>`).join("");
}

function gradeRange(value, low, high) {
  if (!Number.isFinite(value)) return "warn";
  if (value >= low && value <= high) return "good";
  if (value >= low * 0.7 && value <= high * 1.35) return "warn";
  return "bad";
}

function aggressionFactor() {
  if (state.stats.calls === 0) return state.stats.betsRaises ? "∞" : "0.0";
  return (state.stats.betsRaises / state.stats.calls).toFixed(1);
}

function actionLabel(action) {
  return { fold: "弃牌", call: "看牌/跟注", raise: "下注/加注" }[action] || action;
}

function switchView(view) {
  els.views.forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
}

function copyLog() {
  const payload = {
    board: state.board.map(cardToText),
    hero: hero()?.cards.map(cardToText) || [],
    actions: state.log,
    review: state.lastReview,
  };
  navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
}

els.newHandBtn.addEventListener("click", startHand);
els.nextHandBtn.addEventListener("click", startHand);
els.reviewHandBtn.addEventListener("click", () => switchView("review"));
els.foldBtn.addEventListener("click", () => heroAction("fold"));
els.checkCallBtn.addEventListener("click", () => heroAction("call"));
els.raiseBtn.addEventListener("click", () => heroAction("raise"));
els.copyLogBtn.addEventListener("click", copyLog);
els.raiseSize.addEventListener("input", () => {
  els.raiseSizeLabel.textContent = `${els.raiseSize.value}x`;
});
els.resetStatsBtn.addEventListener("click", () => {
  state.stats = defaultStats();
  saveStats();
  renderStats();
  render();
});
els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
els.viewJump.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewJump)));

renderReview();
renderStats();
render();
