# 工作流：以世界模型为中心的 Agent Runtime

> **Status（2026-10-22）**：本文是 AMP 0.1 之前的设计草稿。协议源已收敛为
> [Attention Manifest Protocol](../Attention%20Manifest%20Protocol.md) 与 `spec/AMP-0.1.md`；
> 实施计划见 [amp-runtime-plan.md](./amp-runtime-plan.md)。本文的 `WorldEntity` 等类型不再作为协议源。

## 0. 先厘清目标

Codex / Claude Code 不是单一页面，而是由很多机制组成的运行时：工具调用、文件编辑、沙箱、权限审批、上下文压缩、计划、子代理、检查点、回滚、记忆、可观测性、错误恢复、评测等。

“实现全部机制”不能靠照搬一个聊天 UI，也不应该一次性铺开。我们需要先回答一个更根本的问题：

> 模型如何理解这个宇宙？如何对自己的世界进行建模？

我的答案：

> 理解不是把更多文本塞进上下文，而是维护一个**外部的、可检验、可修订、可行动的世界模型**。上下文只是这个模型面向当前任务的一个投影。

这套设计不追求“像 Codex/Claude Code”，而是以世界模型为核心，反过来组织它们的机制。

---

## 1. 什么是“理解”

一个模型要在这个宇宙里行动，至少需要五种能力：

1. **描述**：世界里有什么？（实体、属性、关系）
2. **预测**：如果我做 X，会发生什么？（因果/动力学）
3. **诊断**：为什么现在是这样？（证据、反事实）
4. **行动**：在约束下选择下一步（目标、权限、成本）
5. **自知**：我是什么？我能做什么？我哪里可能错？（自模型）

对应到实现上，不能只保存“对话历史”，而要保存：

- **World**：任务环境的事实、实体、关系、约束
- **Self**：Agent 自己的能力、工具、权限、上下文预算、可靠性、当前计划
- **User**：用户的目标、偏好、授权边界
- **Model prior**：模型参数里的先验知识（必须和观测事实分开）

语言是接口，不是世界本身。模型说“我理解了”，必须落成对世界模型的**可验证变更**，而不是一段自然语言。

---

## 2. 世界模型的核心数据结构

```ts
type EntityId = string;
type RelationId = string;
type ObservationId = string;
type HypothesisId = string;

interface WorldEntity {
    id: EntityId;
    type: string;
    name: string;
    attributes: Record<string, unknown>;
    provenance: Provenance;
    confidence: number;
    validFrom?: string;
    validTo?: string;
}

interface WorldRelation {
    id: RelationId;
    from: EntityId;
    predicate: string;
    to: EntityId;
    attributes?: Record<string, unknown>;
    provenance: Provenance;
    confidence: number;
}

interface Observation {
    id: ObservationId;
    source: "user" | "tool" | "file" | "api" | "inference";
    observedAt: string;
    content: unknown;
    provenance: Provenance;
}

interface Hypothesis {
    id: HypothesisId;
    statement: string;
    status: "open" | "supported" | "rejected";
    evidence: ObservationId[];
    alternatives?: HypothesisId[];
    confidence: number;
}

interface Invariant {
    id: string;
    description: string;
    scope: EntityId[];
    check: string | ((snapshot: WorldSnapshot) => boolean);
}

interface WorldAction {
    id: string;
    kind: string;
    target: EntityId[];
    preconditions: string[];
    expectedEffects: string[];
    permission: string;
}

interface Goal {
    id: string;
    description: string;
    successCriteria: string[];
    constraints: string[];
    status: "active" | "done" | "blocked" | "cancelled";
}

interface SelfModel {
    capabilities: string[];
    toolPermissions: Record<string, "allow" | "ask" | "deny">;
    contextBudget: { used: number; total: number };
    reliability: Record<string, number>;
    currentPlan: string[];
    knownUnknowns: string[];
    failureModes: string[];
}

interface WorldSnapshot {
    version: number;
    entities: Map<EntityId, WorldEntity>;
    relations: Map<RelationId, WorldRelation>;
    observations: Map<ObservationId, Observation>;
    hypotheses: Map<HypothesisId, Hypothesis>;
    invariants: Map<string, Invariant>;
    goals: Map<string, Goal>;
    self: SelfModel;
}
```

关键点：

- 每个断言都有 **provenance**（来源）、**confidence**（置信度）、**valid time**（有效时间）。
- 所有变更走 **event sourcing**：事件日志是真相，快照只是加速。
- 矛盾是一等公民：不要用新事实静默覆盖旧事实，保留冲突和证据。
- 模型只能提交 **typed patch proposal**，由校验器写入，不能直接改状态。

