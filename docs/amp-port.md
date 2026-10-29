# AMP 协议库移植与对齐验证

> 本文记录 `attention-manifest-protocol` 0.4.1 到本仓库的逐字移植、对齐验证方法、
> 宿主接入映射与已知限制。所有数字均来自本机实际运行（2026-10-29，Asia/Shanghai）。

## 1. 来源与版本

| 项目 | 值 |
|---|---|
| 参考仓库 | `R:\project\attention-manifest-protocol` |
| npm 包名 / 版本 | `attention-manifest-protocol` / `0.4.1` |
| Git commit | `e40634a2dd88cbdf684e8a53b178b00f4f3fb5fe` |
| 上游源码目录 | `R:\project\attention-manifest-protocol\src`（共 299 个 `.ts`；其中 297 个库文件 + 2 个 demo 入口 `main.ts` / `counter.ts` 不复制） |
| 已发布构建 | `R:\project\attention-manifest-protocol\lib`（JS + `.d.ts`，parity 的参考侧） |
| 移植目标 | `electron/protocol/amp`（本仓库） |
| 移植时间 | 2026-10-29T05:33:13.2806857+08:00 |
| 许可证 | Apache-2.0，见 `electron/protocol/amp/LICENSE` 与 `NOTICE` |
| 溯源文件 | `electron/protocol/amp/PROVENANCE.md`（来源表、拷贝规则、禁止手改） |

**逐字校验（本次重新执行，非引用历史结论）**：

```powershell
$ref = "R:\project\attention-manifest-protocol\src"
$ven = "R:\project\periodicity-calendar-react\electron\protocol\amp"
$excluded = @("main.ts", "counter.ts", "style.css")
$refFiles = Get-ChildItem $ref -Recurse -File -Filter *.ts | Where-Object { $_.Name -notin $excluded }
$mismatch = 0
foreach ($file in $refFiles) {
    $relative = $file.FullName.Substring($ref.Length + 1)
    $target = Join-Path $ven $relative
    if (-not (Test-Path $target)) { Write-Host "MISSING $relative"; $mismatch++; continue }
    if ((Get-FileHash $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $target -Algorithm SHA256).Hash) {
        Write-Host "DIFF $relative"; $mismatch++
    }
}
"checked=$($refFiles.Count) mismatches=$mismatch"
```

实际结果：`checked=297 mismatches=0`（297/297 SHA-256 全等）。
目标目录共 42 个模块目录 + 根 `index.ts` + `LICENSE` + `NOTICE` + `PROVENANCE.md`。

## 2. 移植方式

- **逐字复制**，不是 fork：文件内容、缩进（上游 4 空格）、行尾、注释、`.ts` 扩展名
  全部保持上游原样。未添加任何 shim、桶文件、`.d.ts` 补丁或重导出。
- 拷贝范围：`src/` 下全部 42 个目录与根 `index.ts`；排除上游 Vite demo 的
  `src/main.ts`、`src/counter.ts`、`src/style.css`（上游 `tsconfig.build.json` 同样排除）。
- `LICENSE`、`NOTICE` 从上游仓库根目录逐字复制，必须随再分发保留（Apache-2.0 §4(d)）。
- **禁止手动修改**该目录。需要修上游行为时，改 `electron/amp/` 的适配层，或把补丁送回上游。

### 重新同步（可直接执行）

以下命令会清空 `electron/protocol/amp` 中除 `LICENSE`、`NOTICE`、`PROVENANCE.md`
之外的内容，再从上游 `src` 整体重拷。执行前先确认路径；执行后必须重跑哈希校验。

