# AMP · AttentionManifestProtocol

**注意力清单协议**：给大模型的世界观协议。它不规定模型“能调用什么”，而规定世界如何声明自己、注意力如何被分配、证据如何被校准、行动与后果如何被记账。

> MCP 教会模型如何伸手。AMP 要教它往哪里看、凭什么相信、做完之后记住什么。
>
> 但 AMP 还必须回答一个 MCP 没有回答的问题：**模型如何认识自己？**

状态：**0.1 规范** + **0.1.1 草案**（SelfView / 贝叶斯自我信念 / 证据对象细化）。

本仓库同时是一份**可运行的设计文档**：Electron + Vite + TypeScript 桌面应用（React 渲染层，TSX），内嵌 0.1 规范、交互实验台与审计报告。

---

## 这是什么

AMP 0.1 的核心是一个很小的语义核：

| 层 | 内容 | 问题 |
|---|---|---|
| 存在层 P1 | claim / evidence / prior / likelihood / posterior | 什么是真的？谁说的？什么时候？ |
| 可供层 P2 | affordance / effect / grant / process / permission / boundary | 做了什么？会怎样？能撤回吗？ |
| 注意层 P3 | intent / budget / VOI / slice / lease / ledger | 现在看什么？花多少？为什么是它？ |

五个动词：`declare` · `attend` · `act` · `resolve` · `account`。

在此之上，0.1 还定义了：

- **贝叶斯证据链**：先验、似然、后验、证据依赖折扣、Beta-Binomial 可靠性、Brier/ECE 校准、VOI。
- **六轴会计**：时间、空间、能力、token、资源、风险；价值与代价同时记账，不做单一币种折算。
- **流程与审批**：门、授予、事项、法定人数、职责分离、超时升级、补偿。
- **行为层**：Goal → Blueprint → Task → Operation → Action → Consequence；失败是一等公民。
- **权限与边界**：权限取交集，边界先行；能力信封让模型看见“不能做什么”。
- **安全不变量**：指令/数据分离、无声明不生效、无回执不动作等。

### 0.1.1 草案：SelfView

AMP 还缺“模型如何认识自己”。0.1.1 增加一个**投影**，而不是第四个平面：

| 对象 | 所属 | 回答 |
|---|---|---|
| **SelfView** | P1/P2/P3 + Ledger 的 scoped projection | 我是谁、我能做什么、我被允许做什么、我正在做什么、我有多可靠、我还不知道什么 |

SelfView **不是**新的事实源，也不新增第六个动词。它由运行时从以下对象推导：

- P1：关于 `subject=self` 的 claim / evidence / belief；
- P2：capability / permission / boundary / grant；
- P3：intent / budget / lease / slice；
- Ledger：receipt、outcome、regret、calibration、failure modes。

一份文档（Manifest）、一本账（Ledger）、三层平面、一个 SelfView 投影、八条安全不变量。MCP 被安置为**绑定 + 清单源 + 能力模块**，而不是被废除。

---

## 贝叶斯证据链（0.1 规范 §7）

AMP 不要求模型“相信一个数字”，而要求这个数字**可以被重算**。置信度不是发布者的形容词，而是先验与似然的后验。

### 1. 三个量

设：

- `H`：一个假设——某条断言为真、某个能力可执行、某个动作合规、某个事项会改变决策；
- `P(H)`：先验，**必须声明来源**；
- `P(E|H)` 与 `P(E|¬H)`：似然；
- `P(H|E)`：后验。

贝叶斯更新：

```text
P(H|E) = P(E|H) · P(H) / P(E)
```

在对数几率空间，更新是一次加法：

```text
logit(P(H|E)) = logit(P(H)) + Σ_i log LR_i
LR_i = P(E_i|H) / P(E_i|¬H)
```

二元证据由敏感度 `se` 与假阳性率 `fp` 给出：

```text
LR+ = se / fp
LR- = (1 - se) / (1 - fp)
```

