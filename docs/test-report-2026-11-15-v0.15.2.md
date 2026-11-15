# dsh-work-guard 实测报告（v0.15.2）

- 日期：2026-11-15
- 被测版本：`dsh-work-guard` **0.15.2**
- 安装位置：`~/.dsh/profiles/desktop/node_modules/dsh-work-guard`
- 状态接口：`http://127.0.0.1:52869/work-guard/status`
- 测试性质：独立第三方实测（非作者自测）
- 约束：未修改插件代码、未卸载/重装、未关闭任何规则

## 0. 结论摘要

这一版把上一轮报告里两个**真缺陷**修掉了，并新增了一个真正有用的工具 `work_verify`。
但它自己的测试与发布配置还有硬伤——如果现在推 GitHub，`npm test` 是空的。

| 维度 | 结论 |
| --- | --- |
| 闸门四条规则（read-before-write / read-depth / read-freshness / kotlin-derived-state） | ✅ 8/8 判定正确 |
| `work_verify` 主路径（红/绿/红→绿/探测/覆盖/JUnit/超时） | ✅ 全部正确 |
| 验证记账真实性（B1 假绿） | ✅ 已修复（shell 与 tool 两条路径都验过） |
| 绕过扫描（B2） | ⚠️ 部分修复：命令里带 `cd` 才生效 |
| 闸门可见性（B3） | ✅ 已修复：新增 `gateActive` / `gateGateReason` |
| 零测试 / 空测试套件 | ❌ 判成"通过"（P0） |
| 发布包能否跑自己的测试 | ❌ `files` 不含 `test/`（P0） |
| 测试残留 | ❌ 累计 2587 个临时目录 / 13.1 MB（P1） |
| 误伤 | 未观察到 |

## 1. 测试环境与方法

本次会话可用的工具：`pwsh`、`work_verify`、`work_declare`、`work_ledger`。
**没有** `read` / `edit` / `write` 工具（宿主未挂载），而闸门只挂在这两个工具上，因此：

| 层 | 测法 |
| --- | --- |
| 规则判定（第 1–4 条） | 调用插件导出的 `__internals.gate()` / `recordRead()`，走同一份判定代码 |
| `work_verify` | 真实工具调用 |
| 台账 / 状态 / 申报 | 真实工具调用 + HTTP status |
| 绕过扫描 | 真实 `pwsh` 写入 + status 观察 |

离线驱动脚本（隔离 `DSH_PROFILE_DIR`，不污染真实台账）：

```js
process.env.DSH_PROFILE_DIR = String(process.env.TEMP) + "\\wg-guard-isolated2"
const mod = await import("file:///C:/Users/c1066/.dsh/profiles/desktop/node_modules/dsh-work-guard/index.js")
const { gate, recordRead } = mod.__internals
```n
## 2. 测试夹具

| 夹具 | 用途 | 内容 |
| --- | --- | --- |
| `wg-probe2` | 基本红/绿 | `package.json`(test=node --test) + `sample.ts`(10 行) + `fail.test.mjs`(1 过 1 败) |
| `wg-big` | 压缩率 | 12 条全失败的测试 |
| `wg-junit` | JUnit fallback | 控制台只打印 `BUILD FAILED`，失败写在 `app/build/test-results/test/*.xml` |
| `wg-empty` | 空测试套件 | `package.json`(test=node --test)，**没有测试文件** |
| `wg-nocmd` | 无法探测命令 | 只有 README |
| `wg-kt` | Kotlin 规则 | `Main.kt` |

## 3. 闸门规则（8/8 通过）

| 用例 | 预期 | 实际 |
| --- | --- | --- |
| R1 未读就改第 10 行 | 拒绝 | `DENY read-before-write` |
| R2 只读 1–3 行后改第 9 行 | 拒绝 | `DENY read-depth ... outside the range you read` |
| R3 整读后改第 9 行 | 放行 | `PASS` |
| R4 改 mtime 后改第 9 行 | 拒绝 | `DENY read-freshness ... changed after you read it` |
| R5 Kotlin 无 key `remember { derivedStateOf { } }` | 拒绝 | `DENY no-unkeyed-derived-state` |
| R6 带 key 的 `remember(q)` | 放行 | `PASS` |
| R7 行尾加 `// work-guard: allow` | 放行 | `PASS` |
| R8 TS 文件里出现同样文本 | 放行（语言门生效） | `PASS` |

