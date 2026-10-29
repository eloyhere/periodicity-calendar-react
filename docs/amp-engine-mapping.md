# AMP 宿主引擎映射（electron/amp → electron/protocol/amp）

> 权威实现：参考仓库 `attention-manifest-protocol` v0.4.1（commit e40634a）逐字 vendor 到
> `electron/protocol/amp/`。本文件记录宿主引擎 `electron/amp/engine.ts` 的每一处职责如何落到
> vendor 模块的具体函数上，以及重写后与旧手写引擎之间的行为差异。

## 1. 结构

```text
electron/amp/
  engine.ts   # 唯一实现文件：参考模块的宿主适配层（约 2.7k 行）
  index.ts    # export { AmpEngine } from "./engine";
  types.ts    # 对外契约（AmpResponse / AmpSnapshot / AmpSelfView …），仅新增可选字段
```

已删除：`electron/amp/bayes.ts`（手写贝叶斯：logit/sigmoid/updateBelief/updateBeta/brier/ECE/聚类折扣）。
全仓已无引用，由 `bayes/engine.ts`、`bayes/reliability.ts`、`bayes/calibration.ts` 取代。

`electron/amp/engine.ts` 只保留宿主胶水：ID 规范化、六轴→标量轴适配、view 投影、执行器、事件编排。
不再包含任何加密、哈希、canonical、贝叶斯、注意力评分、预算扣减、边界/权限判定、哈希链实现。

## 2. 参考模块 → 引擎职责

