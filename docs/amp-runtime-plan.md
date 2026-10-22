# AMP 工作流运行时落地计划

> 协议来源：[Attention Manifest Protocol.md](../Attention%20Manifest%20Protocol.md)
> 规范正文：`R:\project\AttentionManifestProtocol\spec\AMP-0.1.md`
> 设计审计：`R:\project\AttentionManifestProtocol\spec\AUDIT.md`
> 依赖分析：[mcp-token-tax-integration.md](./mcp-token-tax-integration.md)

## 0. 先修正定位

读到 AMP 0.1 之后，之前的设计需要收敛：

- **AMP 是协议层**：P1 存在层 / P2 可供层 / P3 注意层，五个动词 `declare` / `attend` / `act` / `resolve` / `account`。
- **LCP 是实现剖面**：四个北向工具 `find_tools` / `inspect_tool` / `run` / `read_handle`，不是新协议。
- **MCP 是绑定与清单源**：`tools/list` 是 provider，`tools/call` 是 `act` 的一种实现，`resources/read` 是 `resolve` 的一种实现。
- **Workflow 是宿主应用**：AMP 明确不是工作流引擎；流程执行可以交给 Temporal、队列、MCP tasks 或脚本，AMP 定义契约、门、授予与账本。

所以接下来不再写“另一个世界模型协议”，而是实现一个 **AMP 宿主运行时（AMP-Host）**，再把 Codex / Claude Code 的机制作为该运行时的绑定与执行器补齐。

---

## 1. 三层平面映射

| AMP 平面 | 内容 | 我们的实现 |
|---|---|---|
| **P1 存在层** | claim / evidence / prior / likelihood / posterior / conflict | 世界事实、证据、贝叶斯信念、冲突；不把工具当事实 |
| **P2 可供层** | affordance / effect / grant / process / permission / boundary | 工具注册、动作契约、审批授予、流程定义、权限/边界 |
| **P3 注意层** | intent / budget / VOI / slice / lease / ledger | 上下文投影、token/六轴预算、租约、账本、注意力评分 |

**正交原则**：一个对象只能属于一条平面；跨平面只能通过引用（claim id、affordance id、handle）。

- 工具是 P2，不是 P1。
- 检索是 P3，不是 P1。
- 提示词是 P3 的投影，不是 P2 的权限。

这直接回答“模型如何理解宇宙”：

> 不是把所有事实和工具塞进上下文，而是通过 `attend` 拿到一个**带来源、置信、预算、租约**的切片，再通过 `act`/`resolve`/`account` 改变和核对世界。

---

## 2. LCP 与 AMP 的对应

LCP 不应另起一套动词。它是 AMP 的一个 **context-plane profile**：

| LCP 工具 | AMP 操作 | 说明 |
|---|---|---|
| `find_tools` | `attend(level=L0/L1)` | 意图 + 预算 + selector，返回图集切片与分数 |
| `inspect_tool` | `attend(level=L2)` | 展开单条 affordance 契约；不是全量 schema |
| `run` | `act` | 带 `effects_ack`、预算、租约、幂等键、审批 |
| `read_handle` | `resolve` | 按 projection 物化句柄 |
| （无） | `account` | 结算、校准、审计；LCP 缺这一半 |
| （无） | `declare` | 发布者声明 Manifest；客户端不发布 |

### 三份契约

| LCP | AMP | 备注 |
|---|---|---|
| Manifest | AMP Manifest（§4） | 签名、版本、digest、TTL、claims/affordances/processes |
| Budget | AMP 六轴预算（§11.1） | `tokens` 只是其中一轴；不能用单一 token 预算替代 |
| Handle | AMP 句柄（§11.3） | `amp://h/sha256:...`，受众/用途绑定 |

### Token 税的正确落点

- **定义税** → `attend` 的 L0/L1 切片 + `inspect_tool` L2 按需展开。
- **结果税** → `act` 返回 handle；`resolve` 用 `summary/fields/rows/diff` 投影；`account` 记 token 成本。
- **往返税** → 代码执行/批处理绑定（`act` 内部编排），不是把每一步都送回模型。
- **协议税** → 无会话 + 租约；Manifest 稳定排序 + digest/TTL 提升缓存命中。
- **信任税** → Manifest 签名 + digest 固定 + 变更重审；P1 `taint` 与 I1 指令/数据分离。

核心原则不变：**先测结果，再测定义；稳定性优先于压缩率；预算写进接口，不写进提示词。**

---

## 3. Codex / Claude Code 机制映射到 AMP