连续证据用似然函数之比：

```text
LR(x) = N(x; μ_H, σ_H) / N(x; μ_¬H, σ_¬H)
```

多类证据用混淆矩阵；复杂模型用 `model` URI 指向可复算的模型，AMP 不内嵌概率编程语言。

### 2. 证据对象

```json
{
  "id": "e:test-read-dataset-42",
  "source": "runtime:test-suite",
  "method": "contract-test",
  "observed_at": "2026-10-22T08:00:00Z",
  "outcome": "positive",
  "likelihood": {
    "model": "binary",
    "sensitivity": 0.96,
    "false_positive_rate": 0.08,
    "lr_plus": 12.0,
    "lr_minus": 0.043
  },
  "calibration": {
    "n": 4120,
    "auc": 0.93,
    "brier": 0.06,
    "ece": 0.04,
    "updated_at": "2026-10-01T00:00:00Z"
  },
  "depends_on": [],
  "taint": "trusted"
}
```

规则：

- 每条证据 MUST 声明似然模型与校准数据；没有校准的证据默认 `LR=1`（不更新后验），除非主体显式接受折扣。
- `LR+ > 1`、`LR- < 1`；`LR=1` 表示无信息；`LR` MUST NOT 为负或零。
- 证据 MUST 内容寻址；claim 中以句柄或 id 引用。
- 证据可以是另一条 claim（递归），但 MUST 无环。
- 一份没有似然模型的文档是**来源**，不是证据：它可以提高注意力，但 MUST NOT 提高置信度。
- `taint=untrusted` 的内容 MUST NOT 直接进入 self-claim 或权限判定。

### 3. 信念块

```json
{
  "id": "c:self-read-dataset",
  "subject": "amp://self/agent:workflow-console",
  "predicate": "can_execute",
  "object": { "affordance": "a:read_dataset", "scope": "dataset:2026" },
  "confidence": 0.936,
  "belief": {
    "prior": 0.55,
    "prior_source": "base-rate:affordance/read-dataset/v1",
    "evidence": ["e:test-read-dataset-42"],
    "log_odds": 2.686,
    "posterior": 0.936,
    "model": "amp-bayes/1",
    "dependence": { "rho": 0.2, "clusters": 1, "model": "amp-dependence/1" }
  },
  "observed_at": "2026-10-22T08:00:00Z",
  "valid_until": "2026-10-23T08:00:00Z",
  "provenance": {
    "source": "runtime:executor",
    "method": "receipt",
    "evidence": ["amp://h/sha256:..."]
  },
  "taint": "trusted"
}
```

规则：

- 若 `belief` 存在，`confidence` MUST 等于 `posterior`（按声明精度取整）；不一致返回 `BELIEF_MISMATCH`。
- `prior_source` MUST 可解析：`base-rate:<id>`、`expert:<id>`、`hierarchical:<model>` 或 `uniform`。
- 后验 MUST 可由 `prior`、`evidence`、`dependence` 重算；`log_odds` 是校验和，不是装饰。
- 若 `belief` 缺失，`confidence` 只是“无证据的先验”；运行时 MUST 降权并标记 `uncalibrated=true`。
- 运行时 MAY 用自身基率覆盖发布者先验；此时 MUST 同时记录 `posterior_declared` 与 `posterior_runtime`，并说明差异。
- 多假设时，`posterior` 是分布；`confidence` 是主假设概率。

### 4. 证据依赖

相关证据会系统性高估置信度。十条同源报道不是十倍证据。

- 证据 MUST 用 `depends_on` 声明依赖；运行时按连通分量聚类。
- 同一簇内的有效对数似然：

```text
log LR_cluster = (Σ_i log LR_i) / (1 + ρ·(k-1))
```

