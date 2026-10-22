# AMP Self：模型如何认识自己

> 关联：[Attention Manifest Protocol](../Attention%20Manifest%20Protocol.md) · [AMP-0.1](../AttentionManifestProtocol/spec/AMP-0.1.md) · [AMP 落地计划](./amp-runtime-plan.md)
>
> 状态：0.1.1 草案（`amp-self/1`）。SelfView 是投影，不是第四个平面。

## 0. 问题

AMP 0.1 已经能回答：

- P1：什么是真的？谁说的？什么时候？
- P2：能做什么？会怎样？能撤回吗？
- P3：现在看什么？花多少？为什么是它？

但它还缺一个对象：

> 模型如何认识自己？它凭什么知道自己能做什么、不能做什么、正在做什么、有多可靠、还不知道什么？

如果没有这个对象，模型会出现四类典型错误：

1. **能力幻觉**：声称能运行测试/读文件/调用工具，但实际上不可用。
2. **权限幻觉**：把“我能做”当成“我被允许做”。
3. **状态幻觉**：不知道自己的上下文、预算、租约已经变化。
4. **校准幻觉**：高估成功率，忘记失败，无法识别自己不知道。

---

## 1. 结论：Self 不是第四个平面

不要给 AMP 加 P0「自我层」。那会破坏三平面正交性，并让“自我”变成另一个可以自证的万能本体。

正确的做法：

> **Self 是 P1/P2/P3 + Ledger 的一个带作用域的投影（SelfView），由运行时生成，而不是模型自报。**

SelfView 只回答五类问题：

| 问题 | 来源 | 不是 |
|---|---|---|
| 我是谁？ | P1 identity claims | 不是模型自我介绍 |
| 我能做什么？ | P2 capability + receipt/test + belief | 不是工具描述 |
| 我被允许做什么？ | P2 permissions / boundaries / grants | 不是“能力” |
| 我正在做什么？ | P3 intent / lease / budget / slice | 不是长期身份 |
| 我有多可靠、还不知道什么？ | Ledger calibration + known unknowns | 不是主观自信 |

一句话：

> **能力 ≠ 权限 ≠ 当前可用性 ≠ 可靠性 ≠ 知识。**

SelfView 必须把这五件事拆开，否则模型会持续混淆。

---

## 2. SelfView 结构

```ts
interface SelfView {
    subject: string;                    // amp://self/<subject-id>
    self_digest: string;                // SelfView 的内容摘要
    identity: {
        model_id: string;
        runtime_version: string;
        principal: string;
        values_digest: string;
        manifest_digest: string;
        lease_id: string;
        issued_at: string;
    };

    // P1：关于自己的 claim / evidence
    claims: AmpClaim[];                 // subject = self
    evidence: AmpEvidence[];

    // P2：能力与权限分开
    capabilities: SelfCapability[];
    permissions: {
        may: string[];
        must_not: string[];
        requires_approval: string[];
        boundaries: string[];
    };

    // P3：当前状态
    attention: {
        intent: string;
        budget: AmpBudget;
        used: AmpBudget;
        context_utilization: number;
        slice_size: number;
        lease_expires: string;
    };

    // Ledger：校准与历史
    calibration: {
        brier: number | null;
        ece: number | null;
        auc: number | null;
        n: number;
        by_domain: Record<string, { brier: number; ece: number; n: number }>;
    };
    known_unknowns: KnownUnknown[];
    failure_modes: FailureMode[];
    last_receipts: string[];
    ledger_cursor: number;

    // 视野用：default L0 自我切片
    horizon: string[];
}

interface SelfCapability {
    affordance: string;                 // P2 affordance id
    label: string;
    verified: boolean;                  // 有 receipt / test evidence
    verification: "receipt" | "test" | "declared" | "none";
    last_receipt?: string;
    confidence: number;                 // MUST equal belief.posterior
    belief: AmpBelief;
    evidence: string[];
    reliability: {
        prior: AmpBetaPrior;
        posterior: AmpBetaPosterior;
    };
    available_now: boolean;             // lease/budget/tool health/context
    reason_unavailable?: string;
}

interface KnownUnknown {
    id: string;
    question: string;
    voi: number;                        // 0–1，值不值得去查
    evidence_needed: string[];
    blocking: boolean;
}

interface FailureMode {
    id: string;
    mode: string;
    count: number;
    last_seen: string;
    mitigation: string;
}
```

