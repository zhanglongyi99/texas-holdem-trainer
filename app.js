import { applyPlayerAction, chipTotal, createHandState, getLegalActions, serializeHandHistory } from "./engine.js";
import { evaluateSeven } from "./rules.js";
import { extractDecisionSpots, toReviewSummary, toSolverSpot } from "./review.js";

const HERO_ID = "hero";
const HAND_STORE_KEY = "holdemTrainerHandsV1";
const CONFIG_KEY = "holdemTrainerConfigV1";
const SESSION_KEY = "holdemTrainerSessionV1";

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

const PRESETS = {
  hu: { id: "hu", name: "单挑 HU", seats: 2, smallBlind: 20, bigBlind: 40, buyIn: 4000, aiLevel: "tough", note: "高频宽范围对抗" },
  sixMax: { id: "sixMax", name: "6-max 常规桌", seats: 6, smallBlind: 20, bigBlind: 40, buyIn: 4000, aiLevel: "normal", note: "默认现金桌训练" },
  nineMax: { id: "nineMax", name: "9-max Full Ring", seats: 9, smallBlind: 20, bigBlind: 40, buyIn: 4000, aiLevel: "normal", note: "更紧的前位范围" },
  shortStack: { id: "shortStack", name: "短码训练", seats: 6, smallBlind: 20, bigBlind: 40, buyIn: 1600, aiLevel: "normal", note: "40bb 压缩 SPR" },
  deepStack: { id: "deepStack", name: "深筹码训练", seats: 6, smallBlind: 20, bigBlind: 40, buyIn: 8000, aiLevel: "normal", note: "200bb 转河牌决策" },
};

const BOT_NAMES = ["标准 TAG", "常规 Reg", "紧手玩家", "跟注玩家", "松凶玩家", "数学玩家", "短码玩家", "深筹码玩家"];
const BOT_STYLES = ["tag", "reg", "nit", "caller", "lag", "reg", "short", "tag"];
const STAGE_LABELS = { preflop: "翻前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };

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
  tablePresetLabel: document.querySelector("#tablePresetLabel"),
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
  handLibrary: document.querySelector("#handLibrary"),
  libraryDetail: document.querySelector("#libraryDetail"),
  librarySearch: document.querySelector("#librarySearch"),
  libraryPresetFilter: document.querySelector("#libraryPresetFilter"),
  presetCards: document.querySelector("#presetCards"),
  configForm: document.querySelector("#configForm"),
  seatCountInput: document.querySelector("#seatCountInput"),
  smallBlindInput: document.querySelector("#smallBlindInput"),
  bigBlindInput: document.querySelector("#bigBlindInput"),
  buyInInput: document.querySelector("#buyInInput"),
  aiLevelInput: document.querySelector("#aiLevelInput"),
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
  clearLibraryBtn: document.querySelector("#clearLibraryBtn"),
};

const app = {
  config: loadConfig(),
  session: loadSession(),
  handState: null,
  savedCurrentHandId: null,
  selectedHandId: null,
  library: loadLibrary(),
};

function loadConfig() {
  return { ...PRESETS.sixMax, ...readJson(CONFIG_KEY, {}) };
}

function loadSession() {
  return { id: `session-${new Date().toISOString().slice(0, 10)}`, dealer: 0, ...readJson(SESSION_KEY, {}) };
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(app.session));
}

function loadLibrary() {
  return readJson(HAND_STORE_KEY, []);
}

function saveLibrary() {
  localStorage.setItem(HAND_STORE_KEY, JSON.stringify(app.library));
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}

function startHand() {
  app.session.dealer = app.session.dealer % app.config.seats;
  app.handState = createHandState({
    players: createConfiguredPlayers(),
    deck: buildDeck(),
    dealer: app.session.dealer,
    smallBlind: app.config.smallBlind,
    bigBlind: app.config.bigBlind,
  });
  app.session.dealer = (app.session.dealer + 1) % app.config.seats;
  app.savedCurrentHandId = null;
  saveSession();
  switchView("play");
  render();
  runUntilHero();
}

