# dsh-work-guard

**把 agent 说过的「修好了」，变成能查的证据。**

> 它不是给模型的劝告，是**四个闸门 + 一本账**：没读过的文件写不进去；失败的验证不会被记成通过；
> 之前红的测试没变绿，就不算修完。
> **诚实范围**：只在 Windows + DSH Desktop 上跑过；Linux/macOS 的路径处理**未验证**（见已知限制）。

## 你有没有遇到过这三种

1. **说「修好了」，其实测试根本没跑。**
2. **测试是红的，报告是绿的。**（跑了个空套件；或者失败被记成了成功）
3. **改了不该改的地方。** 文件没读过，凭印象改；或者只看了前 10 行，就去改第 500 行。

这个插件只在三个时刻说话：

| 问题 | 它的回答 |
|---|---|
| 这个文件，你读过吗？ | 没读过 → **拒绝写入** |
| 你说的「验证过」，退出码是多少？ | 拿不到退出码 → 记「未知」，**不算通过** |
| 之前红的那几条，现在绿了吗？ | 没变绿 → 面板红着，并说清是哪几条 |

## 机制（不是建议）

| 机制 | 行为 |
|---|---|
| **先读再写** | 本次会话没读过的源码文件，`write` / `edit` **直接拒绝** |
| **读的新鲜度** | 读完文件后文件又被改（超过 2 秒时钟容差）→ 拒绝 |
| **读的深度** | 改动落在你没读过的行范围 → 拒绝；整份覆盖已存在文件要求整文件读过 |
| **验证要真结果** | `work_verify` 跑项目测试，只回几行；**退出码由它自己拿**，不经管道，不靠猜 |
| **红 → 绿** | 从输出/JUnit XML 里抽出失败的用例名；修完必须让同一批用例变绿 |
| **脚本申报** | shell 写入拦不住，但没申报的脚本改动会一直显出来（`work_declare`） |
| **改动台账** | 每次写入、每次验证（带退出码与失败名）、每次拦截、每次绕过，都记进一个 JSONL |
| **提示段** | 九条工作方式 + 两问自查，通过 `systemPrompt.section` 注入，**每次请求都在** |
| **界面** | 输入栏一个小按钮（点开是待办 + 历史），输入框下一行状态：有事说事，没事只说「没有待办」 |
| **一条代码卫生规则** | 无 key 的 `remember { derivedStateOf { … } }` 永不重算 —— 写入时拒绝（**只在 Kotlin 项目生效**） |

## 为什么会有这个插件

起因是一句原话：

> "找 bug 首先应该 review 代码，而不是猜测问题和用另一堆代码去覆盖问题。"

一天之内，同样的三种失败反复出现：

1. **猜而不读**：凭"看起来像"判断一段代码，然后把用户要的设计删掉了。没有测量，也没有提问。
2. **盖住症状**：bug 在某一行，补丁加在另一处，让症状不再显示。
3. **没验证就宣布修好**：改完就说"修好了"，中间没有任何一次构建。

这三件事都不是"提示词写得更好"能解决的。解法是**把成本挪到写入的那一刻**：
**没读过，就写不进去。**

## 它不做什么

- **拦不住 shell 写入**。`pwsh` / `bash` 不走工具层；能不能写是会话权限的问题，不是插件能补的。
  它只负责**记录**，台账里的 `bypass` 就是这个数字。
- **不判断质量**。它知道文件读没读、构建跑没跑，不知道改动对不对。
- **不写死项目路径**；项目根从实际被编辑的文件反推，且规则可以限定语言。内置的
  `no-unkeyed-derived-state` **只在 Kotlin 项目里运行**；三条与「读」有关的规则所有语言通用。

## 安装

```bash
npm pack                      # 产出 dsh-work-guard-<version>.tgz
# 然后在 harness 里：
#   plugin_manager install_bundle <tgz 的绝对路径>
```

要求 DSH `>=0.2.2-rc.1 <0.4.0-0`。

