# dsh-work-guard 实测报告（v0.9.0）

- 日期：2026-11-14
- 被测版本：`dsh-work-guard` 0.9.0（`~/.dsh/profiles/desktop/node_modules/dsh-work-guard`）
- 状态接口：`http://127.0.0.1:52002/work-guard/status`
- 测试方式：真实运行 + 离线复现（见 §2）
- 约束：全程未修改插件代码、未卸载/重装、未关闭任何规则

## 0. 结论摘要

判定层是准的，记账层是漏的，拦截层在本次会话里根本不在链路上。

| 维度 | 结论 |
| --- | --- |
| 三条规则（read-before-write / read-depth / read-freshness） | ✅ 判定与文案均正确 |
| 闸门（write/edit 拦截） | ⚠️ 本会话无 write/edit 工具，一次都没触发 |
| 验证记账 | ❌ 失败的测试被记成 `ok:true`（假绿） |
| 绕过扫描（shell） | ❌ 运行期 root 解析失败，跨目录写入完全漏报 |
| 误伤 | 未观察到（本次全是"该拒没拒"，没有"该放行却拒") |

## 1. 环境与前置事实

1. 插件已在运行：status 返回 `alive:true`，`rules` 四条规则全部注册，`configSource:"default"`。
2. 本次测试会话**没有 `read` / `edit` / `write` 工具**，可用的写文件手段只有 `pwsh`（shell）。
   而闸门只挂在 `tools/pre-execute` 的 `write` / `edit` 上，因此第 1–4 步无法用真工具触发。

## 2. 测试方法

| 步骤 | 方法 | 说明 |
| --- | --- | --- |
| 1–4 | 离线复现 | 调用插件导出的 `__internals.gate()` / `recordRead()`，走同一条判定代码 |
| 5–7 | 真实运行 | 通过真实 `pwsh` 工具触发 `tools/pre-execute` / `post-execute` 钩子与 `work_declare` |

离线复现脚本（隔离 `DSH_PROFILE_DIR`，不污染真实台账与已读状态）：

```js
import { utimesSync } from "node:fs"
process.env.DSH_PROFILE_DIR = String(process.env.TEMP) + "\\wg-guard-isolated"
const mod = await import("file:///E:/Vibe%20Coding/workspace/dsh-work-guard/index.js")
const { gate, recordRead } = mod.__internals

const FILE = "C:\\Users\\c1066\\AppData\\Local\\Temp\\wg-probe\\sample.ts"
const show = (label, d) => console.log(label, d === undefined ? "PASS 放行" : "DENY [" + d.kind + "] " + d.reason.split("\n")[0])
const edit = (a, b) => gate({ name: "edit", arguments: { file_path: FILE, old_string: a, new_string: b } })

show("1) 未读就改第10行  ->", await edit("export const line10 = 10", "export const line10 = 100"))
recordRead({ name: "read", arguments: { file_path: FILE, offset: 1, limit: 3 } })
show("2) 只读1-3行改第9行 ->", await edit("export const line9 = 9", "export const line9 = 99"))
recordRead({ name: "read", arguments: { file_path: FILE } })
show("3) 整读后改第9行   ->", await edit("export const line9 = 9", "export const line9 = 99"))
await new Promise(r => setTimeout(r, 2600))
const t = new Date(); utimesSync(FILE, t, t)
show("4) 改mtime后改第9行 ->", await edit("export const line9 = 9", "export const line9 = 99"))
```

## 3. 测试夹具

`%TEMP%\wg-probe`：

- `package.json`：`{"type":"module","scripts":{"test":"node --test"}}`
- `sample.ts`：10 行 `export const lineN = N`
- `fail.test.mjs`：`assert.equal(1, 2)`（故意失败）

## 4. 逐步骤结果

### 步骤 1 — 未读就改第 10 行

预期：拒绝，提示没读过。

```
1) 未读就改第10行  -> DENY [deny] Work guard: read before write.
   `C:\Users\c1066\AppData\Local\Temp\wg-probe\sample.ts` has not been read in this session.
```

结论：一致。

### 步骤 2 — 只读 offset=1/limit=3 后改第 9 行

预期：拒绝，提示超出读过的行范围。

```
2) 只读1-3行改第9行 -> DENY [deny] Work guard: the change touches line 9 of
   `...\sample.ts`, which is outside the range you read.
```

结论：一致。

### 步骤 3 — 整读后改第 9 行

预期：放行。

```
3) 整读后改第9行   -> PASS 放行
```

结论：一致（`gate()` 只做判定，不落盘，`sample.ts` 未被改动）。

### 步骤 4 — 改 mtime 后改第 9 行

预期：拒绝，提示文件在读之后被改过。

```
4) 改mtime后改第9行 -> DENY [deny] Work guard: `...\sample.ts` changed after you read it
   (the file on disk is newer than your last read).
```

结论：一致。

### 步骤 5 — 三次验证的记账

初始：`verifies=51  verifiesFailed=2  verifiesUnknown=6`

| 时点 | 命令 | 结果 | verifies | failed | unknown | 台账记录 |
| --- | --- | --- | --- | --- | --- | --- |
| 5a | `cd ...; npm test` | 失败 | 51 | 2 | 7 | `ok:null, source:"ambiguous-shell"` |
| 5a′ | `npm test`（干净） | **失败** | 52 | 2 | 7 | **`ok:true, source:"is-error"`** |
| 5b | 修好后 `npm test` | 通过 | 53 | 2 | 7 | `ok:true` |
| 5c | `npm test \| Select-Object -First 3` | 通过 | 53 | 2 | 8 | `ok:null, source:"ambiguous-shell"` |

