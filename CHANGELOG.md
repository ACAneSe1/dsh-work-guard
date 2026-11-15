# Changelog

## 0.15.8 — 2026-11-15

CI 第一次跑就红了：ubuntu 两个 job 失败，windows 全过。**那不是测试写得松，是代码里有个真 bug。**

### Fixed

- **盘符路径在 Linux 上被 `resolve()` 拼坏。** `keyOf` 直接把 `resolve(p)` 当绝对化，
  而 Linux 上 `resolve('E:/work/a.ts')` 不会保持原样——它拼成 `<cwd>/E:/work/a.ts`。
  同一个文件在两个平台得到两个键，跨平台比较全错。

  新增 `toAbsolute()`：盘符路径（`C:\` / `C:/`）在任何平台都**原样保留**；
  POSIX 绝对路径走 `resolve()`；相对路径按 base 拼（base 也是盘符时用 `join`）。
  `keyOf` / `projectRootOf` / `cwdHintsOf` / `writeTargetsOf` 统一走它。

### Changed

- **GitHub 首页改为中文**：`README.md` 现在是中文，英文在 `README.en.md`，两份顶部互相链接。
  原因是 GitHub 只渲染 `README.md`——以前中文那份叫 `README.zh.md`，首页永远是英文。
- 诚实范围更新：CI 在 `ubuntu-latest` 与 `windows-latest`（Node 22 / 24）四个组合全绿；
  但**插件本体仍只在 Windows 上装过、跑过**，macOS 没有任何证据。

### Tests

- 期望值不再写死小写盘符：一律过 `normPath()`（Windows 折叠大小写、Linux 保留），
  测试跟着真实行为走。
- `relativeTo` 与写入目标改用真实临时目录 / POSIX 路径。
- 新增一条 POSIX 绝对路径用例（163 条）。

## 0.15.7 — 2026-11-15

### Changed

- **"未验证"只统计源码改动。** 之前改一份 README、一份测试报告也会把面板点红，逼着跑测试——
  形式主义。红灯太多，人就会开始无视它，那这个插件就废了。

  现在：`.ts/.tsx/.js/.mjs/.kt/.kts/.java/.rs/.go/.py/.dart` 计入；`.md/.json/.yml/.txt/.ps1`
  只记进台账，不点红灯。

  **台账、申报、脚本绕过仍然记所有文件** —— 变的只是"未验证"这一盏灯看什么。

### Added

- `lib/stats.js` 新增 `sourceEdits`（源码改动数）与 `isSourceFile` 选项；
  面板仍显示总改动数 `edits`，两者分开。
- 两条新测试：文档改动不算未验证；验证之后又改源码仍算。

## 0.15.6 — 2026-11-15

v0.15.2 实测报告里剩下的四条 P2。

### Fixed

- **P2-1：`work_verify` 无参时会在宿主进程的 cwd 里跑。** 那份 cwd 通常不是工作区
  （实测白跑了一次 Memore 的全量 Gradle 构建）。现在：没给 `cwd`、本会话也还没写过文件时，
  直接回一句"不知道在哪个项目里跑，请给 cwd"，**不替用户猜**。
- **P2-2：台账里 `declare` 行渲染成 `declare undefined`。** 现在写成
  `申报 3 个文件：批量替换`。
- **P2-3：命令文本里出现 `npm test` 字样就记一条验证。** 实测踩到：一个 node 脚本的参数里
  含有 `command: "npm test"`，被记成验证。现在只对**去掉引号内容之后**的文本做匹配，
  真实的 `npm test` / `npm test -- "x"` 仍然命中。
- **P2-4：`cwd` 不存在时报错却显示父目录。** 现在直接说"目录不存在"，不会上溯到父目录去跑。

### 顺带

- 台账的验证行现在带结论：`验证 通过` / `验证 失败` / `验证 未知`（0 条测试会标出来），
  以前只显示命令，看不出过没过。

## 0.15.5 — 2026-11-15

### Fixed — P1-2：不带 `cd` 的绝对路径写入漏报

扫描根原来只有三个来源：write/edit 工具写过的目录、命令的 `workdir`、命令里字面量的
`cd`/`Set-Location`、宿主 cwd。于是

```powershell
Set-Content -Path "C:\proj\x.ts" -Value 1     # 命令里没有 cd
```

**完全不会被发现**——脚本改了源码，面板一条欠账都没有。

- 新增 `writeTargetsOf(command, baseDir)`：从 `Set-Content/Add-Content/Out-File/Tee-Object
  -Path/-FilePath`、`>` / `>>`、`tee` 里抠写入目标；输出设备（`$null`/`nul`/`/dev/null`）
  与无法解析的变量一律跳过（不猜）。
- 这些目标所在目录只用来**扩大扫描范围**，不改变任何判定规则。

### Tests

- `test/write-targets.test.mjs` 7 条：四种写入形态、相对路径、`$null`、变量、去重。

## 0.15.4 — 2026-11-15

### Fixed — P1-1：测试不再往 %TEMP% 里堆目录

报告实测：累计 2587 个临时目录 / 13.1 MB，根因是 `test/*.mjs` 里 30 处 `mkdtempSync`
**一处清理都没有**。

- 新增 `test/helpers/tmp.mjs`：`makeTmp(prefix)` 建目录并登记，进程退出时统一 `rmSync`。
  没用每个 `t.after`，因为多数调用在辅助函数里拿不到 `t`；退出时删一次效果相同、改动最小。
- `test/*.mjs` 全部 `mkdtempSync(join(tmpdir(), X))` → `makeTmp(X)`（30 处），
  并清掉不再使用的 `mkdtempSync` / `tmpdir` / `join` 导入。
- 历史遗留的 2783 个 `wg-*` 目录已清理。

实测：清理前 2783 个 → 清理后 0；再跑一次全量测试，跑完仍是 **0**。

## 0.15.3 — 2026-11-15

两处 P0，来自 v0.15.2 的独立实测报告（`docs/test-report-2026-11-15-v0.15.2.md`）。

### Fixed — P0-2：发布包里的 `npm test` 是空的

`files` 白名单不含 `test/`，所以安装后的包里测试全没了；更糟的是 node 的默认测试发现
把 `lib/test-names.js` 当成了一个测试文件（它匹配 `**/test-*.js`），于是 `npm test` 报
"1 个测试通过"——**那个文件里一条 test 都没有**。

- `lib/test-names.js` → `lib/testNames.js`（不再撞 node 的发现模式）
- `files` 加入 `test`

实测：解包后 `node --test` 从"1 条假绿"变成跑满全部用例（dot 输出 3 行点阵）。

### Fixed — P0-1：0 条测试被当成"通过"

一个专门防"把红说成绿"的工具，把空套件报成了绿色。

- `summarizeRun` 新增 `zeroTests`；渲染改为
  `⚠ 通过，但一条测试都没跑到` + `这条不能算"已验证"：0 条测试，什么都没证明`
- 台账里这种行记 `ok: null`（命令确实成功，但什么都没证明），**不会清掉"未验证"，
  也不会被红→绿当成绿**
- 面板新增一条 warn：`最近一次验证没跑到任何测试（0 条）` + 下一步动作

## 0.15.2 — 2026-11-15

Two gaps found by running `work_verify` on the Android project.

### Added

- **JUnit XML fallback.** Gradle/Maven print only `BUILD FAILED`, so the compact summary could not
  name a single failing test. When the text yields no test names, the tool now reads the standard
  JUnit reports (`app/build/test-results`, `build/test-results`, `target/surefire-reports`,
  `<module>/build/test-results`) and reports the real failing test names plus the first failure
  message. Generic to the JVM ecosystem, not special-cased to one project.

### Changed

- **Rule 9 now names the tool**: `跑测试用 work_verify…不要自己敲测试命令把整段输出搬进上下文`.
  Without this, the tool existed but nothing asked the model to use it — the most common way a
  plugin quietly dies.

## 0.15.1 — 2026-11-15

`work_verify` only answered "which test failed", so the model still had to open the test file to
find out why.

### Changed

- A failure now carries **one** diagnostic line — the first failure's location plus its assertion:

  ```
  ✖ 失败（exit 1） · npm test
  失败用例：test_add
  位置：fail.test.mjs:4 · AssertionError: 1 !== 2
  尾部：…
  ```

  Recognised shapes: `test at file:4:1` (node), `(file:///…:5:10)`, `path:42: AssertionError`
  (pytest), and a generic `file.ext:line:` fallback. When nothing matches, the line is omitted
  rather than invented.
- Default timeout lowered 300s → 120s: a synchronous call leaves the session silent for its whole
  duration, so five minutes of that reads as a frozen UI.

### Tests

- Four cases for location extraction (node, pytest, no-location) and a bound on render length.

## 0.15.0 — 2026-11-14

`work_verify`: run the project's tests, return two lines instead of two hundred.

### Added

- **`work_verify(cwd?, command?)`** — detects the project's verification command
  (`package.json#scripts.test` → `npm test`, `gradlew[.bat]` → `gradlew test`, `Cargo.toml`,
  `go.mod`, `pyproject.toml`), runs it, and returns a compact verdict:

  ```
  ✓ 通过 · npm test
  共 141 · 通过 141 · 失败 0
  ```

  Failure form: `✖ 失败（exit 1）` + up to five failing test names + the last three lines.

- The result is written to the ledger with `source: "tool"` and the **real exit code**, so it counts
  as verification exactly like a shell run — and a red run can never be mistaken for a pass.

### Measured

- Same `npm test` run: raw output 5237 characters (~1.3k tokens) → rendered 2 lines
  (`tools/try-verify.mjs`).

## 0.14.3 — 2026-11-14

Rule 9, about how to run tests without burning context.

### Added

- Rule 9 in the default prompt:

  > 跑测试先看结论：用 dot/quiet 输出判断红绿（几行就够），
  > 红了再单独跑失败的那几条。不要把整份测试输出贴进来。

  Measured on this repository: `npm test` prints ~140 lines (~2.6k tokens); the same run with
  `node --test --test-reporter=dot` prints 7 lines (~60 tokens) for the same exit code.

### Note

- Skipped (`yellow`) tests never count as evidence: the exit code can be 0 while the important
  test never ran. The guard cannot detect that — it only sees exit codes and failing names.

## 0.14.2 — 2026-11-14

One short prompt line, per the user's call: no subprocess, no extra turns, no new mechanism.

### Added

- Rule 8 in the default prompt (~37 characters):

  > 结束这一轮之前，先自己问一句：这次改的地方验证了吗？红测试变绿了吗？
  > 没验证就现在跑一次；还红着就继续改，不要先报告完成。

  That is the same challenge the `问` button used to send manually, now asked before the turn
  ends. One pass — it does not loop.

## 0.13.2 — 2026-11-14

The `问` button reported "已发出" while nothing was sent. Screenshot of the real `inputActions`
list gave the answer.

### Fixed

- **`submit` does not take text.** It submits whatever draft is already in the composer. 0.13.1
  called `submit(text)`, saw no exception, and claimed success — an empty draft was submitted,
  so the question went nowhere. The order is now: `setDraft(text)` (or `insertText`), then
  `submit()`; if the draft cannot be written the result downgrades honestly to `filled`/`copied`.
- **`gateActive` concluded `false` on a fresh start.** Without a known agent scope,
  `ctx.tools.definitions(undefined)` only lists global registrations (our own tools), so `write`/
  `edit` were missing and the panel announced that the gate was idle. With no scope the answer is
  now `null` ("unknown") — the panel stays silent instead of guessing.

### Known API (confirmed by screenshot)

`insertQuote, captureInsertion, insertText, setDraft, persistDraft, addAttachments,
removeAttachment, pruneAttachments, submit`

## 0.13.0 — 2026-11-14

Seeing a problem is not the same as being able to act on it.

### Added

- **Every pending item in the popover has a `问` button.** It sends a specific challenge to the
  model for that item — not a generic complaint:
  - unverified edits → "你这次改了 N 处但没有验证，请跑测试并贴出真实输出（含退出码，命令别加管道）"
  - red tests → "这些测试还没变绿：…；请让它真的通过，不要用别处的代码盖住"
  - unscripted writes → "这些文件是脚本改的：…；请 work_declare 申报或说明为什么不用申报"
- `sendToModel()` probes the host's `inputActions` for a known call shape
  (`submit`/`send`/`sendMessage`/… then `setText`/`setDraft`/…), and falls back to the clipboard.
  It **never** claims to have sent something it did not: the UI reports `已发出` / `已填入输入框` /
  `已复制` / `发送失败` honestly.

### Note

- The exact `InputActions` method names are not published as types in the shipped bundle, so the
  probe list is best-effort. Once the real name is known, it should be pinned and the probe removed.

## 0.12.0 — 2026-11-14

UI, third attempt — and this time by removing things.

The 0.11.0 settings page was the wrong home: nobody opens a settings page to read evidence.
The composer dock was the wrong shape: a permanent line nobody asked for. So both are gone.

### Changed

- **One control, in the composer's tool row** (`conversation.input.left`): a small chip showing
  `无待办` / `N 项` with a coloured dot. Clicking it opens a 300px popover.
- The popover shows exactly three things: up to three pending verdicts (the first one with its
  single next action), up to three scripted file names, and one counter line
  (`3 改 · 1 验 · 0 未申报`). Nothing else — no rule table, no ledger rows, no config paths.
- The permanent status line under the composer and the every-turn badge were removed.
- Denial/bypass notices still appear as a short transient line above the button.

### Removed

- `settings.plugins.tab` page, `conversation.composer.dock` line, `conversation.chat.turnTail` entry.

## 0.11.0 — 2026-11-14

The panel said `3 改 · 0 验 · 2 绕过`. Nobody — including the author — could tell what to do with that.

### Changed

- **The status line answers "is there anything to do?", not "how many of each".** One line: either
  `无待办` or the single most important pending item (`⛔ 2 条红测试还没变绿`, `⚠ 3 个文件是脚本改的，没有申报`).
  Counts moved into the tooltip and the settings page.
- `verdictsOf()` (`lib/verdict.js`) turns counters into three kinds of statements: `block`
  (must act), `warn` (visible, can wait), `ok` (silent). An indicator with no action attached does
  not get the main slot any more.
- The "gate not mounted" special case is now just another `warn` verdict — one place, one message.

### Added

- **A settings page** (`settings.plugins.tab`, titled 工作证据): the pending list with its action,
  this session's counters, the rule table, and where the ledger/config live. The composer dock was
  never an interaction surface; this is.

## 0.10.4 — 2026-11-14

Supplementary verification (`tools/verify-extra.mjs`) found the ledger rotation was broken.

### Fixed

- **Rotation created an empty backup and never moved the ledger.** `rotateIfNeeded()` wrote an empty
  file at `<ledger>.1` and then renamed the ledger onto that path — on Windows, renaming onto an
  existing file fails, so the exception was swallowed and only the empty backup remained. It now
  deletes a stale backup first and then renames.
- **The rotation threshold was bytes, not rows.** `size < rotateAtRows * 220` never fires on a
  ledger of short rows (and fires early on long ones). It now counts rows, which is what the option
  name says.

### Added

- `reloadConfig()` exported from `index.js` (the config half of `apply()`), so tests can exercise
  a real `work-guard.config.json` without booting the host.
- `tools/verify-extra.mjs`: three runnable checks (rotation, config file, concurrent appends),
  all passing.
- Ledger tests now pin the row-based threshold and the "full history in the backup" property.

## 0.10.3 — 2026-11-14

The status bar claimed "闸门未挂载（无写入工具）" in a session that had the tools all along.

### Fixed

- **`gateActive` was derived from usage only.** In a session that had written nothing yet but had
  already used a script, the bar announced that the gate was not mounted — while the tools were
  present and the gate was ready. Detection now first asks the tool registry **with the agent
  scope** captured from the last call (`ctx.tools.definitions(agent)`; an unscoped call only sees
  global registrations, which is why 0.10.0 misfired), and falls back to usage evidence.
- The verdict is now `{active, reason}`: `tools` (capability present) / `used` (it ran) / `idle` /
  `unknown`, so "not used yet" and "cannot be used" are no longer the same message.
- The amber bar reads **闸门未触发** with a title explaining that script writes do not go through
  the gate — it no longer claims the tool is missing.

## 0.10.2 — 2026-11-14

The real cause of B2, found by testing the 0.10.1 fix live.

### Fixed

- **Bypass scanning ran before the command executed.** It lived in `tools/pre-execute`, so it could
  only ever see what an *earlier* call had changed (relying on a 60-second window). Adding more root
  hints could not fix that — the files did not exist yet. The scan now runs in
  `tools/post-execute`, after the shell call settles, which is when the files are actually written.
- `failingTests()` no longer records the `✖ failing tests:` section header as a failing test name.

## 0.10.1 — 2026-11-14

Regression from 0.10.0, caught immediately after a restart.

### Fixed

- **`gateActive` reported `false` in a session that does have write/edit.** 0.10.0 asked
  `ctx.tools.definitions()` without a scope, which returns only globally registered tools — while
  `write`/`edit` are registered per agent scope, so they were invisible. The status bar then showed
  "闸门未挂载（无写入工具）" while the gate was in fact working.
- Detection is now evidence-based, not registry-based (`lib/gate-activity.js`):
  *write/edit call seen* → `true`; *no such call but a script write was detected* → `false`;
  *neither* → `null` (the bar shows no verdict). Four unit tests pin the three states.

## 0.10.0 — 2026-11-14

Fixes for the independent test session's report (`docs/test-report-2026-11-14.md`).

### Fixed (B1, high) — verification was recorded green when it failed

`exitCodeOf()` only read structured fields, but the pwsh tool reports the exit code **in the output
text** (`[exit code: 1]`), so the lookup fell through to the `isError` fallback — and a tool call
that succeeded is not a command that succeeded. A failing `npm test` was written as
`ok: true, source: "is-error"`, and `verifiesFailed` never moved.

The exit code is now read from the text marker when no structured field exists, and the `isError`
fallback is **removed**: with no exit code the row is `ok: null, source: "is-error-unreliable"`.
An unknown verification can never clear the unverified count.

### Fixed (B2, high) — bypass scan missed the workspace when no file tools were used

Scan roots came only from directories touched by `write`/`edit`, the command's `workdir` argument,
and the host process cwd. In a session without file tools all three are empty, so scripted writes
were invisible even inside the project. `cwdHintsOf()` now extracts `cd` / `Set-Location` / `pushd`
targets from the command itself (`lib/paths.js`).

### Fixed (B3, medium) — the gate could be idle while pretending to guard

If the host does not expose `write`/`edit`, the gate never fires — and the status bar still said
"闸门". `/work-guard/status` now carries `gateActive` (`true` / `false` / `null` when the registry
cannot be asked), and the status line switches to **闸门未挂载（无写入工具）** in amber.

### Added

- `test/b1-b2.test.mjs` (7 cases) pinning all three behaviours.

## 0.9.0 — 2026-11-14

Self-review pass: three holes found by walking through the plugin's own edge cases.

### Fixed

- **Script writes were invisible right after a restart.** The scan only looked at directories that
  file tools had touched, which is empty on a fresh process — so a script that rewrote sources in
  the first minute produced no bypass record at all. The scan now also uses the command's `workdir`
  and, when nothing else is known, the host's current directory.
- **Deleted files stayed as silent debt.** A script write is still a fact after the file is deleted,
  but the status list gave no hint. `undeclared.items[].exists` / `undeclared.missing` now mark it.
- **`work_declare` accepted paths that do not exist**, reporting success while covering nothing.
  It now warns how many of the given paths were not found.

### Added

- `test/status.test.mjs` grew to four cases, including "deleted file stays as debt but is marked".

## 0.8.2 — 2026-11-14

The 0.8.1 fix did not actually apply.

### Fixed

- **0.8.1's change missed its target.** The replacement was written against the wrong indentation,
  so `guardStatus()` still passed the full ledger to `undeclaredChanges()` — the status line kept
  showing 289 unaccounted script writes after a restart. The call now uses the since-start rows.
- Added `test/status.test.mjs`: a regression test that drives `guardStatus()` itself. Unit tests of
  `lib/declare.js` cannot catch this class of bug, because the defect is *which array is passed*,
  not what the function does with it.

## 0.8.1 — 2026-11-14

Found on the first live run of 0.8.0.

### Fixed

- **`undeclared.count` counted the entire ledger**, so the status line showed 288 unaccounted
  script writes that were all history — the same "history mixed into the current number" defect
  fixed for the other counters in 0.3.1. Unaccounted debt is now scoped to the current plugin start,
  and `work_declare`'s "remaining" figure uses the same scope.

## 0.8.0 — 2026-11-14

Scripts still bypass the gate by design (they do not go through the write tools). What changes here
is that unaccounted script writes can no longer stay invisible.

### Added

- **`work_declare` tool.** After a scripted rewrite, declare the files it touched and why; the
  declaration is written to the ledger.
- `lib/declare.js` matches a declaration to the earlier bypass rows for the same file (30-minute
  window, order matters — declaring before the change does not cover it).
- `/work-guard/status` reports `undeclared.count` / `files`, and the status line shows
  `N 处未申报` in red while any script write is unaccounted for.

### Not claimed

- This does **not** block shell writes and cannot. It makes the debt countable: "3 files declared,
  2 still unaccounted for" instead of a number nobody trusts.

## 0.7.0 — 2026-11-14

The first mechanism aimed at "covering the symptom" instead of "fixing the cause".

### Added

- **Red → green evidence.** A verification run now records *which tests failed*
  (`lib/test-names.js` parses `node --test` TAP/spec output, `pytest` `FAILED` lines, and
  `go test` `--- FAIL:` lines; unknown formats yield nothing rather than a guess).
- `lib/fix-evidence.js` derives three states from the ledger:
  `no-baseline` (never saw a failing run), `red` (baseline still failing), `green`
  (a later clean pass after the baseline).
- `/work-guard/status` carries `fixEvidence`, and the status line shows `N 条红测试未转绿`
  or `红→绿` — visible without asking the agent.
- The default prompt gained a seventh habit: **if a fix had failing tests, the same tests must turn
  green; covering the symptom elsewhere cannot do that.**

### Why this is the right proxy

Adding code in a different place can make a symptom disappear; it cannot make a specific assertion
go from red to green. The test name is concrete and checkable, so "did the problem actually get
fixed" becomes as mechanical as "was the file read".

## 0.6.1 — 2026-11-14

Found by running a deliberately failing `npm test` through the guard.

### Fixed

- **A piped or chained command could record a failed verification as a success.** In
  `npm test 2>&1 | Select-Object -Last 4; "EXIT=$LASTEXITCODE"` the shell's exit code belongs to the
  last statement, so `ok: true` was written for a run that actually failed.
  `ambiguousShell()` now detects `|`, `;`, `&&`, `||` and newlines; such commands are recorded with
  `ok: null, source: "ambiguous-shell"` — never as success.
- A verification command whose result cannot be interpreted is now reported as `ok: null,
  source: "unknown"` instead of being dropped.

### Verified live

- clean `npm test` (failing suite) → `{"ok":false,"source":"exit-code","exitCode":1}`
- clean `npm test` (passing suite) → `{"ok":true,"source":"exit-code","exitCode":0}`

## 0.6.0 — 2026-11-14

Step 4: "verification" now means *the command succeeded*, not *the command looked like a test*.

### Added

- `lib/verify-result.js`: `looksLikeVerify`, `exitCodeOf`, `verifyOutcome`. Verification is recorded
  from `tools/post-execute`, where the real `isError` and `value.exitCode` live.
- Ledger rows of kind `verify` now carry `ok` (`true` / `false` / `null`), `exitCode`, and
  `source` (`exit-code` / `is-error` / `unknown`).
- `computeStats` counts only successful verifications; a failed run no longer clears the
  "unverified" count, and `verifiesFailed` / `verifiesUnknown` are reported separately.

### Changed

- A verification command whose result cannot be interpreted is recorded as `ok: null` — it never
  counts as success.
- Legacy rows without `ok` are still treated as successful (that is how 0.5.x recorded them), so
  history does not suddenly turn red.

### Known limit

- Whether `tools/post-execute` fires for shell tools is being verified on the live host; if it does
  not, verification will show 0 and needs a different hook.

## 0.5.0 — 2026-11-14

Step 3: rules can be language-scoped, so a Kotlin rule no longer runs inside a TypeScript repo.

### Added

- `lib/detect.js`: `detectProjectKind(rootDir)` recognises `kotlin` / `ts` / `rust` / `go` /
  `flutter` / `python` from project markers (`settings.gradle.kts`, `package.json`, `Cargo.toml`,
  `go.mod`, `pubspec.yaml`, `pyproject.toml`), falling back to the first source file's extension
  when a directory has no marker.
- Rules may declare `languages: ['kotlin']`. `runRules` skips a rule whose languages do not
  intersect the current file's languages (file extension + project kind).
- `/work-guard/status` reports each rule together with its `languages` field, so it is visible
  *why* a rule did not fire.

### Changed

- `no-unkeyed-derived-state` is now scoped to `kotlin`. It was Kotlin/Compose specific all along;
  running it inside every project was both wasted work and misleading.
- The three read rules stay language-agnostic (they only care about files, not syntax).

## 0.4.2 — 2026-11-14

Second attempt at the future-mtime case; 0.4.1 was not enough.

### Fixed

- **Files with an mtime in the future are now exempt from `read-freshness`.** 0.4.1 clamped such an
  mtime to `now`, which still denied the edit as soon as a few seconds passed between the read and
  the write. A timestamp ahead of the clock cannot be an event that happened after the read, so the
  rule now returns "no violation" for it.
- The regression test now also moves the read timestamp 30 seconds back, so the "clamp" approach
  would fail it — the test pins the behaviour, not the implementation.

## 0.4.1 — 2026-11-14

Found by running the 0.4.0 rules against real files instead of unit fixtures.

### Fixed

- **`read-freshness` locked files whose mtime lies in the future** (clock drift, network shares,
  `touch -d`). `readAt < mtime` is always true for such a file, so it could never be edited again —
  even after re-reading. The check now clamps `mtime` to *now* before comparing, keeping the
  2-second skew tolerance.
- Regression tests: a future-mtime case (must be allowed), and a corrected "modified after read"
  case that moves the read timestamp back instead of faking a future mtime.

## 0.4.0 — 2026-11-14

Step 2 of the deepen plan: close the two holes the clean-machine review found in the gate.

### Added

- **`read-freshness` rule.** If the file's mtime is newer than your last read (by more than the
  2-second filesystem skew tolerance), the write is denied: reading stale content and patching from
  memory is how edits land in the wrong place.