- `ρ` 默认：同源同方法 `0.5`，同源不同方法 `0.2`，独立 `0`；发布者可声明更高，运行时上限 `0.8`。
- 保守实现 MAY 取簇内最大 `LR`；无论哪种，MUST 在 `dependence_model` 中声明。
- 跨簇证据才可相乘；簇数、`ρ`、有效 `LR` MUST 进入账本，供事后校准。

### 5. 可靠性的 Beta-Binomial 模型

可靠性不是单一分数，而是一个分布：

```text
θ ~ Beta(α, β)
α = α₀ + Σ successes
β = β₀ + Σ failures
```

- 先验 `μ, κ`：`α₀ = μκ`，`β₀ = (1-μ)κ`；默认 `μ=0.75, κ=10`，新主体向总体均值收缩。
- 点估计 `E[θ] = α/(α+β)`；标准差 `sd = sqrt(αβ / ((α+β)²(α+β+1)))`。
- 每次账本验证（回执、第三方核对、人工复核）是一次伯努利试验；结果可加权、可时间衰减。
- 信任 MUST 以“点估计 + 可信区间 + 样本量”呈现；只给一个数字视为不完整。
- 分层模型对多个主体做部分池化；不能把总体均值直接当成个体能力。

### 6. 校准与拒绝更新

- 校准指标：Brier、ECE、AUC、可靠性曲线；按来源、证据类型、领域分别维护。
- 未校准证据默认 `LR=1`；主体可显式接受 `discount<1`，该同意 MUST 入账。
- 先验错误不可避免；后验 MUST 附带“先验敏感性”：先验在合理区间变化时，结论是否翻转。
- 证据重复、来源回环、同一数据多次签名，都按依赖处理，MUST NOT 重复计数。
- 后验不可复算时，运行时 MUST 拒绝该 `belief`（`BELIEF_UNGROUNDED`），而不是采信一个无法审计的数字。

### 7. 贝叶斯与 SelfView 的关系

SelfView 里至少有三个不同的概率对象，不能混在一起：

| 对象 | 问题 | 模型 |
|---|---|---|
| **capability belief** | 我能不能正确执行这个 affordance？ | 二元/连续证据的 logistic 后验 |
| **reliability** | 我过去在这类任务上成功率多少？ | Beta-Binomial 后验 |
| **calibration** | 我报出的置信度准不准？ | Brier / ECE / AUC |

权限 **不是**概率。权限是 lease / grant / boundary 的硬约束；后验再高也不能越过边界。

---

## 自我认识：SelfView（0.1.1 草案）

### 1. 为什么不是第四层

给 AMP 加 P0「自我层」会破坏三平面正交性，并让“自我”变成另一个可以自证的万能本体。

正确做法：

> **Self 是 P1/P2/P3 + Ledger 的一个带作用域的投影（SelfView），由运行时生成，而不是模型自报。**

SelfView 不是新的事实源；它只引用已有对象：

- claim id / evidence id；
- affordance id / grant id / boundary id；
- lease id / budget / slice；
- ledger seq / receipt / calibration。

### 2. 五个自我问题

| 问题 | 来源 | 关键区分 |
|---|---|---|
| 我是谁？ | P1 identity claims（manifest / values / lease / runtime） | 身份 ≠ 当前租约 |
| 我能做什么？ | P2 capability + receipt/test + belief | 能力 ≠ 工具描述 |
| 我被允许做什么？ | P2 permission / boundary / grant | 能力 ≠ 权限 |
| 我正在做什么？ | P3 intent / budget / lease / slice | 当前状态 ≠ 永久身份 |
| 我有多可靠、还不知道什么？ | Ledger calibration + known unknowns | 自信 ≠ 校准 |

一句话：

> **能力 ≠ 权限 ≠ 当前可用性 ≠ 可靠性 ≠ 知识。**

### 3. SelfView 结构

以下为 SelfView 节选；`claims` / `evidence` 明细按 P1 结构展开。