| Codex / Claude Code 机制 | AMP 表达 |
|---|---|
| Agent loop | `declare` → `attend` → `act` → `resolve` → `account` |
| 工具注册 / 选择 | Manifest 的 `affordances`；`attend` 按意图、预算、权限检索 |
| 工具调用 | `act(affordance, args, effects_ack, budget, lease)` |
| 文件读取 / 大结果 | `act` 返回 handle；`resolve(projection)` |
| 上下文压缩 | `attend` 的 L0–L3 披露 + 六轴预算 + 投影 |
| Plan / TODO | P2 Process + P3 Blueprint/Goal/Task/Operation（§6、§8） |
| 权限 / 审批 | P2 `permission` / `boundary` / `gate` / `grant`；I6、I8 |
| 文件编辑 / patch | `act` 的 `effects=write`，返回 receipt；补偿/回滚走 Process |
| 测试 / 验证 | P1 证据 + P2 `verification` + `account` 结算 |
| Checkpoint / rollback | 账本 + 快照 + 可逆 effect + 补偿 |
| 子代理 | 不同 Subject + scoped lease + scoped manifest；共享账本，不共享隐式权限 |
| 记忆 | P1 claims/evidence + 句柄 + 账本；不是 transcript |
| 可观测性 | `cost.charged`、`scores`、`ledger`、`accounting` |
| 错误恢复 | 错误码 + 幂等键 + Process 补偿 + 重试预算 |
| 评测 | 终态验证 + ledger 回放；token 只是约束之一 |

**不照搬**的关键：

- Codex/Claude Code 的工具层是 **transcript + schema 注入**；AMP 把它改成 **P2 affordance + P3 attention slice**。
- 它们把“读文件/跑命令”当工具；AMP 要求先声明 `effects`、权限、验证与回执。
- 它们通常把审批当 UI 回调；AMP 把审批建模为带签名的 `act`，后果是 `grant`。
- 它们把记忆放在会话里；AMP 把记忆放在 P1 + ledger + handle。

---

## 4. AMP 0.1 的落地阻塞

`spec/AUDIT.md` 已列出 15 个内部问题/未决问题。实现前必须先选一个 **conformance profile**，不能假装完整 0.1。

### P0 必须先修

| 问题 | 我们的处理 |
|---|---|
| AUD-01 预算字段两套写法 | 只实现 canonical：`time_ms` / `resources` / `human_items`；提供 alias 适配器 |
| AUD-02 权限公式把边界当集合 | 实现为 `P_eff = B(P_lease ∩ P_grant ∩ P_plan ∩ P_role)`，B 返回 allow/deny + 约束 |
| AUD-03 注意力成分仍是 `g`/`cost` | 只实现 `amp-attn/2` 的 `V/C/v_d/c_d/formula` |
| AUD-04 MCP 映射角色错误 | Publisher 才 `declare`；客户端用 `attend` + lease；MCP `initialize` 不再对应单一动词 |
| AUD-05 Process/Blueprint 边界 | Process = 长期组织契约；Blueprint = 本次短期计划；Task 可引用 Process |
| AUD-06 角色矩阵不一致 | 显式角色：Publisher / Subject / Approver / Auditor / Boundary Owner |
| AUD-12 错误码优先级 | 边界 → 权限 → 租约/受众 → 预算 → 预测 → 审批；只返回最外层原因 |
| AUD-13 无状态机 | lease/case/action/grant 四类状态机 + 一致性夹具 |

### 尚未存在的东西

README 引用了 `spec/schema/`，但当前仓库没有 JSON Schema 文件。实施前需要：

- 从 `AMP-0.1.md` 第 4/5/6/8/9/11/12 节生成 **JSON Schema 2020-12**。
- 生成 TypeScript 类型（只读生成，不手写两套）。
- 建 `spec/examples/` 的 conformance fixtures。
- 先做 `AMP-Host/0.1-draft`，明确不宣称 full conformance。

### 未决问题的临时默认

| 未决 | 0.1-draft 默认 |
|---|---|
| OP-01 VOI | 熵减退化作为 fallback，标注 `voi_model` + `fallback:true` |
| OP-02 证据校准 | 运行时账本学习 + 保守先验；未校准证据只影响注意力，不改后验 |
| OP-03 先验冲突 | 并列记录 `posterior_by_principal`，高风险决策展示敏感性 |
| OP-04 权重操纵 | 签名权重 + 单轴上限 3× 默认 + 影子价格区间 |
| OP-05 blast radius | 冷启动保守上限，历史分位数 + 人工复核 |
| OP-06 权限组合 | 先纯运行时交集 + `explain(deny)`；后续编译到 Cedar/Rego |
| OP-08 审批疲劳 | 记录审阅时长/证据展开/理由；高风险双签 + 抽样复核 |
| OP-11 句柄跨域 | 先绑定 issuer/audience/purpose/expiry；暂不支持跨域委托 |
| OP-14 评估 | 成功率/安全为硬约束，token 为优化目标；τ-bench 风格终态判定 |

---

## 5. 模块划分

```text
src/amp/
  model/          # TS types generated from schema; Manifest/Claim/Affordance/Process/Case/Grant
  codec/          # RFC 8785 JCS, SHA-256, Ed25519 verify, canonicalizer
  runtime/        # declare/attend/act/resolve/account state machines
  attention/      # amp-attn/2, VOI fallback, budget knapsack, diversity
  ledger/         # append-only hash chain, replay, calibration
  handles/        # amp://h/sha256, projection, taint, expiry
  policy/         # permission intersection, boundary predicates, grants, SOD
  bindings/       # mcp, http, cli, human
  store/          # SQLite/event log, snapshots
  conformance/    # fixtures, validators, error priority
electron/amp/     # main-process host, keys, secrets, filesystem/sandbox, IPC
src/pages/WorkflowPage  # AMP console: manifest, slice, act, ledger, approvals
```