```powershell
$source = "R:\project\attention-manifest-protocol\src"
$repo = "R:\project\attention-manifest-protocol"
$target = "R:\project\periodicity-calendar-react\electron\protocol\amp"
$excluded = @("main.ts", "counter.ts", "style.css")

# 1. 清空上游内容，保留许可证与溯源文件
Get-ChildItem $target -Force |
    Where-Object { $_.Name -notin @("LICENSE", "NOTICE", "PROVENANCE.md") } |
    Remove-Item -Recurse -Force

# 2. 整体重拷（排除上游 demo 的三个入口文件）
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force -Exclude $excluded

# 3. 刷新许可证（NOTICE 必须随再分发保留）
Copy-Item (Join-Path $repo "LICENSE") $target -Force
Copy-Item (Join-Path $repo "NOTICE") $target -Force

# 4. 逐文件 SHA-256 校验；任何 missing/diff 都说明重拷失败
$refFiles = Get-ChildItem $source -Recurse -File -Filter *.ts | Where-Object { $_.Name -notin $excluded }
$mismatch = 0
foreach ($file in $refFiles) {
    $relative = $file.FullName.Substring($source.Length + 1)
    $candidate = Join-Path $target $relative
    if (-not (Test-Path $candidate)) { Write-Host "MISSING $relative"; $mismatch++; continue }
    if ((Get-FileHash $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $candidate -Algorithm SHA256).Hash) {
        Write-Host "DIFF $relative"; $mismatch++
    }
}
"checked=$($refFiles.Count) mismatches=$mismatch"
if ($mismatch -ne 0) { throw "vendor copy does not match upstream" }
```

注意：`Copy-Item -Exclude` 只在通配符枚举的这一层生效；上述三个排除文件都位于 `src`
根层，因此排除有效（已用 `-WhatIf` 演练确认它们不会被复制）。若上游未来把 demo
文件移入子目录，需要改为显式过滤后再复制。

重拷完成后还必须更新 `PROVENANCE.md` 的版本、commit、导入时间与文件数，并重跑第 6 节
的 parity 脚本。

## 3. 模块清单

`electron/protocol/amp` 下共 42 个模块目录、296 个模块内 `.ts` + 1 个根 `index.ts`。
「运行时可用」指该模块的**运行时** import 闭包不触达 `node:sqlite`，可被 Vite/Electron 30
打包运行；「仅类型检查」指其类型闭包依赖 `node:sqlite` 类型（`@types/node` 26），或按
宿主范围约束不纳入运行时。