原始输出：

```
R1 未读就改第10行   -> DENY [deny] Work guard: read before write. `...\sample.ts` has not been read in this session.
R2 只读1-3行改第9行  -> DENY [deny] Work guard: the change touches line 9 of `...\sample.ts`, which is outside the range you read.
R3 整读后改第9行    -> PASS 放行
R4 mtime变后改第9行 -> DENY [deny] Work guard: `...\sample.ts` changed after you read it (the file on disk is newer than your last read).
R5 Kotlin 无 key remember -> DENY [deny] Work guard: `remember { derivedStateOf { ... } }` is a cache that never recomputes — ...
R6 带 key 的 remember   -> PASS 放行
R7 加 allow 标记        -> PASS 放行
R8 TS 里同样文本(应放行) -> PASS 放行
```

评价：R8 是这条 Kotlin 规则最好的设计点——**语言门**让它不会在 TS/Python 项目里乱报。
R7 的 `allow` 逃生口也合理，且只作用于那一行。

## 4. `work_verify`（本版重点，9 例 8 对 1 错）

### 4.1 失败的测试 — 正确

```
✖ 失败（exit 1） · npm test
共 2 · 通过 1 · 失败 1
失败用例：故意的失败用例
位置：fail.test.mjs:8 · AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
尾部：operator: 'strictEqual', / diff: 'simple' / }
（命令来自 package.json#scripts.test；目录 ...\wg-probe2）
```

一行结论 + 用例名 + 文件行号 + 断言 + 尾部，正好是"要定位还差什么"的最小集合。

### 4.2 修好之后 — 正确

```
✓ 通过 · npm test
共 2 · 通过 2 · 失败 0
```n
### 4.3 红 → 绿（状态机）— 正确

失败时：

```json
{"level":"block","title":"1 条红测试还没变绿",
 "action":"让这些用例通过，或者说明它们为什么不该修——别在别处加代码把现象盖住",
 "detail":"故意的失败用例"}
{"state":"red","summary":"红测试仍然红：1 条","stillFailing":["故意的失败用例"]}
```

同一条用例修好后：

```json
{"level":"ok","title":"没有待办","action":""}
{"state":"green","summary":"红 → 绿：1 条已通过","stillFailing":[]}
```

这条链路（记住基线 → 比对 failed 名单 → 判绿）是插件最有价值的部分，
它回答的是"你说修好了，那**同一条**用例过了吗"。

### 4.4 命令探测 — 正确

| 项目类型 | 探测结果 |
| --- | --- |
| 有 `package.json#scripts.test` | `npm test`（来源 `package.json#scripts.test`） |
| 有 `gradlew.bat` | `gradlew.bat test`（真实跑通了 Memore 的 Gradle 构建） |
| 只有 README | 明确报"没有认出验证命令"，并给出 `command:` 用法 |
| 目录不存在 | 报错，但显示的是上溯到的父目录 `...\Temp`（见 P2-4） |

### 4.5 显式 `command` 覆盖 — 正确

```
✓ 通过 · node --test --test-reporter=dot
（命令来自 explicit；目录 ...\wg-probe2）
```n
### 4.6 JUnit XML fallback（0.15.2 新功能）— 正确

夹具：控制台只打印 `BUILD FAILED`，失败写在 `app/build/test-results/test/TEST-*.xml`。

```
✖ 失败（exit 1） · npm test
失败用例：test_sub
信息：expected 1 but was 2
尾部：> node build-fail.js / > Task :app:testDebugUnitTest FAILED / BUILD FAILED in 1s
```

控制台一个字都提取不出来时，仍拿到了用例名和失败信息。这是**通用**能力（JVM 生态标准产物），
不是给某个项目特写，符合"能推 GitHub"的定位。