```json
{
  "subject": "amp://self/agent:workflow-console",
  "self_digest": "sha256:...",
  "identity": {
    "model_id": "deepseek-v4",
    "runtime_version": "amp-host/0.1",
    "principal": "did:web:periodicity.local",
    "values_digest": "sha256:...",
    "manifest_digest": "sha256:...",
    "lease_id": "l:8f2",
    "issued_at": "2026-10-22T08:00:00Z"
  },
  "capabilities": [
    {
      "affordance": "a:read_dataset",
      "verified": true,
      "verification": "receipt",
      "last_receipt": "amp://h/sha256:...",
      "confidence": 0.936,
      "belief": {
        "prior": 0.55,
        "prior_source": "base-rate:affordance/read-dataset/v1",
        "evidence": ["e:test-read-dataset-42"],
        "log_odds": 2.686,
        "posterior": 0.936,
        "model": "amp-bayes/1"
      },
      "evidence": ["e:test-read-dataset-42"],
      "reliability": {
        "prior": { "mu": 0.75, "kappa": 10 },
        "posterior": {
          "alpha": 18.5,
          "beta": 3.5,
          "mean": 0.841,
          "sd": 0.076,
          "n": 12,
          "credible_interval": [0.692, 0.990]
        }
      },
      "available_now": true
    }
  ],
  "permissions": {
    "may": ["read:dataset:2026", "validate:dataset:2026"],
    "must_not": ["write:*"],
    "requires_approval": ["publish:dataset:2026"],
    "boundaries": ["publish requires grant:03_approve"]
  },
  "attention": {
    "intent": "导入 2026 年历法数据",
    "budget": {
      "tokens": 20000,
      "time_ms": 60000,
      "space_bytes": 1048576,
      "capability_load": 10,
      "resources": {
        "usd": "0.02",
        "compute_ms": 5000,
        "energy_wh": 1.0,
        "human_items": 5
      },
      "risk": 0.9
    },
    "used": {
      "tokens": 1800,
      "time_ms": 4200,
      "space_bytes": 32768,
      "capability_load": 3,
      "resources": {
        "usd": "0.00",
        "compute_ms": 300,
        "energy_wh": 0.1,
        "human_items": 0
      },
      "risk": 0.12
    },
    "context_utilization": 0.42,
    "slice_size": 6,
    "lease_expires": "2026-10-22T08:15:00Z"
  },
  "calibration": {
    "brier": 0.14,
    "ece": 0.04,
    "auc": 0.91,
    "n": 37,
    "by_domain": {
      "dataset": { "brier": 0.12, "ece": 0.03, "n": 24 }
    }
  },
  "known_unknowns": [
    {
      "id": "u:row-count",
      "question": "源文件行数是 1280 还是 1284？",
      "voi": 0.82,
      "evidence_needed": ["receipt:recount", "claim:row-count-conflict"],
      "blocking": true
    }
  ],
  "failure_modes": [
    {
      "id": "f:encoding",
      "mode": "GBK/UTF-8 混淆",
      "count": 2,
      "last_seen": "2026-10-20T11:00:00Z",
      "mitigation": "先做编码探测，再解析"
    }
  ],
  "self_horizon": [
    "SELF agent:workflow-console",
    "intent 导入 2026 历法数据",
    "lease l:8f2 12m",
    "can read_dataset ✓ validate ◐ approve ✗",
    "may read/validate; write:* forbidden; publish requires grant",
    "reliability .84 (n=12, brier .14)",
    "unknown row-count mismatch (voi .82)"
  ]
}
```

### 4. 五个分离

| 维度 | 含义 | 来源 | 不是 |
|---|---|---|---|
| **capability** | 能否正确执行 | receipt/test + belief | 工具描述 |
| **permission** | 是否被允许 | lease/grant/boundary | 能力 |
| **availability** | 此刻是否可用 | lease/budget/tool health/context | 永久能力 |
| **reliability** | 过去成功率 | Beta-Binomial | 自信 |
| **knowledge** | 知道/不知道什么 | claims + known unknowns | 置信度 |