| 目录 | 文件数 | 用途 | 运行时 |
|---|---:|---|---|
| `attention` | 8 | 注意层：候选评分、焦点选择、六轴预算/资源计划、打断 | 运行时可用 |
| `authz` | 2 | 能力授权（Capability-based authorization，SQLite 后端） | 仅类型检查 |
| `bayes` | 7 | Beta 信念、校准（Brier/ECE/isotonic/temperature）、来源可靠性 | 运行时可用 |
| `boundary` | 5 | 边界构造器：frame / ref table / tool call 校验，失败即拒绝 | 运行时可用 |
| `concept` | 4 | 概念经济：单概念内容上限与版本保留上限 | 运行时可用 |
| `concurrency` | 6 | 跨 worker 并发原语：幂等键、互斥、命名锁、重试、worker 注册 | 仅类型检查 |
| `context` | 13 | 上下文 AST、优先级边、内容存储、工作区投影 | 运行时可用 |
| `cooperation` | 7 | 协作板、会话合并、协作指标 | 运行时可用 |
| `database` | 59 | SQLite 内核：entity / repository / service / sql / store / adapter | 仅类型检查 |
| `delegate` | 3 | 委派团队、子预算（只能收缩）、租约 | 运行时可用 |
| `diagnosis` | 6 | 诊断清单、上下文、帧与路由 | 运行时可用 |
| `error` | 8 | 统一错误类型（AMP / 边界 / 认证 / 内核 / 邮箱 / 窗口） | 运行时可用 |
| `evaluation` | 3 | 标注导入与一致性裁决 | 运行时可用 |
| `evidence` | 3 | 证据图（影响闭包、环检测）与证据再验证 | 运行时可用 |
| `execution` | 4 | 执行句柄、固定（pin）、执行器 | 运行时可用 |
| `frame` | 2 | 注意帧（不可变分配快照） | 运行时可用 |
| `goal` | 3 | Goal / Process / Plan 生命周期与校验 | 运行时可用 |
| `governance` | 19 | 治理层：清单、审计、预算、凭据、工作流、工具策略等（纯 TS） | 运行时可用 |
| `interaction` | 2 | 交互模式（如何相处，而非任务领域） | 运行时可用 |
| `ipc` | 4 | 跨进程邮箱（有界队列、单次投递） | 仅类型检查 |
| `kernel` | 2 | 持久化调度器：process=agent，thread=task/goal | 仅类型检查 |
| `ledger` | 5 | 追加式账本、哈希链快照、检查点、共享 | 运行时可用 |
| `lock` | 2 | 命名租约（跨 worker 互斥） | 仅类型检查 |
| `manifest` | 9 | Manifest、密钥生命周期、签名、信任、联邦 | 运行时可用 |
| `mission` | 2 | 任务队列：可运行 process 的优先级视图 | 运行时可用 |
| `module` | 15 | DeepSeek LLM 客户端等模块适配 | 运行时可用 |
| `policy` | 3 | 动作策略门（effect/tier/approval）与 Guard（限流/熔断） | 运行时可用 |
| `process` | 7 | 进程/agent、agent store、执行存储、状态迁移 | 仅类型检查 |
| `progress` | 2 | 进度只读投影 | 仅类型检查 |
| `protocol` | 7 | A2A 运行时：密封信封、排序/重放、wire、通道 | 运行时可用 |
| `receipt` | 2 | 回执与事件（settlement objects） | 运行时可用 |
| `registry` | 3 | 概念/模块注册表 | 仅类型检查 |
| `runtime` | 16 | 认知运行时：路由、行为、会话、回放、遥测 | 运行时可用 |
| `scenario` | 2 | 场景加权混合 | 运行时可用 |
| `semantic` | 3 | Canonical JSON 与纯 JS SHA-256 | 运行时可用 |
| `storage` | 3 | JSONL 追加存储接口 | 运行时可用 |
| `store` | 10 | `database/service` 之上的读取缓存 | 仅类型检查 |
| `structure` | 21 | 容器与索引：堆、树、LRU、Bloom、队列等 | 运行时可用 |
| `thread` | 3 | 线程（任务）与状态迁移 | 仅类型检查 |
| `types` | 2 | 公共类型面（Id / Digest / Timestamp / Budget…） | 运行时可用 |
| `warrant` | 4 | 主张/证据/假设、置信度派生、探究日志 | 运行时可用 |
| `window` | 5 | 上下文窗口、裁剪与压缩 | 仅类型检查 |

分类补充说明（本次对 `src` 做的静态 import 闭包分析）：

- 有 **8 个目录的运行时闭包**会触达 `database/store/database.ts` 中对 `node:sqlite`
  的**值导入**：`authz`、`database`、`ipc`、`kernel`、`process`、`progress`、`store`、
  `thread`。这些目录在 Node 20.16（Electron 30）下无法直接运行。
- 另外 **4 个目录**（`concurrency`、`lock`、`registry`、`window`）只有 `node:sqlite`
  的**类型导入**（或经 `database/*` 类型间接触达），打包后理论上可运行；但按本仓库
  「SQLite 子系统只做类型检查」的边界，仍列入仅类型检查，不纳入宿主运行时。

## 4. 宿主接入

> 权威映射见 [`docs/amp-engine-mapping.md`](./amp-engine-mapping.md)（引擎代理维护）。
> 本节只摘录与移植对齐相关的部分；若两者冲突，以该文件为准。

宿主实现位于 `electron/amp`：

```text
electron/amp/
  engine.ts   # 唯一实现文件：参考模块的宿主适配层
  index.ts    # export { AmpEngine } from "./engine"
  types.ts    # 对外契约（AmpResponse / AmpSnapshot / AmpSelfView …）
```