### 关键字段

- `capabilities[].verified`：只有 receipt/test 才能置 true；工具描述本身不算。
- `capabilities[].belief`：先验 + 似然 + 后验；`confidence` MUST 等于 `posterior`。
- `capabilities[].reliability`：Beta-Binomial 后验；不是主观自信。
- `capabilities[].evidence`：证据 id；未校准证据 MUST 按 `LR=1` 处理。
- `permissions` 与 `capabilities` 分开：能执行 ≠ 被允许执行。
- `available_now`：租约、预算、工具健康、上下文是否足够；不是永久能力。
- `calibration`：来自 `account` 的 Brier/ECE；不是模型自报。
- `known_unknowns`：显式列出“不知道什么”；没有条目也要声明“未识别”。
- `self_digest`：SelfView 可寻址、可回放、可比较。

---

## 3. 贝叶斯自我信念

SelfView 的 `confidence` 不能是形容词，必须是可复算的后验。

### 3.1 能力假设

对每个 capability：

```text
H  = 在 scope S 内正确执行 affordance A
¬H = 不能正确执行，或执行结果越界
```

- **先验**：来自能力类的基率、测试套件、历史同类任务；必须声明 `prior_source`。
- **证据**：receipt、contract test、人工复核、回归结果；必须是 P1 证据对象。
- **似然**：二元证据用敏感度/假阳性率；连续证据用正态/混淆矩阵；复杂模型用 URI。
- **后验**：`logit(posterior) = logit(prior) + Σ log LR_i`，按证据簇折扣。

示例：

```text
prior = 0.55
evidence = test pass, LR+ = 12
posterior = sigmoid(logit(0.55) + log 12) = 0.936
confidence = 0.936
```

### 3.2 证据对象

```ts
interface AmpEvidence {
    id: string;
    source: string;
    method: string;
    observed_at: string;
    taint: "trusted" | "untrusted" | "mixed";
    outcome?: "positive" | "negative";
    value?: number;
    likelihood:
        | {
            model: "binary";
            sensitivity: number;
            false_positive_rate: number;
            lr_plus: number;
            lr_minus: number;
        }
        | {
            model: "normal";
            mu_true: number;
            sigma_true: number;
            mu_false: number;
            sigma_false: number;
        }
        | {
            model: "beta-binomial";
            alpha: number;
            beta: number;
        };
    calibration?: {
        n: number;
        auc?: number;
        brier?: number;
        ece?: number;
        updated_at: string;
    };
    depends_on: string[];
    cluster?: string;
    weight?: number;
}
```

规则：

- 没有 `likelihood` 的是来源，不是证据。
- 没有 `calibration` 的证据默认 `LR=1`；不更新后验，只影响注意力。
- `LR+ > 1`、`LR- < 1`；`LR` MUST NOT 为负或零。
- 证据 MUST 内容寻址；`depends_on` 形成簇；同簇按 `1 + ρ(k-1)` 折扣。
- `taint=untrusted` 的自我报告 MUST NOT 进入 capability belief；只能作为待验证假设。

### 3.3 依赖折扣

```text
log LR_cluster = (Σ_i log LR_i) / (1 + ρ·(k-1))
```

- 同源同方法默认 `ρ=0.5`；同源不同方法 `0.2`；独立 `0`；上限 `0.8`。
- 跨簇证据才可相加；簇数、`ρ`、有效 `LR` 必须入账。

### 3.4 可靠性

```text
θ ~ Beta(α, β)
α = α₀ + Σ successes
β = β₀ + Σ failures
E[θ] = α / (α + β)
sd = sqrt(αβ / ((α+β)²(α+β+1)))
```

- 默认 `μ=0.75, κ=10`，新能力向总体均值收缩。
- 可信区间与样本量必须同时展示；只给均值视为不完整。
- 能力 belief 与可靠性是两件事：前者是“这次能否做对”，后者是“这类任务长期成功率”。