function createConfiguredPlayers() {
  const players = [{ id: HERO_ID, name: "你", stack: app.config.buyIn, style: "hero" }];
  for (let i = 1; i < app.config.seats; i += 1) {
    players.push({
      id: `bot${i}`,
      name: BOT_NAMES[(i - 1) % BOT_NAMES.length],
      stack: app.config.buyIn,
      style: BOT_STYLES[(i - 1) % BOT_STYLES.length],
    });
  }
  return players;
}

function runUntilHero() {
  if (!app.handState || !app.handState.handActive) {
    persistCompletedHand();
    render();
    return;
  }
  const actor = app.handState.players[app.handState.activeIndex];
  if (actor.id === HERO_ID) {
    render();
    return;
  }
  window.setTimeout(() => {
    const decision = chooseBotAction(app.handState, actor);
    applyPlayerAction(app.handState, actor.id, decision.action, decision.targetBet || 0);
    render();
    runUntilHero();
  }, 260);
}

function heroAction(action) {
  if (!app.handState?.handActive) return;
  const legal = getLegalActions(app.handState);
  if (legal.playerId !== HERO_ID || !legal.actions.includes(action)) return;
  const target = action === "raise" ? getHeroRaiseTarget(legal) : 0;
  applyPlayerAction(app.handState, HERO_ID, action, target);
  render();
  runUntilHero();
}

function getHeroRaiseTarget(legal) {
  const multiplier = Number(els.raiseSize.value);
  if (app.handState.street === "preflop" && legal.currentBet > 0) {
    return Math.min(Math.max(legal.currentBet * multiplier, legal.minRaiseTo || 0), legal.maxRaiseTo);
  }
  const target = legal.currentBet > 0
    ? legal.currentBet + Math.max(legal.toCall * 2, app.handState.pot * 0.65)
    : app.handState.pot * 0.6;
  return Math.min(Math.max(Math.round(target), legal.minRaiseTo || app.config.bigBlind), legal.maxRaiseTo);
}

function chooseBotAction(state, actor) {
  const legal = getLegalActions(state);
  const strength = estimateStrength(actor.cards, state.board);
  const toCall = legal.toCall || 0;
  const potOdds = toCall ? toCall / (state.pot + toCall) : 0;
  const style = actor.style || "reg";
  const bias = { nit: -0.08, tag: 0, reg: 0.02, caller: 0.05, lag: 0.09, short: 0.04 }[style] || 0;
  const adjusted = strength + bias;

  if (legal.actions.includes("check") && !legal.actions.includes("raise")) return { action: "check" };
  if (legal.actions.includes("raise") && adjusted > 0.74) return { action: "raise", targetBet: botRaiseTarget(state, legal, adjusted) };
  if (legal.actions.includes("call") && adjusted >= potOdds + 0.12) return { action: "call" };
  if (legal.actions.includes("check")) {
    if (legal.actions.includes("raise") && adjusted > 0.58 && Math.random() < 0.28) return { action: "raise", targetBet: botRaiseTarget(state, legal, adjusted) };
    return { action: "check" };
  }
  return { action: legal.actions.includes("fold") ? "fold" : "call" };
}

function botRaiseTarget(state, legal, strength) {
  const target = state.currentBet > 0
    ? state.currentBet + Math.max(legal.toCall * 2, state.pot * (strength > 0.82 ? 0.75 : 0.55))
    : state.pot * (strength > 0.82 ? 0.75 : 0.55);
  return Math.min(Math.max(Math.round(target), legal.minRaiseTo || state.bigBlind), legal.maxRaiseTo);
}