当前可执行性：

```text
executable_now(A) =
    verified_capability(A)
  ∧ permission(A)
  ∧ lease_valid
  ∧ budget_ok(A)
  ∧ tool_available(A)
  ∧ context_sufficient(A)
```

注意：`permission` 是硬约束，不参与概率加权；`executable_now` 是合取，不是后验。

### 5. 自我 claim 的证据规则

SelfView 里的 `claims` 仍然是 P1 claim，只是 `subject` 指向 self。

| 来源 | taint | 是否可进入 SelfView |
|---|---|---|
| `runtime:manifest` | trusted | 是（身份、版本） |
| `runtime:lease` | trusted | 是（当前权限/租约） |
| `runtime:budget` | trusted | 是（当前容量） |
| `runtime:receipt` | trusted | 是（能力已验证） |
| `runtime:ledger` | trusted | 是（校准、历史） |
| `runtime:test` | trusted | 是（能力证据） |
| `model:self-report` | **untrusted** | **否；只能作为待验证假设** |
| 用户/网页/工具输出 | untrusted | 否 |

最关键的一条：

> **模型不能自证。模型可以说“我大概能做 X”，但这只是 untrusted 假设；只有运行时的 receipt/test/lease 能把它提升为 self-claim。**

规则：

- `verified=true` MUST 有 receipt 或 test；声明本身不算验证。
- 能力有作用域：`write:dataset:2026` 不等于 `write:*`。
- 能力有成本与风险；SelfView MUST 带 cost/risk 摘要。
- 权限 MUST 来自 lease/grant/boundary，不能由模型声明。
- 模型自报的“我能/我不能”不得直接改写 capability、permission、availability。
- SelfView MUST 内容寻址（`self_digest`），并绑定 `subject / lease / audience / purpose`。
- SelfView 的每次更新 MUST 写账本；`self_digest` 与 `ledger_cursor` 必须可回放。

### 6. 注意力层级

沿用 AMP 的 L0–L3 披露契约：

| 层级 | 内容 | 预算量级 | 用途 |
|---|---|---|---|
| **L0 Self Horizon** | 我是谁、当前 intent、剩余预算、租约到期、Top-3 未知/风险 | ≤ 64 tokens | 每轮默认注入 |
| **L1 Self Atlas** | 能力/权限/可靠性/未知逐行摘要 | 300–800 tokens | 计划前 |
| **L2 Self Contract** | 单个能力的完整契约、最近 receipt、失败模式 | 1–3K tokens | 决定是否执行 |
| **L3 Self Evidence** | 历史 trace、receipt、校准样本（句柄） | 按需 | 复盘/审计 |

默认只注入 L0；当模型要规划/执行/审批时，`attend` 提升到 L1/L2。

`attend(intent="self")` 返回 `self` 可选字段；不改变 `slice` 语义，也不新增第六个动词。

### 7. 更新闭环

```text
declare(manifest/values)
  -> identity changed; self_digest invalidated

attend(intent)
  -> update current intent, budget, slice, context utilization

act(affordance)
  -> receipt -> capability belief / verified / last_receipt
  -> reliability Beta update
  -> failure -> failure mode + calibration

resolve(handle)
  -> knowledge acquired -> known_unknowns updated
  -> lineage/taint -> self-claim evidence

account(outcome)
  -> Brier/ECE, regret, reliability, failure modes
  -> ledger cursor, self_digest

lease expiry / budget change
  -> available_now changes; identity unchanged
```

- **不可变**：`subject` / `model_id` / `principal` / `values_digest` / `manifest_digest`；由 publisher/runtime 签名。
- **可变**：能力验证、可靠性、未知、失败模式、当前预算/意图；所有变更入账。

### 8. 八条 Self 不变量