渲染进程只通过 IPC 调用；密钥、签名、策略与账本都留在主进程。原先手写的
`electron/amp/bayes.ts`（logit/sigmoid/Beta 更新/brier/ECE）已被删除，由 vendor 的
`bayes/engine.ts`、`bayes/reliability.ts`、`bayes/calibration.ts` 取代。

`electron/amp/engine.ts` 对外暴露五个动词（`AmpVerb`），映射如下：

| AMP 动词 | 引擎方法 | 参考模块落点 |
|---|---|---|
| `declare` | `init()` | `manifest/sign`、`manifest/keys`、`warrant/*`、`evidence/evidenceGraph`、`goal/*`、`ledger/ledger`、`ledger/checkpoint` |
| `attend` | `attend(intent, level)` | `attention/attention`、`boundary/frame`、`boundary/refTable`、`attention/budget` |
| `act` | `act(request)` | `boundary/toolCall`、`boundary/refTable`、`policy/policy`、`policy/guard`、`attention/budget`、`execution/handles`、`receipt/receipt`、`ledger/*` |
| `resolve` | `resolve(request)` | `execution/handles`、`receipt/receipt`、`attention/budget`、`ledger/*` |
| `account` | `account(request)` | `goal/goal`、`bayes/reliability`、`ledger/*` |

`amp-engine-mapping.md` 里还有一张 30 行的逐函数表（canonical、sha256、manifest、
warrant、bayes、evidence、attention、boundary、policy、execution、receipt、ledger、
goal、types），本文不重复。要点：

- `Engine` 不再包含任何加密、哈希、canonical、贝叶斯、注意力评分、预算扣减、
  边界/权限判定或哈希链实现，只保留 ID 规范化、轴适配、view 投影、执行器与事件编排。
- 引擎的 `buildBelief()` 用 vendor `posteriorOf` 得到 Beta 后验；逐证据 log-LR 由
  **前缀后验** 的参考输出差分得到，`AmpBelief.log_odds` 取 `logit(posterior.mean)`。
  参考实现本身**没有** log-odds 原语（全文检索无此符号），因此 parity 只需对齐
  posterior 与折扣，不需要对齐宿主自定义的 log-odds 派生。
- `AmpBelief.dependence` 的 `rho: 0.2`、`model: "beta-posterior/0.1"` 是宿主策略，
  不是 vendor 行为，不在 parity 范围。
- `AmpSelfView.calibration` 的 `brier`/`ece` 来自 `bayes/calibration.ts`，不是账本直接产出。

### 为什么 SQLite 子系统只做类型检查

本应用打包 Electron 30.5.1（以 `ELECTRON_RUN_AS_NODE=1` 实测：Node **20.16.0**、
Chromium 124.0.6367.243），**没有 `node:sqlite`**（实测
`require("node:sqlite")` 返回 `ERR_UNKNOWN_BUILTIN_MODULE`；该模块自 Node 22.5 起提供，
Node 24 稳定）。`database`、`store`、`kernel/scheduler`、`process`、`thread`、`window`、
`authz`、`registry`、`ipc`、`lock`、`concurrency`、`progress` 因此不进入运行时闭包：

- `tsc` 使用仓库的 `@types/node` 26.6.5，可以看到 `node:sqlite` 的类型，类型检查通过；
- Vite 打包 `electron/amp` 时只沿实际 import 图收集模块，SQLite 子系统不会被拉进
  `dist-electron/main.js`（本次 `vite build` 产物 203.64 kB，已验证构建成功）；
- 宿主运行时的账本、句柄、审批、策略都在内存中，持久化留给后续工作（见第 5 节）。

## 5. 与 `docs/amp-runtime-plan.md` 的关系

`amp-runtime-plan.md` 是协议落地计划（五动词、LCP 映射、P0 里程碑、模块划分）。
移植完成后，二者的分工如下。

### 已由真实协议实现承担