- **`read-depth` rule.** `read` now records the line ranges it covered (`offset` / `limit`). An
  `edit` is denied when the changed lines fall outside those ranges, and a wholesale `write` over an
  existing file requires a full read. Reading the first ten lines no longer authorises editing line
  five hundred.
- `lib/read-coverage.js` (`rangeFromReadArgs`, `mergeRange`, `lineSpanOf`, `covers`,
  `coversWholeFile`) with 5 integration tests in `test/gate.depth.test.mjs`.
- Ranges are persisted in `work-guard-state.json` (v2), so a restart does not degrade a full read
  into "partial".

### Changed

- `state.json` is now `version: 2` and carries a `meta` section; v1 files still load
  (`reads` only), and their files are treated as "read but range unknown" — which asks for a
  re-read before editing.
- Both new rules are on by default and can be disabled with `rules.read-freshness: false` /
  `rules.read-depth: false`.

## 0.3.1 — 2026-11-14

Make the numbers trustworthy (step 1 of the "deepen" plan).

### Changed

- **Status metrics are scoped to the current plugin start.** `edits` / `verifies` / `unverified` /
  `bypass` / `denies` now count only rows written since this process started, so a number no longer
  mixes today's work with history — including the false bypasses produced before the 0.2.x fixes.
- `todayStats` carries the same five counters for the whole local day (crossing restarts).
- `lifetime.rows` keeps the ledger size visible.
- The status line now reads `本次 · N 改 …`, and its hover title spells both scopes out:
  `本次启动以来：…` / `今天全量：…`.