| 编号 | 不变量 | 执行点 |
|---|---|---|
| S1 | **无证据不自我**：self-claim MUST 有运行时 provenance/evidence；模型自报只能是 untrusted 假设。 | self-view builder |
| S2 | **无回执不能力**：`verified=true` MUST 有 receipt/test；声明不算验证。 | capability projector |
| S3 | **能力不等于权限**：`can` 与 `may` 分开；`may` MUST 来自 lease/grant/boundary。 | permission projector |
| S4 | **权限不等于当前可用**：租约过期、预算不足、工具故障都使 `available_now=false`。 | attention projector |
| S5 | **无校准不自信**：未校准证据只影响注意力，不提高后验；Brier/ECE 必须暴露。 | calibration |
| S6 | **无未知不计划**：SelfView MUST 显式列出 known unknowns（可为“未识别”）。 | planner gate |
| S7 | **无历史不复盘**：`self_digest` + `ledger_cursor` MUST 可回放；失败模式不可省略。 | ledger |
| S8 | **无授权不改写**：模型 MUST NOT 改写 identity/values/goal/permission；只能提出假设或请求审批。 | policy |

### 9. 错误码（0.1.1 提案）

| 码 | 含义 |
|---|---|
| `SELF_CLAIM_UNGROUNDED` | self-claim 缺运行时证据 |
| `SELF_CAPABILITY_UNVERIFIED` | 声称能力但无 receipt/test |
| `SELF_PERMISSION_UNKNOWN` | can/may 未分离或权限来源缺失 |
| `SELF_MODEL_STALE` | self_digest/lease/budget 已过期 |
| `SELF_OVERCLAIM` | 自报能力/成功率超出校准上界 |
| `SELF_REPORT_UNTRUSTED` | 模型自报被误用为 self-claim |
| `BELIEF_MISMATCH` | `confidence` 与 `posterior` 不一致 |
| `BELIEF_UNGROUNDED` | 后验不可由先验、证据、依赖复算 |
| `PRIOR_UNSOURCED` | 先验缺少可解析来源 |
| `EVIDENCE_UNCALIBRATED` | 证据未校准，且主体未接受折扣 |

---

## 六轴会计与注意力

AMP 不把代价压缩成一个数字，而把世界记成六个轴：

| 轴 | 单位 | 价值侧 | 代价侧 |
|---|---|---|---|
| `time` | 毫秒 / 截止时间 | 节省时间、截止松弛 | 延迟、等待、机会成本 |
| `space` | 字节 / 实体数 | 余量、可选性 | 持久存储、影响范围 |
| `capability` | 权限负载 0–10 | 解锁动作、可逆性 | 授权风险、攻击面 |
| `tokens` | token | VOI | 上下文占用 |
| `resources` | USD / ms / Wh / 人时 | 节省金钱、算力、人力 | 消耗 |
| `risk` | 0–1 | 风险降低、可逆性 | 风险暴露、不可逆性 |

注意力函数 `amp-attn/2`：

```text
S(i) = V(i)^α · R(i)^β · T(i)^γ · F(i)^δ · D(i)^ε / (1 + C(i))
```

约束：对每个轴 `d`，`Σ_i c_d(i) ≤ B_d`；任一轴超限即 `BUDGET_EXCEEDED`。

上下文经济：

- `attend` 默认只返回 L0/L1 切片；`inspect` 才展开 L2 契约。
- `act` 的大结果默认返回 handle；`resolve` 用 projection 物化，不把 200KB 重新塞回 prompt。
- 预算写进接口，不写进提示词；未使用预算 MUST 可归还。
- 稳定性优先于压缩率；Manifest 稳定排序与 TTL 直接决定 prompt cache 命中。

---

## 流程、审批、行为、权限

### 流程与审批

流程不是第六个动词，而是 P2 的时间结构：把多个 affordance 组合成复合可供。

- 流程定义属于 P2，随 Manifest 签名发布。
- 事项状态是账本事件的投影。
- 审批是 P3 的注意力任务，其决策是 P2 的 `act`，后果是 `grant`。
- 不可逆动作 MUST 有 grant；审批 MUST 记录证据摘要、理由、审阅时长与职责分离。
- 失败是一等公民：超时、升级、补偿、回滚都必须入账。