| # | 参考模块与函数 | 引擎中的职责 | 旧的替代品（已删除） |
|---|---|---|---|
| 1 | `semantic/canonical.ts` `canonical` / `digestOf` | 所有摘要、签名载荷、句柄内容、自身摘要、恢复比较 | `canonicalize`、`digestValue`、`createHash("sha256")` 直调 |
| 2 | `semantic/sha256.ts` `sha256Hex` | 经 `semantic/canonical` 与 `execution/handles` 间接使用（句柄 id 摘要） | 无 |
| 3 | `manifest/sign.ts` `generateSigningKey` / `contentDigest` / `signManifest` / `verifyManifest` | 世界 Manifest 的 Ed25519 密钥、digest、签名、自校验 | `generateKeyPairSync`、`signDigest`、`verifyDigest` |
| 4 | `manifest/keys.ts` `Keyring.add` / `verifyWindow`、`checkManifestWindow` | 开发密钥生命周期窗口校验、Manifest TTL 校验 | 手写 TTL 判断 |
| 5 | `manifest/trust.ts` `trustCard` | 不适用：本宿主没有联邦 AgentCard / 信任根需求，未引入运行时依赖 | — |
| 6 | `warrant/epistemic.ts` `Claim` / `EvidenceItem` / `UnknownItem` | P1 事实与证据的内部权威表示；`AmpClaim`/`AmpEvidence`/`AmpKnownUnknown` 全部由它投影 | 手写 claim 对象 |
| 7 | `warrant/warrant.ts` `deriveConfidence` / `validateClaim` | claim 准入校验（失败即抛）+ `AmpClaim.confidence` 的唯一来源 | 手写 posterior 直接当 confidence |
| 8 | `warrant/warrant.ts` `canAuthorizeEffect` | 经 `policy/policy.ts` 的 claim gate 间接生效（tier/held/confidence≥0.6） | 手写不可逆动作判断 |
| 9 | `bayes/engine.ts` `posteriorOf` / `betaMean` | `AmpBelief`/`AmpBeliefTrace`/`AmpSelfReliability` 的后验；trace 的逐证据 log-LR 由**前缀后验的参考输出**差分得到 | `updateBelief`、logit 手写贝叶斯 |
| 10 | `bayes/reliability.ts` `SourceReliability` | 执行器/结算来源可靠度学习，写入 `AmpEvidence.calibration` | 无 |
| 11 | `bayes/calibration.ts` `brier` / `ece` | `AmpSelfView.calibration`（brier/ece/n/by_domain） | 手写 `brierScore`/`expectedCalibrationError` |
| 12 | `evidence/evidenceGraph.ts` `EvidenceGraph` | claim↔evidence 图；`evidenceFor` 生成 provenance；`impact` 生成冲突影响闭包；`hasCycle` 准入 | 无 |
| 13 | `attention/attention.ts` `selectFocus` / `salience` | L0/L1/L2 切片选择、`value` 分数、`ignored → why_not` | `buildSlice` 手写排序 |
| 14 | `attention/budget.ts` `Dispatcher`（`run` / `remaining` / `usage`） | 九标量轴（tokens/time_ms/space_bytes/capability_load/usd/compute_ms/energy_wh/human_items/risk）各自的**单点计量**；先 `remaining` 预检，再 `run` 扣减 | `fitsBudget`、`charge`、`zeroBudget` 手写数学 |
| 15 | `attention/resource.ts` `DefaultAttentionPolicy` / `processAttention` / `planAttention` / `attentionHealth` / `qualityAdjustedThroughput` | `AmpSelfAttention.health`（utilization/pressure/headroom/rest）与 `AmpSelfView.throughput` | 无 |
| 16 | `boundary/refTable.ts` `RefTable.add` / `require` / `forScope` | 注意力帧的 claim/tool 引用解析；`effectsAck` 的 `kind:scope` 引用校验（未知 ack → `BOUNDARY_REJECTED`） | 手写 effects_ack 比较 + 权限集合 |
| 17 | `boundary/frame.ts` `frameFrom` | 每次 attend 生成经过校验的 `Frame`（slots/ignored/budget/digest），`AmpSnapshot.frame` 暴露 id/digest/mode/slots/ignored | 无（旧引擎没有帧） |
| 18 | `boundary/toolCall.ts` `parseToolCall` | act 参数按 affordance 的 JSON Schema 校验，返回 `argsDigest` 绑定到审批 | 手写 `args` 直传 |
| 19 | `error/boundaryRejection.ts` `BoundaryRejection` | 统一边界拒绝错误（`BOUNDARY_REJECTED`） | 手写字符串错误 |
| 20 | `policy/policy.ts` `PolicyEngine.decide` / `approve` | claim tier/held/confidence 门 + 审批门；`approve()` 在 `a:approve_publish` 时签发 host approval，`decide(request, approvalId)` 在 publish 时一次性消费 | 手写 "needsGrant + grant 有效性" |
| 21 | `policy/guard.ts` `Guard.beforeDispatch`（`RateLimited` / `CircuitOpen` / `CostCeilingExceeded`） | “预测”阶段：费率、熔断、金额上限（AUD-12 第 5 层） | 无 |
| 22 | `execution/handles.ts` `HandleStore.put` / `read` | 句柄身份（不透明 `h.xxxxxxxxxx`）、TTL、确定性分页；`AmpResolveData.page` 暴露 tokens/total_pages/next | `createHandle` + `amp://h/sha256:...` |
| 23 | `receipt/receipt.ts` `Receipt` / `AmpEvent` | 结算回执（`op:"act"/"read"`、usage、predicted/realized VOI、handle）；账本事件类型 | `recordReceipt` 手写对象 |
| 24 | `ledger/ledger.ts` `Ledger` | append-only 事件/回执容器（反规范化到 `AmpLedgerEntry`） | 手写 `ledger: AmpLedgerEntry[]` |
| 25 | `ledger/persistence.ts` `exportLedger` / `verifySnapshot` / `restoreLedger` | 哈希链（`seq`/`payload`/`prev`/`hash`）的唯一产生者；`AmpEngine.verifyLedger()` 用 `restoreLedger` 重放并比对整链 digest | `appendLedger` 手写 `digestValue(entryBase)` 链 |
| 26 | `ledger/checkpoint.ts` `sealCheckpoint` / `verifyCheckpoint` / `verifySnapshotAgainstCheckpoint` | 每次追加后对链尖签 Ed25519 checkpoint（域分离），`AmpSnapshot.ledger_checkpoint` 暴露 | 无 |
| 27 | `frame/frame.ts` `Frame` / `Slot` / `Ignored` / `Impasse` | 注意力帧的类型契约 | 无 |
| 28 | `goal/goal.ts` `createGoalLifecycle` / `transitionGoal` | case 生命周期：`active → achieved / abandoned`，映射 `AmpCaseView.state` | 手写 `advanceCase` 状态 |
| 29 | `goal/plan.ts` `validatePlanInput` / `PlanTask` | Process → Plan 的准入校验，任务状态随 act 推进 | 无 |
| 30 | `types/common.ts` `Budget` / `Usage` / `Handle` / `Ref` / `Tier` / `Trust` | 回执 usage、句柄、引用、层级、信任类型的共同词汇 | 无 |

