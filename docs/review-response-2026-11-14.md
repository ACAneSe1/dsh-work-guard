# 对「换机实测问题清单」的逐条回复（0.3.0）

> 被审版本：0.2.1　处理版本：0.3.0
> 原则：能修的修，修不了的写清"为什么现在不修"，不用文档掩盖。

## P0（阻断）

| 编号 | 结论 | 怎么改的 / 为什么没改 |
|---|---|---|
| P0-1 私人项目名随包发布 | ✅ 已修 | 全仓库文本替换：`Memore/memorandum/ztmy/Vibe Coding` → `proj-a`/`com.example.app`/`/work`。复核：`grep -i "memore\|memorandum\|ztmy\|vibe coding"` = **0**。同时把 `docs/` 从 `files` 移出（设计稿不进包） |
| P0-2 `engines.dsh` 上限过窄 | ✅ 已修 | `>=0.2.2-rc.1 <0.2.3-0` → `>=0.2.2-rc.1 <0.4.0-0`。**未做**：rc.1 上的冒烟（手上只有 rc.3 与更早的 rc.1 环境，未实测），风险写在 README |
| P0-3 文档三处错误 | ✅ 已修 | 测试命令改 `npm test`；重启段改成"首次不需要，重装同一个 bundle 才需要"；安装方式 B 改成 `dsh plugin --profile … add` 并注明 Desktop 没有 pnpm；数据位置改成 `~/.dsh/data`（Desktop 不设 `DSH_PROFILE_DIR`） |
| P0-4 两个同构项目互相解锁 | ✅ 已修 | 删掉 `READ_TAILS`；`recordRead` 与 `gate` 只用绝对 key（`keyOf` 会 resolve `..`）。`test/gate.test.mjs` 里那条"尾部相同"的断言已替换成"keyOf 相同 / 不同"。新增 1 条回归测试（`test/scan.test.mjs` 与 `gate.*` 覆盖） |

## P1（建议同批）

| 编号 | 结论 | 说明 |
|---|---|---|
| P1-1 缺 locale | ✅ 已修 | 新增 `locale/zh.json`、`locale/en.json`（`meta.title/description/detail`），并加进 `files` |
| P1-2 数据落在 `~/.dsh/data` | ✅ 文档已改 | 代码仍用 `DSH_PROFILE_DIR ?? homedir/.dsh/data`（Desktop 不设变量 → `~/.dsh/data`）。**未做**：改用宿主 profile API（需要确认 headless 与 Desktop 两条入口的一致语义），已在 README 写明多 profile 会共用 |
| P1-3 verify 正则漏 `npm.cmd` | ✅ 已修 | 正则补 `npm.cmd / pnpm.cmd / yarn / bun / mvn / flutter`；另加"`echo` 开头不算验证" |
| P1-4 status 无鉴权 + 回传绝对路径 | ✅ 部分修 | `recent[]` 只回**文件名**、去掉 `cmd`。**未做**：鉴权（本机回环，桌面场景低危；接入宿主鉴权需要查中间件契约），已在 README 明确写"没有鉴权" |
| P1-5 README 声称测过未测的 | ✅ 已修 | 新增 `test/ledger.test.mjs`（5 条：append/tail/轮转/空路径/路径读取）与 `test/scan.test.mjs`（5 条：命中/去重/已记账不报/floor/后缀过滤）。总数 **54**，两份 README 已同步 |

## P2（工程细节）

| 编号 | 结论 |
|---|---|
| P2-1 `TOUCHED_DIRS` 少一层 | ✅ 改成 `dirname(target)` |
| P2-2 `normPath` 不 resolve `..` | ✅ 判定改用 `keyOf`（`resolve`）；`normPath` 仍给显示/去重用 |
| P2-3 "对项目没意见"自相矛盾 | ✅ README 改成"内置一条 Kotlin/Compose 示例规则，可在 config 里关掉" |
| P2-4 只有中文 | ⏸ 未做（UI 文案与默认提示仍中文）。取舍：默认提示是**立场**，英文版要重写而不是翻译；留给 0.4 |
| P2-5 性能（全量读台账 / 全树扫描） | ⏸ 未做，已在 Known limits 写明。轮转现在每 200 条检查一次，能压住长会话 |
| P2-6 首轮 bypass 误报 | ✅ 已修 | `PLUGIN_START` 作为 floor：早于插件启动的文件不算本次绕过；另把 bypass 改成存绝对路径（去重才真的生效） |
| P2-7 大小写折叠 | ✅ 已修 | 按 `process.platform` 决定是否 lower（Windows/macOS 折叠，Linux 不折叠） |
| P2-8 仓库卫生 | ✅ 已修 | 加 `.gitignore`；`docs/` 移出打包；docs 里过期行号问题保留（设计稿，不随包发布） |
| P2-9 `package.json` 缺字段 | ⚠️ 部分 | 加了 `engines.node: ">=20"` 与关键词；`repository/homepage/bugs/author` **没填**——还没建仓库，URL 不能编 |
| P2-10 CI 矩阵 | ✅ 已修 | Ubuntu + Windows × Node 22/24 |
| P2-11 `webServer` 硬依赖 | ✅ 文档已写 | 代码不变（没有 webServer 就没有状态条，注册路由会抛）；README 明确"仅 Web/Desktop" |
| P2-12 INSTALL 重启段 | ✅ 已修（同 P0-3b） |
| P2-13 README 数字矛盾 | ✅ 已修，统一 54 |
| P2-14 坏配置静默 | ✅ 已修 | `configSource: "broken"` 与 `"default"` 分开 |
| P2-15 轮转只在启动检查 | ✅ 已修 | append 每 200 条检查一次 |

## 复核方式（你可以自己验）

```bash
# 隐私
grep -ri "memore\|memorandum\|ztmy\|vibe coding" .     # 期望无输出

# 测试
npm test                                               # 期望 54 pass

# 包内不含设计稿、含 locale
npm pack --dry-run

# 判定不再靠尾部
grep -n "READ_TAILS" index.js lib/*.js                 # 期望无输出
```

## 仍然没验证到的（诚实范围）

1. **Linux / macOS 实跑**：代码按平台折叠大小写，但没跑过。
2. **rc.1 上的安装**：只在本机 rc.3 与测试机上 rc.3 跑过。
3. **P1-4 的鉴权**：没接宿主中间件。
4. **状态条画面**：只能证明插槽注册成功，绿点需要人眼确认。
5. **多 profile 共存**：`~/.dsh/data` 共用是推断，没开第二个 profile 验证。