| 计划中的能力 | 现在由哪个 vendor 模块承担 |
|---|---|
| canonical JSON / SHA-256 / digest | `semantic/canonical.ts`、`semantic/sha256.ts` |
| Manifest 签名、密钥、TTL | `manifest/sign.ts`、`manifest/keys.ts`、`manifest/trust.ts` |
| 注意评分、选择、预算 | `attention/attention.ts`、`attention/budget.ts`、`attention/resource.ts` |
| 注意帧与边界校验 | `frame/frame.ts`、`boundary/frame.ts`、`boundary/refTable.ts`、`boundary/toolCall.ts` |
| 动作策略/审批/限流 | `policy/policy.ts`、`policy/guard.ts` |
| 账本哈希链、检查点、重放 | `ledger/ledger.ts`、`ledger/persistence.ts`、`ledger/checkpoint.ts` |
| 句柄与分页投影 | `execution/handles.ts` |
| 回执/事件 | `receipt/receipt.ts` |
| 贝叶斯信念与校准 | `bayes/engine.ts`、`bayes/calibration.ts`、`bayes/reliability.ts` |
| 主张/证据/假设与置信度派生 | `warrant/epistemic.ts`、`warrant/warrant.ts` |
| 密封信封、排序、重放、wire | `protocol/envelope.ts`、`protocol/wire.ts`、`protocol/channel.ts` |
| 目标/计划/过程 | `goal/goal.ts`、`goal/plan.ts` |

计划 §6「第一里程碑：五动词 + 账本闭环」在宿主层已由 `electron/amp/engine.ts` 串起来，
`declare → attend → act → resolve → account` 均有对应实现；manifest digest 可复算、
签名可验证、预算超限在 `act` 前失败、不可逆动作无审批被拒、账本链连续。parity 覆盖
这些原语；宿主行为由引擎侧自检覆盖（结论以其代理报告为准，本文只记录映射）。

### 仍是后续工作

| 计划中的事项 | 现状 / 缺口 |
|---|---|
| JSON Schema 2020-12（计划 §4「尚未存在的东西」） | 上游 0.4.1 仍未提供 `spec/schema/`，需要从规范正文生成 |
| conformance fixtures、`AMP-Host/0.1-draft` 声明 | 未建立；当前的“对齐”是 lib ↔ vendor 的原语级 parity，不是规范级 conformance |
| MCP / HTTP / CLI 绑定（计划 §8） | 宿主目前只有 Electron IPC；`tools/call`、`resources/read` 绑定未实现 |
| WorkflowPage AMP Console（计划 §7） | 仍是普通看板；`attend/act/resolve/account` 的可视化未接 |
| SelfView 面板（计划 §10） | 宿主 `buildSelfView()` 已有数据形状，UI 未接 |
| SQLite/事件日志持久化（计划 §5 store、§9 问题 5） | Electron 30 无 `node:sqlite`，当前账本/句柄只在内存；需要外部存储或升级 Electron |
| 六轴预算 canonical 命名（AUD-01） | 宿主 `AmpBudget` 使用 `tokens/time_ms/space_bytes/capability_load/resources/risk`；AUD-01 的 `time_ms/resources/human_items` 别名尚未统一 |
| AUD-02…AUD-13、OP-01…OP-14 | 未逐条落地；宿主只选了其中一部分默认策略 |
| Governance 模块（`governance/*`） | vendor 已包含且运行时可用，但宿主未接入工作流/凭据/审计 |

一句话：**协议原语层已经是真实实现，不再需要“计划中的自研 codec/账本/策略”**；
计划剩余的是规范级 conformance、绑定层、UI 与持久化。

## 6. 验证方法

### 6.1 Parity 脚本

```powershell
node --experimental-strip-types tools/amp-parity.ts
```

- 参考侧：`R:\project\attention-manifest-protocol\lib\<module>\index.js`（已发布 JS；
  个别用例直接 import 子模块，如 `bayes/engine.js`、`manifest/sign.js`）；
  可用 `AMP_REF_LIB` 覆盖根路径。