function estimateStrength(cards, board) {
  if (board.length < 3) return preflopScore(cards);
  const rank = evaluateSeven([...cards, ...board]);
  const made = [0.18, 0.48, 0.68, 0.78, 0.84, 0.88, 0.91, 0.96, 0.99][rank.category] || 0.18;
  return Math.min(0.98, made + cards.reduce((sum, card) => sum + card.value, 0) / 68 + drawBonus(cards, board));
}

function preflopScore(cards) {
  const [a, b] = cards;
  const high = Math.max(a.value, b.value);
  const low = Math.min(a.value, b.value);
  const pair = a.value === b.value ? 0.34 + high / 38 : 0;
  const suited = a.suit === b.suit ? 0.055 : 0;
  const gap = Math.abs(a.value - b.value);
  const connected = gap === 1 ? 0.055 : gap === 2 ? 0.035 : gap === 3 ? 0.015 : 0;
  const broadway = high >= 11 && low >= 10 ? 0.09 : 0;
  const ace = high === 14 ? 0.08 : 0;
  return Math.max(0.05, Math.min(0.98, 0.06 + high / 32 + low / 46 + pair + suited + connected + broadway + ace));
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

function persistCompletedHand() {
  if (!app.handState || app.handState.handActive || app.savedCurrentHandId) return;
  const history = serializeHandHistory(app.handState);
  const hero = history.players.find((player) => player.id === HERO_ID);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const record = {
    id,
    sessionId: app.session.id,
    endedAt: new Date().toISOString(),
    presetId: app.config.id || "custom",
    presetName: app.config.name || "自定义桌",
    seats: app.config.seats,
    blinds: history.blinds,
    heroCards: hero?.holeCards || [],
    board: history.board,
    net: (hero?.endingStack || 0) - (hero?.startingStack || 0),
    result: history.result,
    tags: autoTags(history),
    history,
  };
  app.library.unshift(record);
  app.library = app.library.slice(0, 500);
  app.savedCurrentHandId = id;
  app.selectedHandId = id;
  saveLibrary();
}

function autoTags(history) {
  const spots = extractDecisionSpots(history, HERO_ID);
  const tags = [];
  if (spots.some((spot) => spot.action === "call" && spot.toCall > 0)) tags.push("跟注决策");
  if (spots.some((spot) => spot.action === "raise")) tags.push("主动进攻");
  if (history.result?.type === "showdown") tags.push("摊牌");
  if (!tags.length) tags.push("待复盘");
  return tags;
}

function render() {
  renderTable();
  renderControls();
  renderLibrary();
  renderReview();
  renderStats();
  renderConfig();
}

function renderTable() {
  if (!els.boardCards || !els.players) return;
  const state = app.handState;
  const hero = state?.players.find((player) => player.id === HERO_ID);
  els.boardCards.innerHTML = state?.board.length
    ? state.board.map((card) => cardHtml(card)).join("")
    : Array.from({ length: 5 }, () => cardHtml(null, true)).join("");
  els.heroCards.innerHTML = hero?.cards.length ? hero.cards.map((card) => cardHtml(card)).join("") : "";
  els.players.innerHTML = state ? state.players.map(renderPlayer).join("") : "";
  els.potAmount.textContent = state?.pot ?? 0;
  els.heroStack.textContent = hero?.stack ?? "--";
  els.stageLabel.textContent = state ? STAGE_LABELS[state.street] || state.street : "等待开始";
  els.handLog.innerHTML = state?.history.map((event) => `<li>${historyLine(event)}</li>`).join("") || "";
  els.handLog.scrollTop = els.handLog.scrollHeight;
}

function renderPlayer(player) {
  const state = app.handState;
  const pos = seatPosition(player.seat, state.players.length);
  const isHero = player.id === HERO_ID;
  const reveal = !state.handActive && !player.folded;
  const cards = isHero || reveal ? player.cards.map((card) => cardHtml(card)).join("") : player.cards.map(() => cardHtml(null, true)).join("");
  return `<article class="player-seat ${isHero ? "hero" : ""} ${player.folded ? "folded" : ""} ${state.activeIndex === player.seat && state.handActive ? "active" : ""}" style="left:${pos.left};top:${pos.top}">
    <div class="seat-top"><span class="player-name">${player.name}</span>${player.seat === state.dealer ? '<span class="dealer-chip">D</span>' : ""}</div>
    <div class="stack-line">Seat ${player.seat + 1} · 筹码 ${player.stack}${player.bet ? ` / 已投 ${player.bet}` : ""}</div>
    <div class="seat-cards">${cards}</div>
    <span class="badge">${lastActionText(player.id)}</span>
  </article>`;
}

function renderControls() {
  if (!els.tablePresetLabel || !els.foldBtn) return;
  const state = app.handState;
  const legal = state ? getLegalActions(state) : { actions: [], toCall: 0 };
  const heroTurn = legal.playerId === HERO_ID && state?.handActive;
  els.tablePresetLabel.textContent = app.config.name || "自定义桌";
  els.handsPlayed.textContent = app.library.length;
  els.toCallAmount.textContent = heroTurn ? legal.toCall : 0;
  els.effectiveStack.textContent = state ? effectiveStack(state) : "--";
  els.turnBadge.textContent = state?.handActive ? `${state.players[state.activeIndex]?.name || "--"}行动` : "等待发牌";
  els.turnBadge.className = `pill ${heroTurn ? "live" : ""}`;
  els.foldBtn.disabled = !heroTurn || !legal.actions.includes("fold");
  els.checkCallBtn.disabled = !heroTurn || !(legal.actions.includes("check") || legal.actions.includes("call"));
  els.raiseBtn.disabled = !heroTurn || !legal.actions.includes("raise");
  els.checkCallBtn.textContent = legal.actions.includes("call") ? `跟注 ${legal.toCall}` : "过牌";
  els.newHandBtn.textContent = state?.handActive ? "重新发牌" : "开始新手牌";
  els.resultPanel.classList.toggle("hidden", state?.handActive || !app.savedCurrentHandId);
  const selected = currentRecord();
  els.resultText.textContent = selected ? `${selected.result?.summary || "本手结束"}，你的净结果 ${signed(selected.net)}` : "";
}

function renderLibrary() {
  if (!els.handLibrary || !els.librarySearch || !els.libraryPresetFilter) return;
  const query = els.librarySearch.value.trim().toLowerCase();
  const preset = els.libraryPresetFilter.value;
  const records = app.library.filter((record) => {
    const blob = `${record.presetName} ${record.heroCards.join(" ")} ${record.board.join(" ")} ${record.tags.join(" ")} ${record.result?.summary || ""}`.toLowerCase();
    return (!query || blob.includes(query)) && (!preset || record.presetId === preset);
  });
  if (!records.length) {
    els.handLibrary.className = "hand-library empty-state";
    els.handLibrary.textContent = "暂无符合条件的历史手牌。";
  } else {
    els.handLibrary.className = "hand-library";
    els.handLibrary.innerHTML = records.map((record) => `
      <article class="hand-row ${record.id === app.selectedHandId ? "selected" : ""}">
        <div>
          <strong>${record.presetName} · ${record.heroCards.join(" ") || "--"}</strong>
          <span>${formatDate(record.endedAt)} · ${record.board.join(" ") || "未见公共牌"} · ${signed(record.net)}</span>
        </div>
        <div class="tag-line">${record.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
        <button class="ghost-btn" data-review-id="${record.id}" type="button">复盘</button>
      </article>`).join("");
  }
  const selected = currentRecord();
  els.libraryDetail.innerHTML = selected ? summaryHtml(selected) : "从左侧选择一手牌进行复盘。";
  els.libraryDetail.className = selected ? "review-summary" : "review-summary empty-state";
}

function renderReview() {
  if (!els.reviewSummary || !els.decisionReview) return;
  const record = currentRecord();
  if (!record) {
    els.reviewSummary.className = "review-summary empty-state";
    els.reviewSummary.textContent = "从手牌库选择任意历史手牌进入复盘。";
    els.decisionReview.className = "decision-list empty-state";
    els.decisionReview.textContent = "等待选择手牌。";
    return;
  }
  const summary = toReviewSummary(record.history, HERO_ID);
  els.reviewSummary.className = "review-summary";
  els.reviewSummary.innerHTML = `
    ${summaryLine("桌型", record.presetName)}
    ${summaryLine("你的手牌", summary.holeCards.join(" "))}
    ${summaryLine("公共牌", summary.board.join(" ") || "未发出公共牌")}
    ${summaryLine("净结果", signed(summary.net))}
    ${summaryLine("标签", record.tags.join("、"))}`;
  const spots = summary.decisions;
  if (!spots.length) {
    els.decisionReview.className = "decision-list empty-state";
    els.decisionReview.textContent = "这手没有记录到你的主动决策。";
    return;
  }
  els.decisionReview.className = "decision-list";
  els.decisionReview.innerHTML = spots.map((spot, index) => {
    const solverSpot = toSolverSpot(spot);
    return `<article class="decision-item ${spot.action === "fold" ? "warn" : "good"}">
      <h3>${index + 1}. ${STAGE_LABELS[spot.street] || spot.street} · ${actionLabel(spot.action)}</h3>
      <p>行动时底池 ${spot.potBefore}，需跟 ${spot.toCall}，行动前筹码 ${spot.stackBefore}，公共牌 ${spot.board.join(" ") || "无"}。</p>
      <p class="quiet-note">Solver Spot 已就绪：pot=${solverSpot.pot}, toCall=${solverSpot.toCall}, action=${solverSpot.actionTaken.action}</p>
    </article>`;
  }).join("");
}

function renderStats() {
  if (!els.statsGrid || !els.leakReport) return;
  const stats = computeStats(app.library);
  const defs = [
    ["手数", stats.hands, "历史手牌库总数", "good"],
    ["bb/100", stats.bb100.toFixed(1), "基于当前盲注粗略折算", "neutral"],
    ["VPIP", pct(stats.vpip), "自愿入池率", grade(stats.vpip, 0.18, 0.30)],
    ["PFR", pct(stats.pfr), "翻前主动加注率", grade(stats.pfr, 0.12, 0.25)],
    ["WTSD", pct(stats.wtsd), "看到翻牌后进入摊牌", grade(stats.wtsd, 0.20, 0.36)],
    ["W$SD", pct(stats.wsd), "摊牌胜率", grade(stats.wsd, 0.42, 0.62)],
    ["主动动作", stats.raises, "下注/加注次数", "neutral"],
    ["跟注动作", stats.calls, "跟注次数", "neutral"],
  ];
  els.statsGrid.innerHTML = defs.map(([name, value, note, klass]) => `<article class="stat-card ${klass}"><span>${name}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
  renderLeaks(stats);
}

function renderLeaks(stats) {
  const leaks = [];
  if (stats.hands < 20) leaks.push(["样本偏小", "先累积 20-50 手牌，再认真看频率。", "warn"]);
  if (stats.vpip - stats.pfr > 0.14 && stats.hands >= 10) leaks.push(["翻前跟注偏多", "VPIP 和 PFR 差距较大，优先复盘跟注入池的手牌。", "bad"]);
  if (stats.calls > stats.raises * 2 && stats.calls > 8) leaks.push(["后续街偏被动", "跟注动作明显多于主动动作，建议筛选“跟注决策”标签。", "warn"]);
  if (!leaks.length) leaks.push(["暂无明显问题", "继续累积样本，后续按位置和 spot 拆分。", "good"]);
  els.leakReport.innerHTML = leaks.map(([title, text, klass]) => `<article class="leak-item ${klass}"><h3>${title}</h3><p>${text}</p></article>`).join("");
}

function renderConfig() {
  if (!els.presetCards || !els.seatCountInput) return;
  els.presetCards.innerHTML = Object.values(PRESETS).map((preset) => `
    <article class="preset-card ${app.config.id === preset.id ? "selected" : ""}">
      <strong>${preset.name}</strong>
      <span>${preset.seats}人 · ${preset.smallBlind}/${preset.bigBlind} · ${preset.buyIn} 筹码</span>
      <p>${preset.note}</p>
      <button class="ghost-btn" data-preset-id="${preset.id}" type="button">使用</button>
    </article>`).join("");
  els.seatCountInput.value = app.config.seats;
  els.smallBlindInput.value = app.config.smallBlind;
  els.bigBlindInput.value = app.config.bigBlind;
  els.buyInInput.value = app.config.buyIn;
  els.aiLevelInput.value = app.config.aiLevel;
}

function computeStats(records) {
  const stats = { hands: records.length, net: 0, vpipHands: 0, pfrHands: 0, sawFlop: 0, showdown: 0, wonShowdown: 0, calls: 0, raises: 0 };
  for (const record of records) {
    stats.net += record.net;
    const heroActions = record.history.actions.filter((event) => event.type === "action" && event.playerId === HERO_ID);
    if (heroActions.some((event) => event.street === "preflop" && (event.action === "call" || event.action === "raise"))) stats.vpipHands += 1;
    if (heroActions.some((event) => event.street === "preflop" && event.action === "raise")) stats.pfrHands += 1;
    if (record.board.length >= 3) stats.sawFlop += 1;
    if (record.result?.type === "showdown") {
      stats.showdown += 1;
      if (record.result?.winnerId === HERO_ID || record.result?.awards?.[HERO_ID] > 0) stats.wonShowdown += 1;
    }
    stats.calls += heroActions.filter((event) => event.action === "call").length;
    stats.raises += heroActions.filter((event) => event.action === "raise").length;
  }
  const hands = Math.max(1, stats.hands);
  const bigBlind = app.config.bigBlind || 40;
  return {
    ...stats,
    bb100: (stats.net / bigBlind / hands) * 100,
    vpip: stats.vpipHands / hands,
    pfr: stats.pfrHands / hands,
    wtsd: stats.sawFlop ? stats.showdown / stats.sawFlop : 0,
    wsd: stats.showdown ? stats.wonShowdown / stats.showdown : 0,
  };
}

function currentRecord() {
  return app.library.find((record) => record.id === app.selectedHandId) || app.library[0] || null;
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ ...rank, suit: suit.id, symbol: suit.symbol, red: suit.red });
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

function cardHtml(card, hidden = false) {
  if (hidden || !card) return `<span class="card back" aria-label="暗牌"></span>`;
  return `<span class="card ${card.red ? "red" : ""}" aria-label="${card.id}${card.symbol}">
    <span class="rank">${card.id}</span><span class="suit">${card.symbol}</span><span class="mini">${card.id}</span>
  </span>`;
}

function seatPosition(seat, total) {
  const angle = -90 + (360 / total) * seat;
  const x = 50 + Math.cos((angle * Math.PI) / 180) * 38;
  const y = 47 + Math.sin((angle * Math.PI) / 180) * 39;
  return { left: `${Math.max(4, Math.min(78, x - 8))}%`, top: `${Math.max(4, Math.min(80, y - 5))}%` };
}

function lastActionText(playerId) {
  const events = app.handState?.history || [];
  const event = [...events].reverse().find((item) => item.playerId === playerId);
  if (!event) return "等待";
  if (event.type === "blind") return `盲注 ${event.amount}`;
  if (event.action === "call") return `跟注 ${event.paid}`;
  if (event.action === "raise") return `加注到 ${event.betAfter}`;
  if (event.action === "check") return "过牌";
  if (event.action === "fold") return "弃牌";
  return "行动";
}

function historyLine(event) {
  if (event.type === "blind") return `${event.playerId} 支付盲注 ${event.amount}`;
  if (event.type === "street") return `进入 ${STAGE_LABELS[event.street] || event.street}`;
  if (event.type === "runout") return "全下后发完公共牌";
  if (event.type === "showdown") return event.summary;
  if (event.type === "finish") return event.summary;
  if (event.type === "action") return `${event.playerId} ${actionLabel(event.action)}${event.paid ? ` ${event.paid}` : ""}`;
  return event.type;
}

function effectiveStack(state) {
  const hero = state.players.find((player) => player.id === HERO_ID);
  const others = state.players.filter((player) => player.id !== HERO_ID && !player.folded);
  if (!hero || !others.length) return "--";
  return Math.min(hero.stack, ...others.map((player) => player.stack));
}

function summaryHtml(record) {
  return `
    ${summaryLine("时间", formatDate(record.endedAt))}
    ${summaryLine("桌型", record.presetName)}
    ${summaryLine("手牌", record.heroCards.join(" "))}
    ${summaryLine("公共牌", record.board.join(" ") || "未发出公共牌")}
    ${summaryLine("结果", `${record.result?.summary || "--"} · ${signed(record.net)}`)}
    ${summaryLine("标签", record.tags.join("、"))}`;
}

function summaryLine(label, value) {
  return `<div class="summary-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function actionLabel(action) {
  return { fold: "弃牌", call: "跟注", check: "过牌", raise: "下注/加注" }[action] || action;
}

function countBy(items) {
  return items.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function grade(value, low, high) {
  if (value >= low && value <= high) return "good";
  if (value >= low * 0.65 && value <= high * 1.45) return "warn";
  return "bad";
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function switchView(view) {
  els.views.forEach((el) => el.classList.toggle("active", el.id === `${view}View`));
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
}

function on(element, event, handler) {
  if (element) element.addEventListener(event, handler);
}

function applyPreset(id) {
  app.config = { ...PRESETS[id] };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(app.config));
  render();
}

function saveCustomConfig(event) {
  event.preventDefault();
  app.config = {
    id: "custom",
    name: "自定义桌",
    seats: Number(els.seatCountInput.value),
    smallBlind: Number(els.smallBlindInput.value),
    bigBlind: Number(els.bigBlindInput.value),
    buyIn: Number(els.buyInInput.value),
    aiLevel: els.aiLevelInput.value,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(app.config));
  render();
}

function copyCurrentHand() {
  const record = currentRecord();
  navigator.clipboard?.writeText(JSON.stringify(record?.history || serializeHandHistory(app.handState), null, 2));
}

on(els.newHandBtn, "click", startHand);
on(els.nextHandBtn, "click", startHand);
on(els.reviewHandBtn, "click", () => switchView("review"));
on(els.foldBtn, "click", () => heroAction("fold"));
on(els.checkCallBtn, "click", () => {
  const legal = getLegalActions(app.handState);
  heroAction(legal.actions.includes("call") ? "call" : "check");
});
on(els.raiseBtn, "click", () => heroAction("raise"));
on(els.copyLogBtn, "click", copyCurrentHand);
on(els.raiseSize, "input", () => {
  els.raiseSizeLabel.textContent = `${els.raiseSize.value}x`;
});
on(els.resetStatsBtn, "click", () => renderStats());
on(els.clearLibraryBtn, "click", () => {
  app.library = [];
  app.selectedHandId = null;
  saveLibrary();
  render();
});
on(els.librarySearch, "input", renderLibrary);
on(els.libraryPresetFilter, "change", renderLibrary);
on(els.configForm, "submit", saveCustomConfig);
els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
els.viewJump.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.viewJump)));
document.addEventListener("click", (event) => {
  const reviewId = event.target.closest("[data-review-id]")?.dataset.reviewId;
  if (reviewId) {
    app.selectedHandId = reviewId;
    render();
    switchView("review");
  }
  const presetId = event.target.closest("[data-preset-id]")?.dataset.presetId;
  if (presetId) applyPreset(presetId);
});

render();