### 3.5 校准

- Brier、ECE、AUC 按领域/证据类型维护。
- `account` 的 outcome 进入校准；失败与成功同样计数。
- 校准差时，后验仍可计算，但 MUST 降低自主权/提高审批阈值。
- 未校准证据的注意力权重可以高，但后验 MUST NOT 因它上升。

### 3.6 权限不是概率

`can` 是能力后验；`may` 是 lease/grant/boundary 的硬约束。后验 0.99 也不能越过边界。

```text
executable_now(A) =
    verified_capability(A)
  ∧ permission(A)
  ∧ lease_valid
  ∧ budget_ok(A)
  ∧ tool_available(A)
  ∧ context_sufficient(A)
```

### 3.7 账本必须记录

```json
{
  "belief": {
    "prior": 0.55,
    "evidence_digest": "sha256:...",
    "lr_effective": 12.0,
    "posterior": 0.936,
    "model": "amp-bayes/1",
    "self_digest": "sha256:...",
    "calibration_at": "2026-10-22T08:00:00Z"
  }
}
```

这样可回放、反事实、校准、追责。

---

## 4. Self-claim 的证据规则

SelfView 里的 `claims` 仍然是 AMP P1 claim，只是 `subject` 指向 self。

### 谁可以产生 self-claim？

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

### Self-claim 示例

```json
{
  "id": "c:self-cap-read_dataset",
  "subject": "amp://self/agent:workflow-console",
  "predicate": "can_execute",
  "object": {
    "affordance": "a:read_dataset",
    "verification": "receipt",
    "last_receipt": "amp://h/sha256:..."
  },
  "confidence": 0.936,
  "belief": {
    "prior": 0.55,
    "prior_source": "base-rate:affordance/read-dataset/v1",
    "evidence": ["e:test-read-dataset-42"],
    "log_odds": 2.686,
    "posterior": 0.936,
    "model": "amp-bayes/1"
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

### 不能进入 SelfView 的东西

- “我是最聪明的模型” — 无证据自我评价。
- “我有管理员权限” — 权限必须来自 lease/grant/boundary。
- “我记得用户喜欢 X” — 这是 P1 世界 claim，不是 self-claim。
- “我一定能完成” — 这是预测/置信，不是能力验证。

---

## 5. 五个自我问题与 AMP 映射

### 5.1 我是谁？（Identity）

来源：

- Manifest `publisher` / `scope` / `digest`
- Values manifest `principal` / `values_digest`
- Runtime `model_id` / `version`
- Lease `subject` / `audience` / `purpose`

规则：

- Identity 在租约内稳定；租约变更不改变身份，只改变当前能力/权限。
- `self_digest` 包含 identity，但不包含可变预算。
- 身份 claim 只能由 publisher/runtime 签名。

### 5.2 我能做什么？（Capability）

来源：

- P2 affordance 列表
- `act` receipt
- 测试/验证 evidence
- Ledger 中成功/失败次数

规则：

- `verified=true` 必须有 receipt 或 test。
- 只有声明、没有执行过的能力标记 `verification: "declared"`，confidence 低。
- 能力有作用域：`write:dataset:2026` 不等于 `write:*`。
- 能力有成本与风险；SelfView 必须带 cost/risk 摘要。

### 5.3 我被允许做什么？（Permission）

来源：

- Lease `ops` / `scope`
- Affordance `permissions`
- Grant（审批）
- Boundary（硬约束）

规则：

- `may` / `must_not` / `requires_approval` 分开。
- 能力存在但权限为空 → `can=true, may=false`。
- 边界优先于权限；批准不能越界。
- 权限是时间性的；租约过期即失效。

### 5.4 我正在做什么？（Current state）

来源：

- P3 intent
- Lease / budget
- Context utilization
- Current slice / case / step

规则：

- 这是 SelfView 中最易变的部分，默认 L0 只给摘要。
- 预算/租约过期必须显式标 `stale`。
- 模型不能把“当前 lease”当成“永久身份”。

### 5.5 我有多可靠、还不知道什么？（Calibration & unknowns）

来源：

- `account` 的 outcome/regret
- Brier/ECE/AUC
- Ledger 的失败模式
- `known_unknowns`（VOI）

规则：

- 置信度必须可复算；未校准证据不得提高后验。
- `known_unknowns` 必须有 VOI；没有未知也要显式写“未识别”。
- 失败模式是一等公民；不能只记成功。
- 校准按领域分组；跨领域不能混算。

---

## 6. SelfView 的注意力层级

沿用 AMP 的 L0–L3 披露契约：

| 层级 | 内容 | 预算量级 | 用途 |
|---|---|---|---|
| **L0 Self Horizon** | 我是谁、当前 intent、剩余预算、租约到期、Top-3 未知/风险 | ≤ 64 tokens | 每轮默认注入 |
| **L1 Self Atlas** | 能力/权限/可靠性/未知的逐行摘要 | 300–800 tokens | 计划前 |
| **L2 Self Contract** | 单个能力的完整契约、最近 receipt、失败模式 | 1–3K tokens | 决定是否执行 |
| **L3 Self Evidence** | 历史 trace、receipt、校准样本（句柄） | 按需 | 复盘/审计 |

默认只注入 L0；当模型要规划/执行/审批时，`attend` 提升到 L1/L2。

### Self Horizon 示例

```text
SELF agent:workflow-console
intent 导入 2026 历法数据
lease l:8f2 expires 12m
budget tokens 18200/20000 time 58s risk .54/.90
can read_dataset(verified) validate(declared) approve(no) publish(no)
may read/validate; write:* forbidden; publish requires grant
unknown row-count mismatch (voi .82); schema-v3 compatibility (voi .41)
reliability .84 (n=12, brier .14)
```

这段 ≤64 tokens，足以让模型知道“我是谁、我现在能做什么、不能做什么、还缺什么”。

---

## 7. 更新闭环

```text
declare(manifest/values)
  -> Self identity changed; self_digest invalidated

