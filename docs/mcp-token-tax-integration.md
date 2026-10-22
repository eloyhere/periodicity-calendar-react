# MCP Token 税 × 世界模型：工作流运行时的约束与修订

> **Status（2026-10-22）**：LCP 四工具是 AMP 的 context-plane 实现剖面，不是独立协议。
> 协议源见 [Attention Manifest Protocol](../Attention%20Manifest%20Protocol.md)；
> AMP 落地计划见 [amp-runtime-plan.md](./amp-runtime-plan.md)。本文保留 Token 税分析。

> 输入文档：[MCP-Token税与下一代工具协议.html](../MCP-Token税与下一代工具协议.html)
> 关联设计：[workflow-world-model.md](./workflow-world-model.md)

## 0. 一句话结论

这份 MCP 尽调补上了世界模型缺失的**代谢层**：

> 模型理解宇宙，不仅需要一张语义地图，还需要知道自己的感官/运动通道有多贵、多慢、多不可信。

因此工作流不能是“把所有工具 schema 塞进上下文，再让模型自由调用”的聊天壳。它必须是：

```text
World Model（认知地图）
    + LCP（上下文平面 / 感官与运动接口）
    + Budget & Policy（代谢与免疫系统）
    + Event Log（记忆与审计）
```

MCP/LCP 负责“模型此刻能看见什么、能做什么”；世界模型负责“这些观察意味着什么、下一步该做什么”。

---

## 1. 文档的关键结论

### 四类 Token 税

| 税种 | 性质 | 优化优先级 |
|---|---|---|
| 定义税 | 每轮固定，可被 prompt cache 摊薄 | 第二 |
| 结果税 | 随轮次二次增长，会复利 | **第一** |
| 往返税 | 每步一次推理，主要烧时延与错误率 | 第三 |
| 协议税 | 握手、会话、状态造成的缓存失效 | 结构性 |

结论：**先治结果，再治定义，再治往返**。结果税最贵，却最少被讨论。

### 三个杠杆

- **Defer（推迟）**：目录与详情分离，按需展开 schema。
- **Externalize（外置）**：编排与数据处理搬进沙箱，中间结果不回上下文。
- **Compress（压缩）**：换编码、换粒度、转句柄、分页。

三者可叠加，不互斥。它们的工程属性不同：defer 是检索问题，externalize 是安全/运行时问题，compress 是信息论问题。

### 五种范式

1. 全量注入
2. 检索式加载
3. 网关门控
4. 代码执行
5. 输出整形

生产系统通常是 **网关门控 + 检索式加载 + 输出整形**，代码执行作为高价值路径的加速器。

### LCP（Layered Context Profile）

不是新协议，而是 MCP 之上的**剖面 + 运行时**：

北向只暴露 4 个工具，固定约 300 tokens，不随服务器数量增长：

```text
find_tools(query)
inspect_tool(id)
run(code, budget)
read_handle(id, cursor)
```

南向继续使用现有 MCP：`server/discover`、`tools/list + ttlMs`、`tools/call`，零改造。

上下文平面六个组件：

- **Manifest Store**：签名、digest、TTL、按需展开
- **Retriever**：BM25 + 向量 + 权限/状态门控；低置信度返回空
- **Budgeter**：每轮/每结果/每任务的 token 配额
- **Executor**：隔离沙箱、默认无网络、出站白名单
- **Shaper**：TOON/MD/句柄/分页
- **Policy & Audit**：鉴权、审批、配额、全链路追踪

三份契约：

1. **Manifest**：`id / v / digest / ttl / tags / tools[n, sig, when]`
2. **Budget**：`max_result_tokens / format / on_exceed / deadline_ms`
3. **Handle**：大结果只回引用，按游标取回

核心原则：**稳定性 > 压缩率**；**预算写进接口，不写进提示词**；**安全边界画在沙箱与出站，不画在提示词**。

---

## 2. 对世界模型的修订

### 2.1 工具不是“函数列表”，是能力实体

世界模型里新增一类实体：

```ts
interface ToolManifest {
    id: string;
    version: string;
    digest: string;
    ttlSeconds: number;
    tags: string[];
    tools: ToolSummary[];
}

interface ToolSummary {
    name: string;
    signature: string;
    when: string;
    risk: "read" | "write" | "destructive";
    costHint?: { definitionTokens: number; typicalResultTokens: number };
}
```