- 移植侧：`electron/protocol/amp/<module>/index.ts` 或对应子模块（静态 import，
  Vite/TypeScript 均可解析）。
- 仅使用运行时闭包干净的模块：`semantic`、`manifest`、`warrant`、`bayes`、`ledger`、
  `execution`、`policy`、`attention`、`boundary`、`protocol`、`receipt`、`types` 等；
  不 import `database` / `store` / `kernel` / `process` / `thread` / `window` / `authz` /
  `registry` / `ipc` / `lock` / `concurrency` / `progress`。

**本次实际运行结果（2026-10-29T07:35:40+08:00，Node v24.21.0，exit 0）**：

| 顶层组 | 用例数 | 结果 |
|---|---:|---|
| `semantic`（canonical / digest / sha256） | 16 | 16/16 |
| `manifest`（contentDigest / sign / verify / generateSigningKey） | 15 | 15/15 |
| `warrant`（posterior / 折扣 / deriveConfidence / validateClaim / authorize） | 9 | 9/9 |
| `bayes`（信念、校准、可靠性） | 24 | 24/24 |
| `ledger`（appendEvent / 快照 / 检查点 / 重放） | 22 | 22/22 |
| `execution`（HandleStore put/read/分页） | 6 | 6/6 |
| `policy`（决策矩阵、Guard） | 2 | 2/2 |
| `attention` | 24 | 24/24 |
| `boundary` | 7 | 7/7 |
| `protocol`（envelope / runtime / wire） | 20 | 20/20 |
| `receipt` | 2 | 2/2 |
| **合计** | **147** | **147/147，exit 0** |

关键数字（均可从 stdout JSON 的 `detail` 复核）：

- canonical：嵌套 fixture 的 digest 为
  `sha256:1c3adb82448ea1080934ba42265d38b8cc6a4ed0ad29d4be54a7b35fb4b19141`；
  覆盖 unicode、`-0`、浮点、`1e21`、超大整数、数字键排序、`undefined` 属性/根。
- SHA-256：空串、`"abc"`、unicode、4096 字节长串，以及长度
  `0,1,2,3,54,55,56,57,63,64,65,119,120,127,128,129,255,256,257` 的填充边界，
  全部与 Node `crypto.createHash("sha256")` 三方一致。
- Manifest：同一 body 的 `contentDigest` 两侧相同；固定种子密钥签名的 `sig`
  （base64url）完全相同，如
  `WSy_T_LJikaL5ud2kBMGdh5Vg6i060_IWZNoaIUacqaFMyPRYw2fa1IHOJ4znqkzgsxxqfmhjYoLvRkoYoofBw`；
  用两侧各自 `generateSigningKey("kid.parity.ed25519")` 生成密钥后，**用同一把
  reference 生成的私钥**在两侧签名，签名解码为 64 字节（128 hex）后逐字节相同。
  该十六进制值每次运行都不同（密钥随机），因此脚本只断言“本次两侧相等且长度为
  128”，不把某一次的随机值写死；固定种子密钥的那条 `sig` 才是跨运行稳定的。
  篡改 body 后两侧都以
  `digest does not cover the manifest content` + `signature does not verify` 拒绝。
- 信念：`posteriorOf` 在 `alpha=3.1 beta=2.4000000000000004 mean=0.5636363636363636`
  等取值上逐位相等；折扣用例按
  `alpha = 1 + 3×(0.8×0.5) + 2×(0.4×0.25) = 2.4000000000000004` 独立复算后仍相等。
  参考实现没有 epsilon，`Object.is` 级别的精确比较即可通过。
- 校准：`brier=0.133125`、`ece=0.31250000000000006`（10 bin）、5 bin 版本、
  isotonic/temperature/cross-validate、空输入全部相等。
- 可靠性：`SourceReliability` 同一观测序列后的 `weight/weights/snapshot` 全等；
  `load(snapshot)` 往返一致。
