# Project Handoff

这份文档是后续 Codex 窗口的交接入口。新窗口开始工作前，先读这里，再按需要读 `README.md`、`docs/architecture.md` 和源码。

## 项目目标

这是一个面向新手的德州扑克模拟练习器。核心不是做花哨页面，而是让用户能进行可靠、自然、有强度的练习，并在牌局结束后得到可信的复盘和长期数据反馈。

当前最高优先级：

1. 规则可靠：No-Limit Hold'em 的行动权、下注轮、all-in、边池、摊牌、筹码守恒必须可信。
2. 复盘准确：复盘只能基于行动当时的状态快照，不能用最终牌面或最终底池倒推。
3. 对局纯粹：对局中不打断用户，不展示策略提示；复盘放在手牌结束后的独立界面。
4. 数据有用：历史手牌可保存、筛选、回看；统计要能帮助用户发现 leak。
5. AI/GTO 后置：先把规则、历史、复盘和页面架构打牢，再接更复杂的 GTO 或 solver 策略。

## 当前仓库状态

- GitHub: https://github.com/zhanglongyi99/texas-holdem-trainer
- 当前主要分支：`main`
- 最近完成的方向：
  - 规则层和牌局状态机抽离。
  - 历史手牌库、复盘工作台、数据中心、牌桌配置页落地。
  - 顶部导航和开始新手牌按钮曾出现不可点击问题，已做初始化和层级修复。

## 关键文件

- `index.html`: 静态页面入口，包含五个主视图：牌桌、手牌库、复盘、数据、配置。
- `styles.css`: 页面样式和响应式布局。
- `app.js`: 浏览器会话控制器，负责 UI、localStorage、机器人行动、页面渲染。
- `rules.js`: 纯规则函数，包括行动资格、下注约束、盲注位置、牌型评估、边池结算、筹码统计。
- `engine.js`: 纯牌局状态机，从盲注到翻前、翻牌、转牌、河牌、摊牌或弃牌结算。
- `review.js`: 复盘数据抽取，把 hand history 转成行动当时的 decision spot 和 solver-facing spot。
- `tests/rules.test.mjs`: 规则测试。
- `tests/engine.test.mjs`: 状态机测试。
- `tests/review.test.mjs`: 复盘快照测试。
- `docs/architecture.md`: 工程架构边界。
- `docs/page-architecture-proposal.html`: 页面架构和功能流转提案。

## 本地运行

项目目前是纯静态前端。因为使用 ES module，需要通过本地静态服务打开。

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

访问：

```text
http://127.0.0.1:4173/
```

如果用户说按钮仍不可点击，先让用户在浏览器里强制刷新：

```text
Ctrl + F5
```

然后再检查控制台错误和 localStorage 状态。

## 测试

如果本机有 Node/npm：

```powershell
npm test
```

在 Codex 桌面环境里，如果系统 Node 不可用，可以使用内置运行时：

```powershell
& 'C:\Users\zhanglongyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests/rules.test.mjs
& 'C:\Users\zhanglongyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests/engine.test.mjs
& 'C:\Users\zhanglongyi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tests/review.test.mjs
```

当前测试覆盖重点：

- 行动权过滤。
- 下注轮完成判断。
- 最小加注和 full raise / short all-in 区分。
- heads-up 和多人桌盲注、行动顺序。
- all-in 自动发完公共牌并摊牌。
- 牌型比较。
- 主池、边池、平分底池。
- 弃牌玩家贡献进入底池但不能赢池。
- 总筹码守恒。
- 完整手牌状态推进。
- 非法行动拒绝。
- hand history 和复盘 decision spot。

## 本地存储

浏览器端使用 localStorage：

- `holdemTrainerHandsV1`: 已完成手牌历史。
- `holdemTrainerConfigV1`: 牌桌配置。
- `holdemTrainerSessionV1`: 当前会话状态。

如果 UI 状态异常，可能需要增加一个正式的“重置本地数据”入口，而不是让用户手动清 localStorage。

## 已知限制

1. 当前 AI 仍是 `app.js` 内的启发式机器人，不是 GTO，也不应宣称为 GTO。
2. 复盘建议目前是简化策略说明，主要用于新手理解，不是 solver 输出。
3. 浏览器自动化在当前企业策略下无法直接打开 `http://127.0.0.1:4173`，所以 localhost 的真实点击验证可能需要用户手动确认，或用 HTTP/DOM stub 进行辅助验证。
4. `app.js` 仍然偏大，下一步应抽出策略层和更清晰的页面状态边界。
5. 历史手牌目前存在本地浏览器，后续如要云同步或账号体系需要另行设计。

## 下一步建议

在讨论 GTO 之前，推荐先推进到这个工程形态：

1. 抽出 `strategy.js`，定义机器人策略接口。
2. 让所有 AI 决策只通过 `getLegalActions(state)` 返回合法动作，策略层不能直接改牌局状态。
3. 为策略层补测试：任何策略输出都必须合法，不能越位、不能非法 check、不能低于最小加注。
4. 把复盘页的数据来源固定为 `review.js` 的 decision spot。
5. 增加本地数据重置和调试导出入口，方便排查用户浏览器状态问题。
6. 再讨论 GTO 接入路径：规则表、Monte Carlo 权益、外部 solver、TexasSolver、预计算策略表或混合方案。

## 新窗口启动提示词

可以在新 Codex 窗口直接粘贴：

```text
请先阅读 docs/HANDOFF.md，并把它作为当前项目交接上下文。接下来继续开发德州扑克模拟练习器，原则是规则可靠、复盘准确、对局强度优先。当前阶段先不要接 GTO solver，先把页面架构和策略层边界推进到可维护状态。
```

## 协作约定

- 改规则前先补或确认测试。
- UI 改动后尽量验证按钮可点击、页面无报错、主要流程能走通。
- 不要把启发式 AI 描述成 GTO。
- 不要用最终牌面推断历史决策。
- 保持新人友好：对局页面干净，复盘页面解释清楚，数据页面用指标帮助定位问题。