### 4.7 超时 — 正确（离线验证）

```
timedOut = true | exitCode = null | 用时 = 1211 ms
⏱ 超时（命令没有在时限内结束） · sleep 60
```

用 `runCommand({ timeoutMs: 1200 })` 走同一份代码，避免真等 120 秒。

### 4.8 压缩率 — 优秀

同一批 12 条失败：

| 指标 | 数值 |
| --- | --- |
| 原始输出 | 9614 字符 |
| 渲染结果 | 237 字符 |
| 压缩比 | **40.6x** |

### 4.9 空测试套件 — **错**（P0）

夹具 `wg-empty`：有 `package.json#scripts.test = "node --test"`，但一个测试文件都没有。

```
✓ 通过 · npm test
共 0 · 通过 0 · 失败 0
（命令来自 package.json#scripts.test；目录 ...\wg-empty）
```

**0 条测试 = 通过**。这对一个"防止把红说成绿"的工具来说是自相矛盾的：
什么都没跑，却给出了绿色结论。CHANGELOG 里已经写了"skipped 不算证据"，但 0 条没管。

真实踩到的例子就是本插件自己：在**安装后的包**里跑 `work_verify`，输出是

```
✓ 通过 · npm test
共 1 · 通过 1 · 失败 0
```

而实际上 `test/` 根本没被发布（见 P0-2），所谓"1 条通过"是 node 把
`lib/test-names.js` 当成测试文件执行了一遍（它是工具函数，里面没有任何 test）。

## 5. 验证记账的真实性（B1 修复验证）

上一轮报告的核心缺陷是"失败的测试被记成 `ok:true`"。本版两条路径都验了：

### 5.1 `work_verify` 路径

```json
{"kind":"verify","ok":false,"source":"tool","exitCode":1,
 "failed":["故意的失败用例"],"failedParser":"node-spec","cmd":"npm test"}
```n
### 5.2 shell（`pwsh`）路径

命令：`npm test > $null`（单行、无管道无分号，退出码可信）

```json
{"kind":"verify","ok":false,"source":"exit-code","exitCode":1,"failed":[],"cmd":"npm test > $null"}
```

结论：**B1 已修复**。`exitCodeOf()` 现在会从结果文本末尾解析 `[exit code: N]`，
并且删掉了 `isError` 兜底的假绿分支（改成 `is-error-unreliable` → `ok:null`）。

### 5.3 复合命令仍然记 `unknown` — 正确

```json
{"kind":"verify","ok":null,"source":"ambiguous-shell","exitCode":1,
 "failed":["用例 1 应该通过",...],"cmd":"cd \"$env:TEMP\\wg-big\"; npm test"}
```

带 `;` 时记 `exitCode:1` 但 `ok:null` —— 保守、不冒充。这是对的。
代价是：**带管道的命令永远拿不到红绿结论**（例如 `npm test | Select-Object -First 3`），
用户得知道要么用 `work_verify`，要么别加管道。

## 6. 绕过扫描与申报（B2 部分修复）

### 6.1 命令里带 `cd` — 生效

```
cd "C:\...\wg-probe2"; Set-Content -Path .\extra2.ts ...
```
下一个 `pwsh` 调用后：

```
undeclared.count = 2
  C:/Users/c1066/AppData/Local/Temp/wg-probe2/extra2.ts
  C:/Users/c1066/AppData/Local/Temp/wg-probe2/fail.test.mjs
```

`cwdHintsOf()` 会从命令文本里抠 `cd` / `Set-Location` / `pushd` 的路径作为扫描根。
连同之前 shell 改过的 `fail.test.mjs` 一起被回溯发现，行为符合预期。

### 6.2 不带 `cd` 的绝对路径写入 — 仍然漏

```
Set-Content -Path "C:\...\wg-probe2\extra3.ts" ...     （命令里没有 cd）
→ undeclared.count 仍是 2，extra3.ts 不在列表里
```

原因：扫描根只有三个来源——`TOUCHED_DIRS`（仅 write/edit 工具填）、
`cwdHintsOf(command)`（要命令里写字面量 `cd`）、`process.cwd()`（宿主进程目录）。
写绝对路径时三者都不覆盖目标目录。

