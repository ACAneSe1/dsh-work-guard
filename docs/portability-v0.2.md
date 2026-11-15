# dsh-work-guard · 通用化 v0.2 设计

> 目标只有一个：**换一台电脑、clone 下来、装上去就能用**——不改一行代码。
>
> 本文先评审现状（带行号），再给目标结构与迁移步骤。所有条目都可验收。

---

## 1. 验收标准（先定，免得做成自嗨）

| # | 场景 | 必须成立 |
|---|---|---|
| A | 在另一台 Windows 机器上 clone + 装 | 无需改代码，闸门与台账都工作 |
| B | 工作区不在仓库根（如 `repo/app/...`） | 台账路径相对该文件自己的项目根，不出现"上层仓库名"前缀 |
| C | 两个不同项目里有同名文件（`src/index.ts`） | 互不干扰，读一个不放出另一个 |
| D | 本地时间 00:30 | 面板 `today` 与系统日期一致（不是前一天） |
| E | 重启后改同一个文件 | 不必重新读（24h 内已读记录有效） |
| F | 想加一条规则 | 新增 ≤20 行，不改 `gate()` |
| G | 退出/崩溃后回来 | 未验证改动数（`unverified`）仍正确 |

---

## 2. 现状评审（`index.js`，456 行）

### 2.1 已经对的

| 位置 | 做法 | 评价 |
|---|---|---|
| L292-298 | `ctx.webServer.register` 显式依赖 | 对了；之前用 `ctx.get` 静默 404 已修 |
| L301-331 | 采集与判定都在 `pre-execute` | 结构可以，但一个 listener 干了三件事，该拆 |
| L360-375 | 台账读取时对 bypass 去重 | 补丁式，但有效 |
| L261-263 | 判断前剥反引号文档片段 | 这条是踩过坑才有的，保留 |

### 2.2 阻碍"换电脑"的（按影响排序）

**① 仓库根靠 `.git` 向上找（L146-156）**

```js
function repoRootOf(dir) { … 向上找 .git … }
```

在 `/work/outer/proj-a/...` 上，`.git` 可能只在 `/work`（外层仓库），于是台账里出现 `outer/proj-a/...`。
**换一台机器、换一层目录，路径就变。** 而且 `scanBypassWrites` 用 `roots.values().next().value`（L211）只取第一个根，多项目下会错。

**② 路径比较靠"尾部 3 段"（L42-46, L86, L207, L214-215, L365-372）**

```js
pathTail(n, segments = 3)
```

两个项目都有 `src/main/index.ts` → 尾部相同 → **认成同一个文件**：读了一个就放出另一个，台账也去重错。

**③ 日期是 UTC（L104-107, L125）**

```js
new Date().toISOString().slice(0, 10)   // UTC 的"今天"
```

UTC+8 的凌晨 0:00–8:00，`today` 还是前一天 → **面板数字会跳**（D 不成立）。

**④ 绝对路径 vs 相对路径没有统一解析（L82-91）**

```js
const absolute = /^(?:[a-zA-Z]:[\\/]|\/)/u.test(fileAbs)
if (!absolute) return false        // 相对路径一律要求先读过
```

这条是为了堵"相对路径被当成新文件"（当时的真 bug），但代价是**相对路径下无法判断"这是新建文件"**——今天我就被它挡了一次（新建 `.kt` 时被拒）。需要真正的解析：绝对化后再判断。

**⑤ 扫描依赖"先有一次工具写入"（L163-164）**

```js
if (TOUCHED_DIRS.size === 0) return
```

重启后第一次 `pwsh` 绕过检测不到。应该从**命令自带 cwd** + **已配置的工作区**推根。

**⑥ 零配置（L20-21, L238-250, L281）**

台账位置、提示文本、源码后缀、验证命令正则全部写死在代码里；提示只能靠环境变量覆盖。

### 2.3 阻碍"给别人用"的