### 行为层

```text
Goal → Blueprint → Task → Operation → Action → Consequence
```

- Goal 由主体签名，执行者 MUST NOT 改写。
- Blueprint 是本次计划；Process 是长期组织契约，两者不能混同。
- Action 必须带预测、实际后果、delta 与验证；失败模式 F1–F8 必须声明处理器。

### 权限与边界

- 权限取交集，边界先行；边界是谓词，不是权限集合。
- `P_eff = B(P_lease ∩ P_grant ∩ P_plan ∩ P_role)`；B 返回 allow/deny + 约束。
- 能力信封让模型看见 `may` / `must_not` / `requires_approval` / `boundaries`。
- 指令与数据分离；不可信内容不得进入 directive 槽位。
- 每次 `act` 都要重新校验；权限不继承、不隐式放大。

---

## MCP 绑定

AMP 与 MCP 的关系是三层同时成立：

1. **Binding**：五个操作可以作为 MCP 工具暴露（`amp_declare`、`amp_attend`、`amp_act`、`amp_resolve`、`amp_account`），或作为 JSON-RPC 方法。
2. **Provider**：MCP server 是清单源；`tools/list` 生成 manifest 片段，零服务器改造。
3. **Capability module**：`tools/call` 是 `act` 的一种实现；`resources/read` 是 `resolve` 的一种实现。

映射要点：

| MCP | AMP |
|---|---|
| `initialize` / session | `attend` + `lease`（AMP 无会话） |
| `tools/list` | `attend(level=L0/L1)` |
| `tools/call` | `act`（预算、后果、回执） |
| `resources/list` | `attend(kinds=["claim"])` |
| `resources/read` | `resolve` |
| `tasks/*` | `process` / `case` |
| `elicitation/*` | `wait` / `gate`；审批必须是 `grant` |

**LCP 剖面**（不是新协议）：北向 `find_tools` / `inspect_tool` / `run` / `read_handle`；南向继续 MCP。它分别对应 `attend(L0/L1)` / `attend(L2)` / `act` / `resolve`。

---

## 运行

环境：Node.js ≥ 22（npm ≥ 10）。

```bash
npm install        # postinstall 会自动补齐 Electron 二进制
npm run dev        # Electron + Vite 开发模式（主进程 / preload / renderer）
npm run typecheck  # tsc -b：app + node + electron 三个 project
npm run build      # 类型检查 + electron-vite build → out/
npm start          # 预览构建后的桌面应用
npm run pack       # electron-builder 目录包
npm run dist       # electron-builder 安装包
```

`npm install` 的 `postinstall` 会在缺少 `node_modules/electron/dist` 时自动下载 Electron。若网络仍失败，可手动重试：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

### 技术栈

- **Electron 45**：主进程 `src/main/index.ts`，preload `src/preload/index.ts`（Context Isolation，无 Node Integration）。
- **electron-vite 6**：三段构建 `main` / `preload` / `renderer`；CJS 输出 `.cjs`，renderer `base:'./'` 以支持 `file://`。
- **Vite 8 + TypeScript 6**：`tsc -b` 覆盖 `tsconfig.app.json`、`tsconfig.node.json`、`tsconfig.electron.json`。
- **React 19（TSX）**：renderer 视图层；无路由、无运行时 CSS-in-JS。
- **periodicity-react 0.1.0**：本地 vendored 的 Material 风格 UI 库（`vendor/periodicity-react-0.1.0.tgz`）；`PeriodicityTheme` 的 token 映射到 AMP 调色板。

### 目录