**建议**：从 `Set-Content -Path`、`Out-File`、`tee`、`>` 重定向里抠路径，
或对 `pwsh` 工具传入的 cwd 做一次全量扫描。

### 6.3 申报 — 正确

```
已申报 2 个文件（测试夹具：用 pwsh 修复故意失败的测试用例）。当前没有未申报的脚本改动。
undeclared.count = 0  declaredCount = 1
```

`work_declare` 工作正常，台账里能查到 `declare` 行。

## 7. 状态接口与裁决（B3 修复验证）

本版新增两个字段，直击上一轮的"看起来在守、实际不守"：

```json
"gateActive": true,
"gateGateReason": "used",
"verdicts": {"level":"ok","title":"没有待办","action":""}
```

`computeGateActivity()` 的四级判断（tools → used → idle → unknown）设计合理：
能查工具就按能力判；查不到就按"这次会话闸门被进过几次"判；两者都没有就明确 `unknown`，
**不下结论**。这比上一版"永远显示正常"诚实得多。

`verdicts` 是给状态条的一句话结论，会随红测试变化：

| 场景 | verdicts |
| --- | --- |
| 有红测试 | `{"level":"block","title":"1 条红测试还没变绿","action":"让这些用例通过…","detail":"故意的失败用例"}` |
| 全绿 | `{"level":"ok","title":"没有待办","action":""}` |

评级：设计对。唯一遗憾是 `gateActive` 是**进程级**的，不区分会话——
本次测试会话根本没有 `write`/`edit` 工具，它仍显示 `true`（因为同进程的另一个会话用过闸门）。

## 8. 发布质量检查

