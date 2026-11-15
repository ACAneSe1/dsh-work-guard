# 上架插件市场：要提交的那个文件（2026-11-15）

## 市场为什么搜不到

市场里的列表**不是从 GitHub 搜出来的**，它来自精选目录
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
`data/plugins/*.yml` → 生成 README → 打包成 `dsh-plugin-catalog` 索引 → 市场读取。

**所以仓库建好、代码推上去，都不等于上架。** 需要往那个目录提一个 PR。

## 提交内容（已按官方格式写好）

文件名：`data/plugins/ACAneSe1__dsh-work-guard.yml`

```yaml
url: https://github.com/ACAneSe1/dsh-work-guard
name: ACAneSe1/dsh-work-guard
category: workflow
description:
  en: Gates and a ledger for coding agents: denies writes to source files not read in this session, records every write and verification with its real exit code, requires previously red tests to go green, and flags source files changed by shell commands without a declaration.
  zh: 给编程 agent 的闸门与台账：没读过的源码文件拒绝写入；每次写入与验证都记下真实退出码；之前红的测试必须变绿；脚本改了源码却没申报会一直显示在台账里。
# 可选：图标必须 GitHub 托管的位图（png/jpg/webp）；我们现在只有 SVG，先不写，会回退到作者头像
```

## 三条前置条件（自查）

| 条件 | 我们 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ 有（`dsh.bundle.patch` → `cordis.patch.yml`） |
| 仓库有真代码、非占位 | ✅ 70 个文件、163 条测试 |
| 仓库**创建满 1 天** | ⚠️ 今天才建 → CI 会先报「0.x 天」，过一天自动达标 |
| 仓库带 `dsh-plugin` topic | ❌ 还没有，需要你在仓库设置里加 |
| 描述属实、无营销词 | ✅ 上面这段只写机制 |

## 要做的事

1. **加 topic**：仓库首页右侧 ⚙️ → Topics → 填 `dsh-plugin` → Save
2. **Fork** `awesome-dsh-plugin/awesome-dsh-plugin`
3. 在 fork 里新建 `data/plugins/ACAneSe1__dsh-work-guard.yml`，内容用上面那段
4. 提 PR，标题例如 `Add ACAneSe1/dsh-work-guard`
5. 如果 CI 报仓库太新，等满一天后在同一个 PR 里推空提交或留言，gate 会自动重跑

## 我为什么不能替你提

- 没有 GitHub API token，也不能用 `gh`（没装）
- 跨仓库 PR 必须来自 fork，而 fork 需要账号操作
- 我可以用 GCM 里已存的凭据**推送到你自己的仓库**（刚才就是这么 push 的），但不能替你在别人的仓库里开 PR

**能自动化的部分我已经做了**：`package.json` 补了 `repository` / `homepage` / `bugs` 三个字段，
以后发 npm 包时能和这个仓库正确关联。