- 账本：同一事件序列 `appendEvent` 后 `events` 的字段/顺序/digest 全等；
  `exportLedger` 的 3 条链式事件 tip 为
  `sha256:63820262ff9baedeb63a352d29cdb5191719718cfe9be56c05864b7a6e370873`；
  `checkpointDigest`、`sealCheckpoint` 签名、链式 second checkpoint 全等；
  篡改 payload/count/tip 后两侧给出相同拒绝原因。
- 句柄：`HandleStore.put` 的 id（`h.` + 10 hex）、`read` 的
  `text/next/totalPages/tokens` 在 cursor `0/120/99999` 与 `limitTokens=5` 下全等。
- 策略：同一配置下的 effect/claim/approval 场景矩阵（read、write-reversible、spend、
  delete、send、deploy、permission、publish 及非法 effect）的
  `outcome/reason/minTier` 全等；审批的签发形状、过期、撤销、重放、argsDigest
  不匹配、`checkApproval` 两次均返回 `approval_valid` 且不消费，均一致
  （`approvalId` 是随机值，比较时归一化为 `<approval>`/形状）。

> 脚本来源说明：`tools/amp-parity.ts` 最初由另一个代理起草（canonical/sha256/
> manifest/bayes/ledger/handles/policy/attention/boundary/protocol 等），本代理按任务
> 要求**增量补齐**了 `warrant/epistemic` 整组、`generateSigningKey` 同 kid 跨实现
> 签名、`Ledger.appendEvent` 顺序与 digest、`policy.checkApproval`、SHA-256 填充边界，
> 并修正了一处 `Inference` 类型错误；未删除、未放宽任何既有断言。

### 6.2 TypeScript

```powershell
# 全仓库（src + electron，含 vendor 的类型检查）
npx tsc --noEmit

# 只检查 parity 脚本（tools/ 不在 tsconfig include 内）
npx tsc --ignoreConfig --noEmit --target ES2023 --module ESNext `
  --moduleResolution bundler --allowImportingTsExtensions --strict `
  --skipLibCheck --types node tools/amp-parity.ts
```

实际结果（2026-10-29 07:34 复跑）：两条命令均 **exit 0**。
`--ignoreConfig` 是 TypeScript 6 在“命令行指定文件 + 存在 tsconfig.json”时的必需参数。

### 6.3 ESLint

```powershell
npx eslint . --ext ts,tsx --rulesdir eslint-rules
# 等价于 npm run lint（npm 脚本还带 --report-unused-disable-directives --max-warnings 0）
```

实际结果：**exit 0**（2026-10-29 07:34 复跑）。`tools/amp-parity.ts` 目前被
`.eslintrc.cjs` 的 `ignorePatterns` 排除（主代理在 07:32 为消除
`parserOptions.project` 解析错误而加入 `"tools"`，不在本代理文件所有权内）：

- 全仓 lint 因此通过，不再有 parsing error；
- 对单文件执行 `npx eslint tools/amp-parity.ts` 只会得到
  `File ignored because of a matching ignore pattern` 的 warning（exit 0）；
- 代价是 parity 脚本本身不参与 ESLint 规则检查，其风格/类型由第 6.2 节的独立
  `tsc` 命令与人工审阅保证。

如果以后希望脚本重新被 lint：在 `tsconfig.json` 的 `include` 加入 `"tools"`，再从
`ignorePatterns` 移除 `"tools"`，两者必须同时改。

### 6.4 构建

```powershell
npm run build   # 等价于 tsc && vite build && electron-builder
```

分步验证结果：

- `npx tsc --noEmit` → exit 0；
- `npx vite build` → exit 0，`dist-electron/main.js` 203.64 kB / gzip 56.10 kB（本次
  2026-10-29 07:36 构建；vendor 已被打包进主进程产物，说明 `.ts` 扩展名 import 能被
  Vite/esbuild 正确解析）；
- `electron-builder` 打包未在本次验证中执行（耗时且会生成安装包）；`npm run build`
  会依次执行三者，前两步已通过（真实 Electron 冒烟由主代理另行验证 16/16 通过）。