每个 `ToolManifest` 是带来源、版本、摘要、TTL 的世界实体。审批针对的是 **digest**；运行时必须校验描述未变；变更即重新审批（对应 Deadbugz 类元数据投毒）。

### 2.2 结果不是“消息”，是观察 + 句柄

```ts
interface Observation {
    id: string;
    source: "user" | "tool" | "file" | "api" | "inference";
    observedAt: string;
    summary: unknown;
    handleId?: string;
    tokenCost: number;
    truncated: boolean;
    provenance: Provenance;
}
```

- 完整结果留在沙箱/句柄存储，不进入上下文。
- 上下文只拿 summary、cursor、digest、置信度。
- 需要细节时用 `read_handle`，而不是把 200KB 重新塞回 prompt。

### 2.3 `WorldAction` 必须声明预算与预期效果

```ts
interface WorldAction {
    id: string;
    capabilityId: string;
    manifestDigest: string;
    kind: "read" | "write" | "execute" | "publish";
    target: EntityId[];
    preconditions: string[];
    expectedEffects: string[];
    budget: TokenBudget;
    permission: "allow" | "ask" | "deny";
}
```

行动前：预条件、预期效果、预算、权限。
行动后：观察、验证、更新世界模型；失败进入诊断/回滚。

### 2.4 自模型必须包含代谢状态

```ts
interface SelfModel {
    capabilities: string[];
    toolPermissions: Record<string, "allow" | "ask" | "deny">;
    tokenBudget: {
        maxDefinitionTokens: number;
        maxResultTokens: number;
        maxTaskTokens: number;
        used: number;
    };
    contextUtilization: number;
    toolReliability: Record<string, number>;
    currentPlan: string[];
    knownUnknowns: string[];
    failureModes: string[];
}
```

这直接决定策略：

- 定义 token 超预算 -> 只用 manifest + retrieve，不展开 schema
- 结果 token 超预算 -> 句柄/分页/聚合，不截断
- context utilization > 70% -> 压缩/换子任务，不硬撑
- 工具可靠性低 -> 交叉验证/换 CLI
- 权限不足 -> 审批，不绕过

### 2.5 上下文投影必须带预算器

原来的投影：

```text
goal + k-hop subgraph + observations + hypotheses + invariants + self
```

修订为：

```text
goal + task
  + top-k manifests (not full schemas)
  + relevant world subgraph
  + recent observations (summaries, handles)
  + open hypotheses / contradictions
  + invariants / permissions / approvals
  + self-model budget & utilization
  -> Budgeter -> Shaper -> context
```

`find_tools` 是检索，不是把目录全量注入；`inspect_tool` 才展开细节；`run` 的结果默认进句柄。

---

## 3. 运行时闭环修订

```text
Perceive
  -> Assimilate (world model patch)
  -> Project (LCP: manifests + world subgraph + budget)
  -> Deliberate (plan / hypothesis / action)
  -> find_tools / inspect_tool
  -> run(code, budget) in sandbox
  -> observe (summary + handle)
  -> Verify (tests, invariants, approval)
  -> Consolidate (snapshot, token ledger, skills)
  -> Reflect (self-model update)
```

关键变化：

- **检索失败返回空**，不硬塞“最不差”的工具；模型应提问或换策略。
- **执行预算由执行方强制**，不是提示词请求。
- **结果默认外置**；只有 summary 进入世界模型/上下文。
- **工具描述运行时校验 digest**；变更触发重新审批。
- **CLI 优先**：编码/运维任务优先用既有 CLI + Skills；MCP 只保留有状态、迭代式交互。
- **数据型任务优先代码模式**：中间结果留在沙箱。
- **子代理不复制全量上下文**：每个子代理拿 scoped world view + 自己的预算/manifest，汇总走结构化结果。

---

## 4. 与 Codex / Claude Code 机制的对应修订

| 机制 | 修订后的实现 |
|---|---|
| Agent loop | 事件驱动 + LCP 预算 + 世界模型 patch |
| Tools | 4 个北向元工具 + manifest/retriever/executor |
| Context compaction | 世界子图投影 + manifest 摘要 + handle，不重放 transcript |
| Planning | 计划依赖 capability graph、预算、权限、known unknowns |
| File edit / patch | 作为 `run` 的沙箱动作；diff/测试作为观察 |
| Verification | 不变量 + 测试 + 人工审批 |
| Permissions | 工具级 + 路径级 + 出站策略；默认只读 |
| Checkpoints | 世界模型快照 + 工具副作用日志 + 可逆动作 |
| Subagents | scoped world view + scoped manifests + token budget |
| Memory | 事件日志 + 语义记忆 + 程序性技能 + handle store |
| MCP / integrations | 南向 MCP，北向 LCP；不要让 MCP schema 进上下文 |
| Observability | 每轮定义/结果/往返 token、工具选择、审批、digest |
| Recovery | 幂等、句柄重放、断点、回滚 |
| Evaluation | 回放 trace、世界模型差异、任务成功率/成本 |