| 项 | 结果 |
| --- | --- |
| 零运行时依赖 | ✅ 只用 node 内置模块 |
| 源码硬编码项目名 / 绝对路径 | ✅ 未发现（`Memore` / `memorandum` / `C:\` 全无） |
| LICENSE | ✅ MIT |
| README / README.zh | ✅ 中英双份 |
| CHANGELOG | ✅ 写得具体，带"为什么"和"实测数据" |
| CI workflow | ✅ 有 `.github/workflows/ci.yml` |
| 国际化 | ✅ `locale/en.json`、`locale/zh.json` |
| 发布包能否跑自己的测试 | ❌ `files` 不含 `test/`（P0-2） |
| 测试是否留下垃圾 | ❌ 2587 个临时目录 / 13.1 MB（P1-1） |

### 8.1 硬伤：发布包里的 `npm test` 是空的

`package.json` 的 `files` 白名单里没有 `test/`，所以 `npm pack` / 安装后的目录中测试全部消失。
此时在安装目录跑 `node --test`：

```
✔ lib\test-names.js (83.7764ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

node 把 `lib/test-names.js` 当成测试文件执行了（它匹配 `**/test-*.js` 的默认模式），
于是"1 个测试通过"——**这个文件里一条 test 都没有**。

后果：任何人（包括 CI、包括 `work_verify`）在发布包上跑测试都会看到绿色，而实际零覆盖。
对这类"给你证据"的插件来说，这是最不该有的假绿。

**建议**：`files` 加 `"test"`；或把 `lib/test-names.js` 改名为 `lib/testNames.js`（避开 node 的测试发现模式）。

### 8.2 测试残留

```
残留目录总数: 2587
总占用: 13.1 MB
最早: 2026-11-14 20:19:58   最新: 2026-11-15 11:21:53
```

按前缀分布：`wg-state*`、`wg-cfg-*`、`wg-gate2-*`、`wg-rotate-*`、`wg-kind-*`、`wg-depth-*`、`wg-append-*` 等。

根因：`test/*.mjs` 里 `mkdtemp` 出现 **42 处**，而 `rmSync` / `afterEach` 清理出现 **0 处**。

**建议**：每个 `mkdtempSync` 配一个 `t.after(() => rmSync(dir, { recursive: true, force: true }))`，
或统一封一个 `makeTmpDir(t)` 辅助函数。

## 9. 缺陷清单

| 级别 | 编号 | 问题 | 定位 | 影响 |
| --- | --- | --- | --- | --- |
| **P0** | P0-1 | 0 条测试判成"通过" | `lib/verify-tool.js` `summarizeRun` | 什么都没跑也给绿灯，自相矛盾 |
| **P0** | P0-2 | 发布包不含 `test/`，且 `lib/test-names.js` 被当测试 | `package.json#files` | 安装后 `npm test` 恒绿，零覆盖 |
| **P1** | P1-1 | 测试留下 2587 个临时目录 / 13.1 MB | `test/*.mjs` 42 处 `mkdtemp` 无清理 | 每次测试污染 `%TEMP%` |
| **P1** | P1-2 | 绕过扫描对"不带 cd 的绝对路径写入"漏报 | `index.js` `cwdHintsOf` 附近 | shell 改源码可以不进欠账 |
| **P2** | P2-1 | `work_verify` 无参时跑宿主进程 cwd 的项目 | `index.js` `baseDir` | 本次实测白跑了一次 Memore 的全量 Gradle 构建 |
| **P2** | P2-2 | `work_ledger` 里 `declare` 行显示 `undefined` | 渲染层 | 可读性 |
| **P2** | P2-3 | 命令文本含 "npm test" 字样即记为验证 | `looksLikeVerify` | 本次实测：一个离线 node 脚本因命令行里嵌了 `command: "npm test"` 被记了一条 verify |
| **P2** | P2-4 | 不存在的 cwd 报错显示父目录 | `projectRootFor` 上溯 | 定位时容易误读 |

### P0-1 细化

```js
// 现状：只要有 exitCode === 0 就是 ok
const ok = timedOut ? false : exitCode === 0
```

建议：`total === 0`（且文本里没有任何用例统计）时，输出改为

```
⚠ 通过但没有跑任何测试（共 0） · npm test
```

并让 `ok` 仍然为 `true`（退出码确实是 0），但**不写进"已验证"**，或者在 verdicts 里降级为
`{"level":"warn"}`。红→绿证据链也应拒绝"0 条"作为绿。

## 10. 发布前建议清单

1. `files` 加 `test`；或把 `lib/test-names.js` 改名，避免被 node 当测试。
2. `work_verify` 对 0 条测试给警告，别给纯绿。
3. 测试目录清理（42 处 `mkdtemp` 配 `t.after`）。
4. 绕过扫描补上"从命令文本里抠写入路径"（`Set-Content -Path`、`>`、`Out-File`、`tee`）。
5. `work_verify` 无参时，若 `TOUCHED_DIRS` 为空且 `process.cwd()` 不是工作区，先反问而不是直接跑。
6. `work_ledger` 给 `declare` 行一个可读标签。
7. `looksLikeVerify` 加一条：命令里出现 heredoc / 引号包裹的 `command:` 时降低置信度。

## 11. 本次未覆盖

- 真实 `read` / `edit` 工具链路上的端到端拦截（本会话宿主未挂载这两个工具）。
- `work_verify` 的 120 秒真实超时（用 `runCommand({ timeoutMs: 1200 })` 走同一份代码替代）。
- 台账轮转（5000 行）与跨天统计。
- 多 agent / 多 scope 下的 `gateActive` 判定。
- Windows 以外的路径形态。

## 12. 总体评价

判定层（四条规则）已经稳了，8 个用例全对，文案能直接指导修复。
`work_verify` 的出现补上了上一轮最大的洞——**验证记账**，并且压缩率 40x 是实打实的体验提升；
JUnit fallback 让它对 JVM 项目也成立，这一点决定了它能不能"通用"。

剩下的问题集中在**元层面**：不是规则写错，而是"这个插件怎么证明自己没问题"。
P0-1 和 P0-2 叠在一起，恰好构成同一个讽刺——
一个专门防"把红说成绿"的工具，自己的测试套件是空的，而且它会把这个空套件报成绿色。
把这两条修掉，再清掉临时目录，这个插件就可以体面地推上 GitHub 了。