---

## 3. 运行时闭环

```text
Perceive -> Assimilate -> Project -> Deliberate -> Act -> Observe -> Verify -> Consolidate -> Reflect
```

1. **Perceive**：用户输入、工具输出、文件、API 结果转成 Observation。
2. **Assimilate**：实体解析、去重、模式校验、违反不变量时生成 Hypothesis/冲突。
3. **Project**：从世界模型中投影出当前任务需要的子图，构成 LLM 上下文。
4. **Deliberate**：LLM 输出结构化的计划、假设、行动提案。
5. **Act**：经过权限/沙箱/审批后执行工具。
6. **Observe**：工具结果作为新证据写回。
7. **Verify**：用测试、不变量、人工审批检查结果。
8. **Consolidate**：压缩事件、提交快照、提取可复用技能。
9. **Reflect**：更新自模型、策略、失败模式。

### 上下文投影，而不是聊天记录

```text
Goal + current task
  + k-hop relevant entity subgraph
  + supporting/contradicting observations
  + open hypotheses and unknowns
  + invariants and permissions
  + self-model budget/reliability
  + recent action trace
  -> budgeted, summarized context
```

这解决“模型如何理解宇宙”的工程问题：**理解 = 对相关子图的正确投影 + 不确定性表达 + 可行动约束**，而不是无限上下文。

### 世界模型变更协议

```ts
interface WorldPatch {
    rationale: string;
    evidence: ObservationId[];
    operations: Array<
        | { op: "upsertEntity"; entity: WorldEntity }
        | { op: "upsertRelation"; relation: WorldRelation }
        | { op: "addObservation"; observation: Observation }
        | { op: "openHypothesis"; hypothesis: Hypothesis }
        | { op: "resolveHypothesis"; id: HypothesisId; status: "supported" | "rejected"; evidence: ObservationId[] }
    >;
    confidence: number;
}
```

校验器负责：

- schema / type 校验
- provenance 是否完整
- 是否违反 invariant
- 是否与已有事实冲突
- 权限是否允许
- 是否需要人类审批

LLM 不能直接写数据库，只能提交 patch。

---

## 4. 自建模：模型如何理解“自己”

自模型不是一句“你是 Codex”，而是可计算的状态：

- 我会哪些工具？哪些需要审批？
- 我的上下文还剩多少？哪些信息必须压缩？
- 我在哪些任务上可靠？哪些容易出错？
- 我当前计划是什么？下一步依赖什么？
- 我有哪些 known unknowns？应该问用户、查资料还是做实验？
- 我的行动会如何改变世界？失败如何回滚？

自模型直接影响策略：

- 上下文不够 -> 压缩/检索，而不是硬塞
- 工具不可靠 -> 交叉验证
- 权限不足 -> 请求审批
- 不确定性高 -> 设计实验/提问
- 任务太大 -> 拆解/子代理

---

## 5. Codex / Claude Code 机制映射

| 机制 | 我们的实现 |
|---|---|
| Agent loop | 事件驱动的 observe/plan/act/verify/reflect |
| Tools | typed registry + permission + sandbox + idempotency |
| Context compaction | 世界模型子图投影 + 摘要 + 检索，不保存全量 transcript |
| Planning / TODO | Goal + task DAG + replanning，计划是模型状态的一部分 |
| File edit / patch | patch proposal + diff + apply + verify + checkpoint |
| Tests / verification | 不变量、测试、人工审批三层 |
| Permissions / approvals | policy engine；allow/ask/deny；按工具/路径/命令 |
| Checkpoints / rollback | event log + snapshot + reversible actions |
| Subagents | 各自持有 scoped world view，共享事件日志，冲突显式合并 |
| Memory | episodic / semantic / procedural + provenance |
| MCP / integrations | tool adapter 协议，统一成 WorldAction |
| Streaming / cancel | run state machine，可暂停/恢复/取消 |
| Observability | trace、token/cost、tool latency、决策依据 |
| Recovery | 重试、幂等、断点续跑、失败诊断 |
| Evaluation | 回放事件、对比世界模型、回归测试 |
| Human-in-the-loop | 审批节点、冲突裁决、目标修订 |

差异化重点：

- Codex / Claude Code 主要是 **transcript-centric**；我们做 **world-model-centric**。
- 它们把状态藏在对话里；我们把状态显式化、可查询、可版本化。
- 它们以工具调用为中心；我们以 **干预（intervention）** 为中心，要求行动前声明预期效果，行动后验证。
- 它们通常只有一个 assistant；我们显式建模 self，并允许 scoped subagents。