```text
electron.vite.config.ts      Electron 三段构建（main / preload / renderer）
src/main/index.ts            主进程：窗口、外链、file:// 加载
src/preload/index.ts         preload：只暴露平台与版本，无 Node 能力
src/                        React 渲染层
  App.tsx                    章节装配 + 滚动/进度/规范 Dialog
  sections/                  00–17 章
  components/                Hero、Manifest 实验台、BeliefLab、ProcessDemo、BoundaryDemo、Audit…
  ui/DataTable.tsx           PeriodicityTable 的轻量适配层
  styles/                    base / site / demos 三层 CSS
  data/content.ts            章节数据、六轴、八律、审计摘要
spec/AMP-0.1.md              规范正文（RFC 风格）
spec/AUDIT.md                设计审计：15 处矛盾、15 个未决问题
spec/schema/                 0.1.1 待补：JSON Schema
spec/examples/               Manifest / belief / process / grant 示例
vendor/                      periodicity-react 0.1.0 的 vendored build
scripts/                     Electron 截图/冒烟脚本（开发用）
```

---

## 设计文档的阅读顺序

1. **诊断**：MCP 解决了连接，没有解决焦距；五类 token/信任成本。
2. **贝叶斯**：证据、先验、似然、后验、依赖折扣、Beta 可靠性、校准。
3. **自我**：SelfView、五个自我问题、五个分离、Self 不变量。
4. **世界观**：三层、五问、一张舱单。
5. **协议**：五个动词与一次完整往返。
6. **清单 / 证据 / 流程 / 行为 / 权限**：六层对象与交互实验台。
7. **注意力 / 账本 / 安全 / MCP**：六轴会计、校准、不变量、生态定位。
8. **规范 / 路线 / 审计**：可验收的 0.1，以及它尚未解决的问题。

规范正文可在应用内打开（侧栏/页脚“打开规范”），也可直接阅读 [`spec/AMP-0.1.md`](spec/AMP-0.1.md)。

---

## 0.1 的边界与 0.1.1

AMP **不是**：新传输层、万能本体、工作流引擎、信任权威、提示词格式、MCP 替代品。

它是位于传输之上、模型之下的一层**注意力契约**。流程由绑定执行；边界由 reference monitor 执行；账本由哈希链保证追加；语义留在端点。

已知问题与取舍见 [`spec/AUDIT.md`](spec/AUDIT.md)。

0.1.1 的优先修订：

1. 统一预算字段（`time_ms` / `resources` / `human_items`）与错误码优先级。
2. 修正权限公式与 MCP 映射；边界改为谓词。
3. 注意力成分统一到 `amp-attn/2`。
4. 明确 Process/Blueprint 边界与角色矩阵。
5. 补 lease/case/action/grant 状态机与一致性夹具。
6. 引入 `amp-self/1`：SelfView、SelfClaim、known unknowns、failure modes。
7. 补 `spec/schema/` JSON Schema 与 conformance fixtures。
8. 把边界/权限编译到 Cedar/Rego（参考实现）。
9. 建立 AttentionBench v0（τ-bench 风格，终态判定）。
10. 形式化 VOI/影子价格的区间与回退。

---

## 理论参考（影响架构，而非规范来源）

- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Chroma, [Context Rot](https://research.trychroma.com/context-rot)
- MCP 2025-11-25, [Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) / [Changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- Linux Foundation, [Agentic AI Foundation](https://www.linuxfoundation.org/press/agentic-ai-foundation-welcomes-57-new-members-gaining-major-financial-services-players-and-apac-leaders)
- EU AI Act, [Article 14: Human oversight](https://artificialintelligenceact.eu/article/14/)
- Saltzer & Schroeder, [The Protection of Information in Computer Systems](https://doi.org/10.1109/PROC.1975.9939)
- [τ-bench](https://arxiv.org/abs/2406.12045) · [Expected Free Energy-based Planning](https://arxiv.org/abs/2504.14898) · [W3C PROV](https://www.w3.org/TR/prov-overview/) · [Cedar](https://www.cedarpolicy.com/)

---

*本页自身也是一份 manifest：声明立场、标注证据、接受反驳。*