### 一个重要的“不照搬”

Codex / Claude Code 的很多机制是围绕“编码 agent + 本地工具”设计的。我们的场景是历法数据 + 多页面应用，应该：

- 编码/文件操作：**CLI + shell + patch**，定义成本接近 0。
- 历法数据计算：**代码模式/沙箱**，中间结果不回上下文。
- 有状态 SaaS / 外部数据源：**MCP + manifest**。
- 高频、窄场景能力：**native typed tool**，不要包 MCP。

LCP 不是“所有工具都走 MCP”，而是“所有能力都经过同一个上下文平面”。

---

## 5. 里程碑修订

### P0：计量与基线（1–2 周）

- Token Ledger：每服务器/每轮/每结果/每工具选择
- World Model schema + event store
- Manifest Store（先接 2–3 个模拟能力）
- 工作流页显示 token 账单与 run trace
- 不接 LLM，先让“成本/状态/证据”可见

### P1：LCP MVP（4–6 周）

- `find_tools` / `inspect_tool` / `run` / `read_handle`
- Retriever（BM25 + 状态/权限过滤）
- Budgeter（max_result_tokens / on_exceed）
- Shaper（summary / handle / pagination）
- Handle Store
- 工作流页：World Inspector + Token Ledger + Handle Viewer

### P2：沙箱与代码模式（6–10 周）

- 隔离执行器 + 出站白名单
- top-N 高频工具的类型化 SDK
- `run(code, budget)` 接入
- 结果整形与错误诊断

### P3：治理与信任（4 周+）

- Manifest 签名 + digest + TTL
- 审批/审计/配额
- 变更重审
- MCP extensions 草案

### P4：Agent 机制补齐

- planner / verifier / checkpoint / rollback
- subagents / memory / skills
- evaluation / replay
- 逐步逼近 Codex/Claude Code 的机制覆盖

---

## 6. 工作流页面应该展示什么

当前页面只是 UI 原型，真正的工作流页应包含：

- **顶部**：goal、预算（定义/结果/任务）、权限、审批状态
- **左栏**：runs / tasks / 状态
- **中栏**：trace
  - `find_tools` -> manifests
  - `inspect_tool` -> schema
  - `run` -> sandbox / budget / result
  - `read_handle` -> slices
  - verification / approval
- **右栏**：World Inspector
  - entities / relations
  - observations + provenance
  - hypotheses / contradictions
  - handles + token cost
  - self-model（budget、utilization、tool reliability、known unknowns）
- **底部**：Token Ledger（per turn / per server / per result）
- **操作**：pause / resume / cancel / approve / rollback / replay

---

## 7. 验收指标

来自原文档，建议直接进 OKR：

| 指标 | 目标 |
|---|---|
| 每轮工具定义 tokens | < 2K |
| 单次结果 p95 tokens | < 4K |
| 工具选择准确率 | > 90% |
| 单任务成本 | 0.4× 基线 |
| Prompt cache 命中率 | > 80% |
| 新工具接入时长 | < 4 小时 |

世界模型额外指标：

- provenance 覆盖率
- 矛盾保留/解决率
- hypothesis 解决率
- 同一 trace 的重放一致率
- 回滚成功率
- 人工审批命中率/误报率

---

## 8. 需要确认

1. **第一刀切哪里？** 建议 P0：Token Ledger + World Model + Manifest Store；不接 LLM。
2. **CLI / MCP / native 的边界**：哪些能力走 shell，哪些走 MCP，哪些直接 native？
3. **沙箱技术**：Node worker / 独立进程 / 容器 / WASM isolate？
4. **持久化**：SQLite event log + 文件 handle store？
5. **模型 provider**：M2 才需要；先不锁死。
6. **签名/信任根**：自签名清单 / 企业 registry / 本地信任库？

---

## 9. 一句话

MCP 解决“怎么连”，LCP 解决“此刻给模型看什么”，世界模型解决“这些信息意味着什么”。

三者合起来，才是在回答：**模型如何理解这个宇宙，以及如何对自己的世界建模。**