### Added

- `lib/stats.js` with `computeStats(rows, { getTime, sinceTs, today })` and 7 tests.
- `denies` counter (writes the gate actually refused).

## 0.3.0 — 2026-11-14

Second review pass, this time from a **clean machine** (fresh profile, DSH 0.2.2-rc.3, Windows 11).
15 findings; the four blockers and five high-priority ones are fixed here.

### Breaking / behaviour

- **Read tracking no longer uses a 3-segment tail match.** `proj-a/app/src/main.ts` and
  `proj-b/app/src/main.ts` used to unlock each other, which let an *unread* write through — the one
  hard promise of this plugin. `READ_TAILS` is gone; only absolute normalised keys are compared.
- **`normPath` folds case per platform** (Windows/macOS yes, Linux no). It also resolves `..` on the
  way in, so `src/../App.ts` and `App.ts` are one file.
- **`TOUCHED_DIRS` recorded one directory too high**; now uses `dirname(target)` directly.
- **Bypass entries store absolute paths**, so the 60-second de-duplication actually matches.
  `/work-guard/status` still returns file names only, no commands.

### Fixed

- **`verifyPattern` missed `npm.cmd`** (the only npm form that works under the default PowerShell
  execution policy), plus `pnpm.cmd`, `yarn`, `bun`, `mvn`, `flutter`. Also `echo npm test` no
  longer counts as a verification.