---

## 6. 日历宇宙的 ontology

这个应用的“宇宙”不只是文件系统，还包括历法领域：

### 实体

- 历法系统：Gregorian、Xuanyuan、Synodic、SolarTerms
- 时间尺度：UTC、TT、本地时、儒略日
- 天文事件：朔、望、节气、太阳黄经
- 数据源：Excel、API、手工录入、历史文献
- 变换：解析、归一化、换算、校验、发布
- 用户意图：查看、导入、校对、导出、解释

### 不变量

- Gregorian 闰年规则
- 朔望月长度范围
- 节气与太阳黄经对应关系
- 轩辕历纪年/年号规则
- 数据表 schema、主键、时间范围

### 典型不确定性

- 历史文献冲突
- 时区/历法转换误差
- 数据源缺失
- 用户手工修正

世界模型必须保留这些冲突和来源，而不是选一个“看起来对”的值覆盖掉。

---

## 7. 模块划分（建议）

```text
src/workflow/
  model/          # schema, entities, invariants, patch protocol
  store/          # event log, snapshot, query, versioning
  context/        # projection, budget, compaction, retrieval
  runtime/        # loop, planner, executor, verifier, checkpoints
  tools/          # registry, permissions, adapters, idempotency
  memory/         # episodic, semantic, procedural
  providers/      # LLM adapters, streaming, tool-call protocol
  telemetry/      # traces, cost, replay, evaluation
  demo/           # calendar-domain seed / deterministic scenario
electron/workflow/ # main-process host, secrets, filesystem/shell tools, IPC
src/pages/WorkflowPage # runs, trace, world inspector, approvals
```

运行时放在 Electron 主进程，渲染进程只做 UI；API key、文件系统、shell 权限不暴露给 renderer。

---

## 8. 工作流页面应该长什么样

不是“任务卡片 + 进度条”就结束了，而是：

- **左栏**：runs / tasks / 状态
- **中栏**：事件轨迹（observation / hypothesis / action / verification）
- **右栏**：World Inspector
  - entities / relations
  - observations + provenance
  - hypotheses + confidence
  - contradictions
  - invariants
  - self-model（context budget / permissions / known unknowns）
- **顶部**：goal、constraints、budget、approval 状态
- **底部/侧边**：审批、回滚、重跑、导出 trace

当前 `WorkflowPage` 只是 UI 原型，还没有接世界模型和 runtime，不能声称实现了 Codex/Claude Code 机制。

---

## 9. 里程碑

### M1（建议先做）：世界模型 + 事件存储 + 上下文投影

- `model/`：schema、patch 协议、invariants
- `store/`：event log + snapshot + query
- `context/`：按 goal 投影相关子图
- `demo/`：一个日历数据导入场景，确定性地产生 observation / conflict / hypothesis
- UI：World Inspector + run timeline
- 不接 LLM，先把“世界如何被表示和修订”跑通

### M2：单 Agent 工具循环

- provider 抽象 + streaming
- typed tool registry（read/write/patch/search/run/test）
- permission/approval
- LLM 只提交 WorldPatch / ActionProposal
- 上下文投影接入 planner

### M3：验证、检查点、回滚

- 测试/类型检查/不变量
- checkpoint + replay
- patch apply / diff / reject
- 失败诊断与重试

### M4：子代理、记忆、技能

- scoped world views
- 冲突合并
- episodic/semantic/procedural memory
- reflection -> skill

### M5：完整机制对齐

- MCP/integrations
- 成本/延迟/trace
- evaluation/regression
- 多用户/权限策略
- 完整的 Codex/Claude Code 机制清单

---

## 10. 需要先确认的决策

1. **模型提供方**：OpenAI / Anthropic / DeepSeek / 本地模型？M2 才需要。
2. **运行时位置**：建议 Electron 主进程；是否同意？
3. **工具范围**：只读文件、写文件、shell、网络、日历数据 API？
4. **持久化**：SQLite 还是 JSON event log？建议 SQLite + JSON trace。
5. **安全边界**：默认 ask 还是 allowlist？密钥放哪里？
6. **第一里程碑**：是否按 M1 开始？

---

## 一句话总结

不要问“模型能不能理解宇宙”，要问：

> 模型能不能维护一个可检验、可修订、可行动的世界模型；并且能不能把这个模型与自己的自模型、用户意图、工具后果分开？

Codex / Claude Code 的机制可以逐步补齐；但如果我们先把世界模型做对，后面的工具、计划、验证、子代理、记忆才有统一的落点。