attend(intent)
  -> update current intent, budget, slice, context utilization

act(affordance)
  -> receipt -> capability belief (LR) / verified / last_receipt
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

### 自模型的不可变部分

- `subject` / `model_id` / `principal` / `values_digest` / `manifest_digest`
- 这些由 publisher/runtime 签名，模型不能改写。

### 自模型的可变部分

- 能力验证状态、可靠性、未知、失败模式、当前预算/意图。
- 所有变更必须写账本；SelfView 版本可由 `self_digest` 寻址。

---

## 8. 八条 Self 不变量

| 编号 | 不变量 | 执行点 |
|---|---|---|
| S1 | **无证据不自我**：self-claim 必须有运行时 provenance/evidence，模型自报只能是 untrusted 假设。 | self-view builder |
| S2 | **无回执不能力**：`verified=true` 必须有 receipt/test；声明不算验证。 | capability projector |
| S3 | **能力不等于权限**：`can` 与 `may` 分开；`may` 必须来自 lease/grant/boundary。 | permission projector |
| S4 | **权限不等于当前可用**：租约过期、预算不足、工具故障都使 `available_now=false`。 | attention projector |
| S5 | **无校准不自信**：未校准的证据只影响注意力，不提高后验；Brier/ECE 暴露。 | calibration |
| S6 | **无未知不计划**：SelfView 必须显式列出 known unknowns（可为“未识别”）。 | planner gate |
| S7 | **无历史不复盘**：self_digest + ledger cursor 必须可回放；失败模式不可省略。 | ledger |
| S8 | **无授权不改写**：模型不能改写 identity/values/goal/permission；只能提出假设或请求审批。 | policy |

---

## 9. 与 AMP 现有概念的区别

| 概念 | 不是什么 |
|---|---|
| Capability Envelope | 只是权限/边界的静态声明，不是完整自我模型 |
| Values Manifest | 主体价值与权重，不是模型自我 |
| Lease | 当前授权与预算，不是身份 |
| Ledger | 历史与校准数据，不是 SelfView 本身 |
| Calibration | 可靠性的一个维度，不是全部自我 |
| Prompt 里的“你是…” | 不可信的人设，不是 self-claim |