插件注册：一条 HTTP 路由（`/work-guard/status`）、**三个工具**（`work_verify` / `work_declare` /
`work_ledger`）、一段系统提示、两个客户端插槽（`conversation.input.left` 放按钮、
`conversation.composer.dock` 放状态行）。卸载 bundle 会一并移除。

## 数据

全部在 `<DSH_PROFILE_DIR>/data/` 下；该变量没有时用 `~/.dsh/data/`（Desktop 宿主不设这个变量），
**不写进你的仓库**：

```
work-ledger.jsonl        每次 write/edit/verify/bypass/note 一行
work-guard-state.json    最近 24 小时读过的文件 + 读到第几行（重启后不必重读）
work-guard.config.json   可选配置
```

## 配置

`<profile>/data/work-guard.config.json`，与默认值深合并：

```json
{
  "version": 1,
  "prompt": "……",
  "sourceExtensions": [".ts", ".kt"],
  "verifyPattern": "gradlew|npm test|cargo (build|test)|go test|pytest",
  "ledger": { "path": "", "rotateAtRows": 5000 },
  "state": { "readTtlHours": 24 },
  "projectMarkers": ["package.json", ".git"],
  "rules": {
    "read-before-write": true,
    "read-freshness": true,
    "read-depth": true,
    "no-unkeyed-derived-state": true
  }
}
```

优先级：环境变量（`DSH_WORK_GUARD_PROMPT`、`DSH_WORK_GUARD_LEDGER`）→ 文件 → 默认。
坏文件退回默认；`/work-guard/status` 会报 `configSource`。

## 加一条规则

规则是一个对象，闸门是注册表：

```js
export const id = 'no-platform-in-core'
export const stage = 'pre-write'
export const applies = ctx => ctx.filePath.includes('/core/')
export function check(ctx) {
  return /android\.|process\.platform/u.test(ctx.afterText ?? '')
    ? { deny: id, reason: 'core 不许出现平台符号' }
    : null
}
```

注册一次（`registerRule(rule)`）—— **`gate()` 不用改。**

## 破例

`// work-guard: allow` 可以让某一行跳过 `derivedStateOf` 规则。
先读再写**没有破例**：去读。

## 测试

```bash
npm test                          # 全部用例（162 条，几十秒）
node --test --test-reporter=dot   # 只要结论时用这个：几行点阵
node tools/verify-extra.mjs       # 轮转 / 配置文件 / 并发追加 三项运行验证
```

162 条：路径同一性、项目根探测、本地时间兼容、台账轮转、配置合并、状态 TTL、规则注册表、
闸门的放行/拒绝行为、验证结果三态（通过/失败/未知）、红→绿判定、JUnit XML 解析、
脚本写入目标解析、0 条测试不算绿。

## 已知限制

- 判定键是**绝对化路径**（`keyOf`）：「尾部 3 段」那套宽松匹配已经在 0.3 删掉了，
  因为两个同构项目里的同名文件会互相解锁。相对路径先按已知项目根绝对化，解析不出来就拒绝（fail-closed）。
- 绕过扫描在每次 shell 调用时遍历仓库，上限 200 条、深度 16。
- 改配置需要重启（没有热重载）。
- **只支持 Web / Desktop**：`webServer` 是硬依赖（状态路由挂在它上面），headless 或 SDK profile 里不会激活。
- `/work-guard/status` 没有鉴权，本机任意进程都能读；`recent[]` 只给文件名、不含命令。
- 读会记录覆盖的行范围，改到范围外会被拒；但仍然无法检查「是否读懂」——它验证的是接触面，不是理解。
- **只在 Windows 上验证过**：路径判定、项目根探测、台账轮转都有单测，但没有在 Linux/macOS 上实跑。
- 台账轮转与配置文件不在真实会话里触发路径上，但有可运行的验证脚本（`tools/verify-extra.mjs`，
  会真的建 5000 行台账触发轮转、真的写一份配置并重启进程读回）。

## 许可

MIT