- **First-run false bypasses**: files older than the plugin's start time are not reported.
- **Ledger rotation** now also runs while appending (every 200 rows), not only at startup.
- **Broken config** reports `configSource: "broken"` instead of pretending to be `"default"`.
- **`engines.dsh` upper bound widened** from `<0.2.3-0` to `<0.4.0-0`, so the next DSH release does
  not lock every user out.
- **Privacy**: the repository no longer contains the author's project names, package ids or drive
  paths.
- **Docs tell the truth**: `npm test` (not `node --test test/`, which fails on Node 24), install by
  `plugin_manager` (the "CLI" form needs `pnpm` on PATH and fails on Desktop), data lives in
  `~/.dsh/data` when the Desktop host does not set `DSH_PROFILE_DIR`, first install applies without
  a restart (only re-installing the same bundle needs one).

### Added

- `locale/en.json` + `locale/zh.json` (title / description / detail for the plugin list).
- `.gitignore`.
- CI now runs Node 22 and 24 on both Ubuntu and Windows.
- New tests: `ledger` (5) and `scan` (5) — the two modules that had zero coverage.
- README states the honest scope: Windows-only validation, Web/Desktop-only activation, the status
  route's lack of authentication, and that "read" means "opened", not "understood".

## 0.2.1 — 2026-11-14