> 注：`manifest/trust.ts`、`kernel/scheduler`、`database/*`、`store/*`、`process/*`、`thread/*`、
> `window/*`、`authz/*`、`registry/*`、`ipc/*`、`lock/*`、`concurrency/*`、`progress/*` 均未进入
> 运行时 import 图（前九个属于 SQLite/宿主子系统，`trust` 属于联邦信任根）。

## 3. 五动词映射

| 动词 | 引擎步骤（`AmpEngine`） | 参考模块落点 |
|---|---|---|
| `init`（declare） | 生成 Ed25519 密钥 → Keyring 窗口 → 构造 3 条 claim/证据 → EvidenceGraph → Unknown → Goal/Plan → 签 Manifest → values digest → lease → 九轴计量器 → PolicyEngine/Guard/HandleStore/SourceReliability → 首帧切片 → 追加 `declare` 事件并签 checkpoint | `manifest/sign`、`manifest/keys`、`warrant/*`、`evidence/evidenceGraph`、`goal/*`、`ledger/ledger`、`ledger/checkpoint` |
| `attend` | 计费（tokens/time/space/risk，`capability_load=0`）→ RefTable → claim/affordance → `Candidate`（voi/goalFit/uncertainty/novelty/cost/risk/trustCap）→ `selectFocus` → `frameFrom` → `AmpSliceItem.components` + `.inputs` → `why_not` → 追加 `attend` 事件 | `attention/attention`、`boundary/frame`、`boundary/refTable`、`attention/budget` |
| `act` | 步骤闸门 → `parseToolCall`（边界）→ `effectsAck` RefTable（边界）→ role ∩ lease? → `PolicyEngine.decide`（权限）→ lease/受众 → 九轴 `fitsBudget`（预算）→ `Guard.beforeDispatch`（预测）→ `decide(request, grantApprovalId)`（审批）→ 扣费 → 执行器 → `Receipt` + `Ledger.appendEvent` + checkpoint | `boundary/toolCall`、`boundary/refTable`、`policy/policy`、`policy/guard`、`attention/budget`、`execution/handles`、`receipt/receipt`、`ledger/*` |
| `resolve` | 句柄查找/TTL → `HandleStore.read` 分页 → 投影（summary/rows/fields）→ 预算 → 扣费 → `Receipt(op:"read")` + `resolve` 事件 | `execution/handles`、`receipt/receipt`、`attention/budget`、`ledger/*` |
| `account` | 结算 outcome → 可靠度观察 → 失败时 `transitionGoal(abandoned)` → 追账 → 返回真实累计 `balance` 与链长 | `goal/goal`、`bayes/reliability`、`ledger/*` |

错误优先级（`docs/amp-runtime-plan.md` §4 AUD-12）在 `act` 中的实现顺序：
`CASE_CLOSED/GATE_NOT_READY` → **边界**（参数 schema、effectsAck）→ **权限**（role ∩、claim tier/held/confidence）→
**租约/受众**（lease 过期、subject、ops、scope）→ **预算**（九轴 `remaining` 预检）→ **预测**（Guard 费率/熔断/金额）→
**审批**（grant + `PolicyEngine.decide(request, approvalId)`）。只返回最外层原因。