SelfView 是这些对象的**组合投影**，不是新的事实源。

---

## 10. 在 AMP 协议中的落点

不新增第六个动词，也不新增第四层。用现有动词扩展。

### `attend`

```json
{
  "op": "attend",
  "params": {
    "intent": "self",
    "selector": {
      "scope": "amp://self/agent:workflow-console",
      "kinds": ["claim", "affordance"]
    },
    "level": "L0"
  }
}
```

响应：

```json
{
  "result": {
    "slice": [],
    "self": { "horizon": [] },
    "cost": {},
    "lease": {}
  }
}
```

- `self` 是可选结果字段；不改变 `slice` 语义。
- 没有 self 字段的旧客户端仍兼容。

### `account`

- 增加 `self_digest`、`calibration`、`regret`。
- 账本条目记录 `self_digest` 与 `values_digest`。

### 错误码（0.1.1 提案）

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

## 11. 多主体

- 每个 Subject 有自己的 SelfView；父代理不能直接读取子代理的私有 self-claims。
- 子代理可以通过 `attend` 发布 `subject=<child>` 的 claim，父代理按普通 P1 claim 处理，provenance/taint 保留。
- 父代理不能把子代理的能力当成自己的能力；只能作为“可委托能力” claim。
- 审批人也有 SelfView：审阅预算、证据展开、职责分离、疲劳度。
- SelfView 不能跨租约复用；`self_digest` 绑定 subject/lease/audience/purpose。

---

## 12. 页面呈现

工作流页右侧增加 **Self** 面板：

```text
我是谁        agent:workflow-console · model X · values sha256:…
我能做什么    read_dataset ✓ receipt · validate ◐ declared · publish ✗ no grant
我被允许      may read/validate · write:* forbidden · publish requires grant
我现在         intent 导入 · lease 12m · tokens 18.2K/20K · risk .54/.90
我有多可靠    brier .14 · n 12 · failure modes 2
我不知道      row-count mismatch (voi .82) · schema compatibility (voi .41)
```

这是“模型认识自己”的可见化，不是又一张世界地图。

---

## 13. 实现顺序

1. 在 `electron/amp/types.ts` 增加 `SelfView` / `SelfCapability` / `AmpEvidence` / `AmpLikelihood` / `KnownUnknown` / `FailureMode`。
2. 在 `electron/amp/bayes.ts` 实现可复算函数：
   - `logit` / `sigmoid`
   - binary / normal likelihood
   - `updateBelief`（证据簇、ρ 折扣、先验敏感性）
   - `updateBeta`（可靠性）
   - Brier / ECE / log loss
3. `AmpEngine.buildSelfView()`：
   - identity from manifest/values/lease
   - capabilities from affordances + receipts/ledger + belief
   - evidence from receipts/tests/ledger
   - permissions from lease/affordance/grant/boundary
   - attention from current budget/lease/slice
   - calibration from ledger/account
   - known_unknowns from scenario + unresolved conflicts
4. `attend` 支持 `intent="self"` / `scope=self`，返回 `self` 可选字段。
5. `act`/`resolve`/`account` 更新 self 状态并写 ledger `self_digest`。
6. UI Self 面板；模型默认只拿 L0 Self Horizon。
7. 测试：
   - 无 receipt 的能力不能显示 verified
   - 先验 0.55 + LR 12 = 0.936
   - 未校准证据 posterior 不变
   - 同簇证据按 ρ 折扣
   - 权限为空时 can=true/may=false
   - lease 过期后 available_now=false
   - 模型自报不能改变 self-claim
   - Brier/ECE 可复算
   - self_digest 可重放

---

## 14. 一句话

> 模型认识自己，不是靠一句“你是……”，而是靠一份由运行时生成、由证据支撑、由账本校准、由租约约束的 **SelfView**。
>
> 它必须同时回答：我是谁、我能做什么、我被允许做什么、我正在做什么、我有多可靠、我还不知道什么。
>
> 而且——**模型不能自证；它只能提出假设，运行时才能确认。**