| 缺陷 | 位置 | 后果 |
|---|---|---|
| 规则不可扩展 | `gate()` 内部硬编码两条规则（L389+） | 别人想加规则只能 fork |
| 读集合只在内存 | L30-31 | 重启即忘（E 不成立） |
| 台账无轮转 | L109-121 全量读 | 永久增长，越大越慢 |
| 无 `reason`/`delta` | L218-223, L337-338 | 无法回答"为什么改" |
| 提示文本不可配置 | L238-250 | 非中文用户无法用 |
| 无 README 的"为什么" | README 已有英文版，需补"立场"说明 | 发布价值点缺失 |

---

## 3. 目标结构

```
dsh-work-guard/
├── index.js            入口：读配置 → 装配（提示 / 路由 / 监听 / 工具）
├── lib/
│   ├── config.js       配置加载（文件 + 环境变量覆盖）
│   ├── paths.js        绝对化、项目根探测、相对展示
│   ├── time.js         本地日期/时间（取代 UTC）
│   ├── ledger.js       追加、尾部读、轮转、schema 版本
│   ├── state.js        已读集合持久化（24h TTL）
│   ├── rules/          规则注册表
│   │   ├── index.js    registerRule / runRules
│   │   ├── read-before-write.js
│   │   ├── no-unkeyed-derived-state.js
│   │   └── …
│   └── scan.js         shell 绕过扫描（用 roots，不再用 .git）
├── client.js           状态条（已完成）
└── test/               单测 + 端到端（mock 宿主）
```

**一个原则**：`index.js` 只做装配，判断全在 `lib/rules/`，IO 全在 `lib/{ledger,state,scan}.js`。

---

## 4. 六个改动的具体设计

### 4.1 配置（对应验收 A）

**用文件，不用 Schemastery**——零依赖、可手改、换机器只拷贝一份：

```
<profile>/data/work-guard.config.json
```

```json
{
  "version": 1,
  "prompt": "…（默认就是现在这六条）",
  "sourceExtensions": [".kt", ".ts", "…"],
  "verifyPattern": "gradlew|npm test|…",
  "ledger": { "path": "…/work-ledger.jsonl", "rotateAtRows": 5000 },
  "state": { "readTtlHours": 24 },
  "projectMarkers": ["package.json", "settings.gradle", "settings.gradle.kts", "pyproject.toml", "go.mod", ".git"],
  "rules": { "read-before-write": true, "no-unkeyed-derived-state": true }
}
```

优先级：**环境变量 > 配置文件 > 内置默认**。配置缺失/损坏 → 用默认并在日志里报一次。

### 4.2 项目根按文件算（对应 B）

```js
function projectRootOf(absPath) {
  // 从文件所在目录向上找最近的 projectMarkers 之一；找不到就用文件所在目录
  // 结果缓存（Map<dir, root>），一次进程内不重复 stat
}
```

**不再有全局 root**。台账写：`{ file: "src/...", root: "/abs/root" }`——**相对路径用于显示，root 用于精确比较**。

### 4.3 路径比较用绝对路径（对应 C）

```js
function keyOf(absPath) { return normPath(resolve(absPath)) }   // 只用它做比较
```

- 比较、去重、已读判定**一律用 `keyOf`**
- 显示才用相对路径
- **删掉 `pathTail` 在判定中的所有使用**（保留给显示层）

### 4.4 本地时区（对应 D）

```js
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
```

台账存 `ts`（毫秒）为主键，`day`/`t` 只作显示与筛选的派生字段——**排序、统计都基于 `ts`**，彻底摆脱时区歧义。

### 4.5 已读集合持久化（对应 E）

```
<profile>/data/work-guard-state.json
{ "version": 1, "reads": { "<keyOf>": 1794656070764 } }
```

- 命中条件：`now - ts <= readTtlHours*3600e3`
- 写入时机：`read` 工具调用后（节流：最多每 5 秒落盘一次）
- 上限：5000 条，超出按最旧淘汰

### 4.6 规则注册表（对应 F）