- 5a 记 `unknown` 是**正确**的保守行为：带 `;` / `|` 的复合命令退出码不可信。
- 5a′ 是缺陷：真实的失败被记成成功，`verifiesFailed` 全程停在 2 没动。
- 5c 记 `unknown` 符合设计，但也说明**带管道就永远拿不到结论**。

### 步骤 6 — pwsh 新建 extra.ts

预期：`undeclared.count` 变成 1。

```
6) undeclared.count=0  files=
todayStats: verifies=53 failed=2 unknown=8 bypass=291
```

未变成 1，`bypass` 也停在 291。

补充对照：在 `C:\Users\c1066\.wg-probe-home.ts` 与 `E:\agents tool\DSH\.wg-probe-app.ts` 各放一个探针，同样未被扫到。
再用插件自己的 `scan.js` 离线喂正确 root，同一批文件能扫出 3 个 —— 说明检测器本身正常，是运行期 root 解析没覆盖到。

探针文件已全部删除。

### 步骤 7 — work_declare 申报 extra.ts

```
已申报 1 个文件（测试：pwsh Set-Content 新建的探针文件）。当前没有未申报的脚本改动。
7) undeclared.count=0  declaredCount=1  bypass=291
```

工具执行成功，但因步骤 6 没有产生欠账，`count` 本来就是 0，无法证明"1 → 0"。

## 5. 汇总表

| 步骤 | 预期 | 实际 | 一致 |
| --- | --- | --- | --- |
| 1 未读就改第 10 行 | 拒绝（没读过） | `deny: read before write` | ✅（离线） |
| 2 只读 1–3 行改第 9 行 | 拒绝（超出范围） | `deny: touches line 9 ... outside the range you read` | ✅（离线） |
| 3 整读后改第 9 行 | 放行 | 放行 | ✅（离线） |
| 4 touch 后改第 9 行 | 拒绝（读后被改） | `deny: changed after you read it` | ✅（离线） |
| 5a 复合命令跑失败测试 | 记一次失败 | `unknown`（保守正确） | ⚠️ 部分 |
| 5a′ 干净命令跑失败测试 | 记一次失败 | 记成 `ok:true` | ❌ |
| 5b 修好后跑通过 | 记一次成功 | `ok:true` | ✅ |
| 5c 带管道跑 | 不冒充成功 | `unknown` | ✅ |
| 6 新建 extra.ts | count → 1 | 仍为 0 | ❌ |
| 7 申报 extra.ts | 1 → 0 | 执行成功，恒为 0 | ➖ 无法判定 |

## 6. 缺陷清单

### B1（高）验证假绿：失败的测试被记成成功

- 定位：`lib/verify-result.js:74-75`
- 现象：干净命令 `npm test` 返回码 1，台账写成 `ok:true, source:"is-error"`。
- 根因：`exitCodeOf()` 只认 `result.value.exitCode / exit_code / code / meta.exitCode`，而 pwsh 工具的结果里没有这些字段（退出码只出现在输出文本 `[exit code: 1]`）；随后落到兜底分支 `result.isError === false`。**工具调用成功 ≠ 命令成功**，该兜底把两者混为一谈。
- 影响：`todayStats.verifies` 会涨、`verifiesFailed` 永远为 0，状态条上的"已验证"不可信。这是本插件最核心的承诺之一。

### B2（高）shell 绕过扫描跨目录不工作

- 定位：`index.js:395-405`
- 现象：在 `%TEMP%\wg-probe`、家目录、应用目录各建源码文件，`undeclared.count` 始终 0。
- 根因：扫描 root 只来自三处 —— `TOUCHED_DIRS`（仅由 write/edit 工具填充）、`args.workdir`（pwsh 工具不传）、`process.cwd()`（宿主进程目录，不是工作区）。当会话里没有 write/edit 工具时，三处全部落空，扫描范围与项目无关。
- 佐证：`lib/scan.js` 在给定正确 root 时能正常扫出 3 个文件。
- 影响：`work_declare` 的整套"欠账"机制失去输入源，状态条永远干净。

### B3（中）无 write/edit 工具时闸门完全空转

- 定位：`index.js:382`、`index.js:414`
- 现象：本次会话所有落盘都走 `pwsh`，`pre-execute` 里 `tool === 'write' || tool === 'edit'` 一次未进。
- 说明：这是设计前提（README 已声明"只挡工具写入，挡不住 shell"），但当宿主根本不提供那几个工具时，插件的**全部拦截能力为零**，只剩提示词与台账。
- 影响：能否生效完全取决于宿主给不给 write/edit 工具，且插件自身无法感知这种"空转"状态（status 里没有任何字段表示"本会话未挂到任何写入工具"）。

## 7. 未覆盖项

- 真实 `read` / `edit` 工具链路上的端到端拦截（本会话无此工具）。
- `no-unkeyed-derived-state`（仅 Kotlin，本次夹具为 TS）。
- 配置项覆盖（`work-guard.config.json`）、台账轮转（5000 行）。
- 红→绿证据链（`fixEvidence`）：因 B1 导致基线不可信，本次未展开。

## 8. 建议方向（未实施）

1. B1：pwsh/bash 结果优先解析文本里的 `[exit code: N]`，或在宿主侧给结果补 `exitCode`；两者都取不到时记 `unknown`，**不要**用 `isError` 兜底成成功。
2. B2：把"本次会话实际 cwd"（shell 的 `Set-Location` 目标）纳入 root 来源；或在 pwsh 工具 schema 里补 `workdir` 并透传。
3. B3：在 `apply()` 检测宿主是否注册了 write/edit，若无则在 status 里显式标记 `gateActive:false`，避免"看起来在守、实际不守"。