Review pass: three defects found by reading the code after 0.2.0 was written.

### Fixed

- **Creating a file with a relative path was denied.** `isNew` required an absolute path, so a new
  `.kt` / `.ts` given relatively looked "already existing but unread". Now candidate resolution uses
  the directories of paths already seen, and falls back to *deny* when no root is known —
  fail-closed, so the first relative write cannot slip past the gate.
- **Cross-form read tracking.** A file read as an absolute path and then edited with a relative
  path (or the reverse) no longer needs a third-segment tail match.
- **Denials and bypasses were silent.** A denial only reached the ledger, so the UI looked idle.
  The host now keeps `lastEvent` (deny / bypass) and exposes it in `/work-guard/status`; the status
  bar shows a five-second notice — `闸门拦下：<rule> · <file>` or `脚本改了 N 个文件（未走工具）`.

## 0.2.0 — 2026-11-14

Portability release: **clone on another machine and it runs without editing code.**

### Added

- `lib/time.js` — local-date ledger fields plus `ts` (milliseconds); old rows without `ts` are read
  as UTC, which is what the previous version wrote.
- `lib/paths.js` — `keyOf`, `projectRootOf` (nearest project marker instead of `.git` only),
  `relativeTo`.
- `lib/config.js` — optional JSON config with env overrides.
- `lib/state.js` — read-set persistence (24h TTL, atomic write).
- `lib/ledger.js` — append / tail / rotation / `note` rows.
- `lib/scan.js` — bypass scanning extracted from `index.js`.
- `lib/rules/` — rule registry. A rule is a file: `{ id, stage, applies, check }`.
- `work_ledger` tool gained `note`.
- Status bar under the composer, fed by `GET /work-guard/status`.

## 0.1.0 — 2026-11-14

First working version: prompt section (six habits), read-before-write gate, ledger for
write/edit/verify, shell bypass detection, `work_ledger` tool.