```js
// lib/rules/read-before-write.js
export default {
  id: 'read-before-write',
  stage: 'pre-write',
  applies: ({ path }) => isSourcePath(path),
  check({ key, readBefore }) {
    return readBefore(key) ? null : { deny: 'read-before-write', reason: '…' }
  },
}
```

`gate()` 变成：

```js
async function gate(exec) {
  const ctx = buildRuleContext(exec)          // 路径、已读、内容
  for (const rule of enabledRules('pre-write')) {
    if (!rule.applies(ctx)) continue
    const hit = await rule.check(ctx)
    if (hit) return toDecision(hit)
  }
  ledgerAppend(editEntry(ctx))
}
```

**加规则 = 加一个文件 + 配置里打开。** 不改 `gate()`。

### 4.7 台账演进（对应 G 与"为什么"）

新 schema（`v:2`）：

```json
{"v":2,"ts":1794656070764,"kind":"edit","file":"src/a.ts","root":"/abs/root",
 "lines":12,"delta":"+9/-3","note":"修 zone 读取分支","verify":{"cmd":"…","ok":true}}
```

- `v:1` 老记录照读（无 `ts` 时用 `day+t` 推）
- 轮转到 `work-ledger.1.jsonl`（超过 `rotateAtRows`）
- `work_ledger` 工具加 `note` 参数：我改完就写一句"为什么"

---

## 5. 迁移步骤（每批独立可验证）

| 批 | 内容 | 验证方式 |
|---|---|---|
| **1** | `lib/time.js` + `lib/paths.js`（本地日、keyOf、projectRootOf） | 新增 6 条单测；台账路径不带备忘录前缀 |
| **2** | `lib/config.js` + `lib/state.js` | 改配置文件后重启，提示文本/后缀生效；重启后不必重读 |
| **3** | `lib/rules/*` + `lib/scan.js` + `lib/ledger.js` 拆分 | 11 条现有测试全绿；新增 3 条规则级测试 |
| **4** | client 状态条改用新字段（`unverified` 基于 `ts`） | 面板数字与 `curl` 一致 |
| **5** | README/CI/LICENSE + `docs/` | `npm test` 在 CI 上跑通 |

**每批结束都要重启一次真机验证**——重启便宜，但接口错了代价大。

---

## 6. 测试计划

| 类型 | 覆盖 | 运行 |
|---|---|---|
| 单元 | `keyOf`、`projectRootOf`、`localDay`、规则 `check` | `node --test test/` |
| 契约 | `gate()` 对 3 条规则的放行/拒绝矩阵 | 同上 |
| 端到端 | mock 一个最小 `ctx`（tools/systemPrompt/webServer），跑 apply 后断言路由与提示注册 | 新文件 `test/host.test.mjs` |
| 手工 | 换目录 clone 到 `D:/tmp/proj`，装上去跑一次 | 发布前一次 |

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 拆文件把插件搞挂（今天已发生两次） | 每批先用 `node -e import()` + 单测，再打包 |
| 改 config 后用户配置失效 | 配置 `version` 字段 + 迁移函数 |
| 台账 schema 变化导致旧记录读不出 | 兼容层：`ts` 缺失时用 `day+t` 推；`v` 缺失视为 1 |
| 新规则误报导致干活被堵 | 规则默认全开，但每条都可在配置里关；拒绝信息必须给"怎么过" |

---

## 8. 非目标（明确不做）

- **不拦 shell 写入**：权限模型决定，只能记录（已验证）
- **不做 AST/编译器级检查**：成本高，treesitter 再说
- **不做多用户/团队共享台账**：个人工具定位
- **不改 DSH 本体**：只挂它暴露的钩子

---

## 9. 发布前检查清单

- [ ] 仓库根换成通用示例（不含 `proj-a` 字样）
- [ ] README 第一章写"为什么"（引用户原话）
- [ ] 截图一张状态条
- [ ] `engines.dsh` 写明
- [ ] LICENSE = MIT
- [ ] CI 跑 `node --test test/`
- [ ] `docs/portability-v0.2.md`（本文）随仓库发布