## 7. 风险与限制

1. **`@types/node` 26 vs Node 20.16 运行时**
   仓库锁 `@types/node` 26.6.5（与上游一致），因此 `tsc` 认可 `node:sqlite`
   等 Node ≥22 API；Electron 30.5.1 的 Node 20.16.0 没有这些 API（实测
   `ERR_UNKNOWN_BUILTIN_MODULE`）。类型检查通过**不代表**运行时可调用。规避：
   `electron/amp` 只 import 第 3 节标注「运行时可用」的模块；SQLite 子系统仅类型检查，
   不进入打包闭包（本次 `vite build` 已确认主进程产物 203.64 kB，未被 SQLite 模块撑大）。

2. **`.ts` 后缀 import 只能被打包器解析**
   vendor 保留上游的 `from "./x.ts"` 写法。Node 只有在
   `--experimental-strip-types`（Node ≥22.6，本项目用 Node 24）下才能直接跑；
   Electron 30 的 Node 20 **不能**直接 `require`/`import` 这些 `.ts` 文件。
   因此 `electron/amp` 必须经 Vite 打包后由 Electron 加载（`dist-electron/main.js`），
   不能用 `electron electron/amp/index.ts` 直接启动。

3. **浮点与 canonical 的边界**
   `canonical()` 走 `JSON.stringify`，不是完整 RFC 8785：`-0` → `"0"`、
   `1e21` → `"1e+21"`、`NaN`/`Infinity` → `"null"`、`BigInt` 会抛 `TypeError`。
   这些行为两侧一致（parity 已覆盖前几项）；跨语言实现若按严格 JCS 处理会不兼容。
   签名/digest 只保证在本协议生态内可复算。

4. **时间与时区**
   协议时间戳是字符串；`PolicyEngine` 的时钟由宿主注入，审批过期用
   `Date.parse` 比较。parity 全部使用 UTC `Z` 时间戳与固定时钟，未覆盖本地时区/
   DST 边界；宿主侧若传入本地时间字符串，需自行保证 ISO 8601 与 UTC 归一。

5. **Ed25519/WebCrypto 依赖**
   签名与验签依赖全局 `crypto.subtle` 的 Ed25519。Node 20 与 Chromium 124 均支持；
   但若运行环境禁用 WebCrypto 或使用不支持的算法，`generateSigningKey` 会直接抛错。
   `btoa`/`atob` 在 Node 20/24 都存在（已弃用但可用）。

6. **随机密钥导致签名不可跨运行比较**
   `generateSigningKey` 每次生成新密钥，签名因此每次不同；parity 只在**同一把密钥**
   下比较签名字节，并额外验证“vendor 生成的密钥可被 reference 验证、反之亦然”。
   不要拿不同运行的 `sig` 做相等断言。

7. **ESLint 范围**
   见 6.3：`tools` 被 `.eslintrc.cjs` 的 `ignorePatterns` 排除，全仓 lint 通过，
   但 parity 脚本本身不参与 ESLint 检查。若把它重新纳入，必须同时把 `tools` 加入
   `tsconfig.json` 的 `include`，否则会回到 `parserOptions.project` 解析错误。

8. **上游升级**
   vendor 是逐字副本，任何本地手改都会让 parity 与哈希校验失去意义。升级流程：
   整体重拷 → 更新 `PROVENANCE.md` → 重跑 297 文件哈希校验 → 重跑 parity →
   检查 `lib` 与 `src` 的版本一致性（parity 参考的是已发布 `lib`）。

9. **parity 的边界**
   parity 只证明“同一输入下两侧输出相同”，不证明协议符合 AMP 规范；它也不覆盖
   SQLite 子系统，以及治理层、runtime 会话等未被脚本 import 的模块（这些模块的
   运行时闭包是干净的，只是没有纳入用例）。规范级 conformance 仍需 JSON Schema
   与 fixtures（见第 5 节）。