运行时应放在 Electron 主进程；渲染进程只做 UI。密钥、文件系统、shell、出站网络不暴露给 renderer。

---

## 6. 第一里程碑：AMP-Host P0

不做 LLM，不做全量 Codex 机制。先证明五个动词和账本闭环。

### 场景

一个“历法数据导入”世界：

- 3 条 claim（数据文件存在、schema 版本、朔望表行数）
- 2 个 affordance（读取文件、运行校验）
- 1 个 Process（导入 → 校验 → 审批 → 发布）
- 1 个 gate（发布前人工审批）
- 1 个 grant
- 1 个冲突（行数与源文件不一致）

### 实现

1. `declare`：加载签名 Manifest（开发密钥），校验 digest/版本/TTL。
2. `attend`：按意图生成 L0/L1 切片，返回 V/C 分数、why_not、lease、cost。
3. `act`：执行“读取文件”，校验 effects、预算、权限，返回 handle + receipt。
4. `resolve`：用 summary/rows 投影 handle，控制 token。
5. `act`：执行“运行校验”，产生冲突 claim。
6. `attend`：把冲突放进切片，模型/用户看到两种证据。
7. `act`：审批门 → `grant`。
8. `act`：发布；`account` 结算六轴成本，写哈希链。
9. 重放账本，验证终态一致。

### 验收

- Manifest digest 可复算；签名可验证。
- `attend` 每个条目有 `components`，可重算。
- 预算任一轴超限，执行前失败。
- `act` 的 effects 未声明则拒绝。
- 不可逆动作无 grant 则拒绝。
- 账本 hash chain 连续；重放终态一致。
- 冲突不被静默覆盖。

---

## 7. 工作流页面（AMP Console）

当前 `WorkflowPage` 只是普通任务看板。接 AMP 后改为：

- **顶部**：World / Intent / Lease / Budget / Values digest
- **左栏**：Cases / Runs / Gates
- **中栏**：一次交互时间线
  - `declare` 版本/digest
  - `attend` slice + scores + why_not + cost
  - `act` affordance + effects_ack + receipt
  - `resolve` projection + lineage + taint
  - `account` outcome + calibration
- **右栏**：P1/P2/P3 Inspector
  - Claims + evidence + prior/posterior
  - Affordances + effects + permissions + boundary
  - Attention components + budget + shadow prices
- **底部**：Ledger（hash chain、六轴账本、replay）
- **操作**：approve/deny、revoke lease、compensate、replay

---

## 8. 与 MCP / LCP 的关系

- 南向：MCP server 作为 **provider**，读取 `tools/list` 生成 Manifest 片段；`tools/call` 作为 `act` 绑定。
- 北向：只对模型暴露 AMP 五动词或 LCP 四个元工具；不暴露全量 schema。
- 传输：MCP / HTTP / CLI 都是 binding；传输不进入语义。
- 安全：Manifest 签名 + digest + TTL；句柄绑定 issuer/audience/purpose；I1–I8。
- 经济：六轴预算 + ledger + shadow prices；token 只是其中一轴。

**不要**：fork MCP、重写传输、把所有工具 schema 注入、用另一个 LLM 给每个结果做摘要、用多 Agent 规避上下文限制。

---

## 9. 需要确认

1. 是否按 **AMP-Host P0** 开工？先做五动词 + 账本 + 历法导入场景，不接 LLM。
2. 规范正文是否复制/ vendor 到本仓库（当前只在 `R:\project\AttentionManifestProtocol`）？
3. 是否接受先实现 `AMP-Host/0.1-draft`，不宣称 full conformance？
4. P0 的 canonical 字段以 AUD-01 的 canonical 名为准，旧字段只做 alias？
5. 账本/句柄存储用 SQLite + 文件，还是先用 in-memory + JSON fixture？
6. 开发签名密钥用本地 Ed25519 测试密钥？

---

## 10. Self 模型

AMP 还缺“模型如何认识自己”。解决方案见 [amp-self-model.md](./amp-self-model.md)：

- Self **不是第四个平面**，而是 P1/P2/P3 + Ledger 的 scoped projection。
- `SelfView` 由运行时生成，不由模型自报。
- 五问：我是谁、我能做什么、我被允许做什么、我正在做什么、我有多可靠/还不知道什么。
- `capability`、`permission`、`available_now`、`reliability`、`knowledge` 必须分开。
- SelfClaim 必须有 receipt/test/runtime provenance；模型自报只能作为 untrusted 假设。
- P0 增加 SelfView builder、`attend(intent="self")` 与 Self 面板。

---

## 11. 一句话

AMP 已经把“模型如何理解宇宙”拆成了可执行的三层：

- P1：什么是真的？谁说的？什么时候？
- P2：能做什么？会怎样？能撤回吗？
- P3：现在看什么？花多少？为什么是它？

工作流要做的不是再发明一个世界模型，而是把这三层和五个动词**真正跑起来**，再用 Codex / Claude Code 的机制填充执行器、绑定、验证与恢复。