## 4. 契约保持与新增可选字段

`AmpEngine` 类名与 `init/attend/act/resolve/account` 五方法保留；返回 `AmpResponse`。
`init/attend/act/resolve/account` 现为 `async`（与 `types.ts` 既有 `AmpEngineApi: Promise<AmpResponse>` 一致，
`main.ts` 的 `ipcMain.handle` 与 preload 的 `invoke` 天然接受 Promise，二者零改动）。

`types.ts` 只新增可选字段（既有字段未删除、未改语义）：

| 字段 | 用途 |
|---|---|
| `AmpManifestView.signatures?` / `public_key?` | 离线复算 digest 并验证 Ed25519 签名 |
| `AmpSliceItem.inputs?` | `salience` 的原始输入，支持用参考 `salience()` 精确复算 `value` |
| `AmpSnapshot.frame?` | 本次 attend 的参考 Frame（id/digest/mode/cycle/slots/ignored） |
| `AmpSnapshot.impact?` | EvidenceGraph 的冲突影响闭包 |
| `AmpSnapshot.ledger_checkpoint?` | 链尖 Ed25519 checkpoint（seq/count/tip/sig） |
| `AmpResolveData.page?` | `HandleStore.read` 的分页信息（tokens/total_pages/next） |
| `AmpSelfAttention.health?` | `attention/resource` 的健康度 |
| `AmpSelfView.throughput?` | `qualityAdjustedThroughput` |

新增公开方法 `AmpEngine.verifyLedger()`（只增不改，`main.ts`/preload 未使用）：用参考
`verifySnapshot` 校验、`restoreLedger` 重放、再 `exportLedger` 比对 tip/count/整链 digest。

## 5. 行为变化（有意为之）

1. **句柄 id**：由 `amp://h/sha256:<hex>` 改为参考 `HandleStore` 的不透明 `h.<10 hex>`（更贴 §11.3 的
   “句柄不是能力令牌”）。`AmpHandleView`/`AmpResolveData.handle` 形状不变。
2. **账本 verb 变多**：`resolve` 也会追加一条账本事件（并写 `op:"read"` 回执）；账本条目来自
   `exportLedger` 的 `event`/`receipt` 两类，`seq` 从 1 连续、`prev_hash` 首条为
   `sha256:000…0`（64 个 0），链由参考 `digestOf({seq,kind,payload,prev})` 产生。
3. **Manifest digest 覆盖载荷**：`{id, version, issued_at, valid_until, claims, affordances, process}`
   由 `contentDigest` 计算；冲突 claim 落账后版本 +1 并重新签名，因此任意时刻都可用
   `contentDigest(view 的七个字段)` 复算。`values.digest = digestOf({weights, caps, approval})`。
4. **`capability_load` 语义**：只统计“被调用的能力”（act 成本 read=1 / validate=1 / approve=2 / publish=3）；
   attend/resolve 属于注意层，记为 0。默认 caps 下完整流程 `capability_load = 7/10`，可跑完。
5. **`act.approval`**：仍以 grant 的 **handle** 为主键；额外接受 `snapshot.grants[].id` 作为回退查找。

## 6. 运行时 import 约束

引擎从 `electron/amp/engine.ts` 出发的运行时 import 闭包只包含
`bayes/*`、`attention/*`、`boundary/*`、`error/*`、`evidence/*`、`execution/*`、`frame/*`、`goal/*`、
`ledger/*`、`manifest/*`、`policy/*`、`receipt/*`、`semantic/*`、`structure/*`、`types/*`、`warrant/*`
（以及 `node:` 内置无）。不含 `kernel/scheduler`、`database/*`、`store/*`、`process/*`、`thread/*`、
`window/*`、`authz/*`、`registry/*`、`ipc/*`、`lock/*`、`concurrency/*`、`progress/*`，因此 Electron 30
（Node 20.16）运行时不会触碰 `node:sqlite`。闭包清单见最终报告。
