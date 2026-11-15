/**
 * dsh-work-guard — 工作纪律插件（v0.2 第 3 批：IO 与规则已拆到 lib/）。
 *
 * 三件事，与具体项目无关：
 *   1. 把「先读再改」写进系统提示（每次请求都在，不靠模型主动去读）。
 *   2. 闸门：规则注册表 + 拒绝（只挡工具写入，挡不住 shell —— 见 README）。
 *   3. 台账：write/edit/verify 自动记；shell 绕过闸门改源码会被扫出来记成 bypass。
 *
 * 装配顺序：读配置 → 装台账 → 注册规则 → 装监听 → 注册工具与路由。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { entryTime, localDay } from './lib/time.js'
import { cwdHintsOf, isAbsolutePath, normPath, pathTail, projectRootOf, writeTargetsOf } from './lib/paths.js'
import { DEFAULT_CONFIG, loadConfig, verifyRegex } from './lib/config.js'
import { loadReadMeta, loadReadState, saveReadState } from './lib/state.js'
import { append, configureLedger, ledgerFile, tail } from './lib/ledger.js'
import { computeStats } from './lib/stats.js'
import { looksLikeVerify, verifyOutcome } from './lib/verify-result.js'
import { failingTests, resultText } from './lib/testNames.js'
import { undeclaredChanges } from './lib/declare.js'
import { computeGateActivity } from './lib/gate-activity.js'
import { verdictsOf } from './lib/verdict.js'
import { detectVerifyCommand, readJunitFailures, renderSummary, runCommand, summarizeRun } from './lib/verify-tool.js'
import { describeFixEvidence, fixEvidence } from './lib/fix-evidence.js'
import { detectProjectKind, fileLanguage } from './lib/detect.js'
import { scanBypassWrites } from './lib/scan.js'
import { listRules, registerRule, runRules } from './lib/rules/index.js'
import readBeforeWrite from './lib/rules/read-before-write.js'
import readFreshness from './lib/rules/read-freshness.js'
import readDepth from './lib/rules/read-depth.js'
import { lineSpanOf, mergeRange, rangeFromReadArgs } from './lib/read-coverage.js'
import noUnkeyedDerivedState from './lib/rules/no-unkeyed-derived-state.js'

export const name = 'dsh-work-guard'
export const inject = ['tools', 'systemPrompt', 'webServer']

/** 数据目录：profile 的 data/ 下，不写进用户仓库。 */
const DATA_DIR = process.env.DSH_PROFILE_DIR ? join(process.env.DSH_PROFILE_DIR, 'data') : join(homedir(), '.dsh', 'data')

/** 配置装配出来的运行期状态；模块加载期先用默认值，保证直接调 gate() 的测试也能跑。 */
let SOURCE_EXT = new Set(DEFAULT_CONFIG.sourceExtensions.map(ext => String(ext).toLowerCase()))
let VERIFY_RE = verifyRegex(DEFAULT_CONFIG)
let PROMPT_SECTION = DEFAULT_CONFIG.prompt
let CONFIG_SOURCE = 'default'
let READ_TTL_HOURS = 24
let PROJECT_MARKERS = DEFAULT_CONFIG.projectMarkers
/** 规则开关（配置里的 rules 字段）；缺省视为全开。 */
let RULES_CONFIG = DEFAULT_CONFIG.rules ?? {}

/** 本进程内读过的文件（归一化路径 + 尾部三段索引 + 时间）。 */
const READ_FILES = new Set()
const READ_TIMES = new Map()
/** 每个文件最近一次读取覆盖的行范围（第 2 步，read-depth 规则用）。 */
const READ_META = new Map()

/** 被工具写过的目录：用来推项目根，而不是写死路径。 */
const TOUCHED_DIRS = new Set()

/** 插件启动时间：早于它的文件不算「本次绕过」（复审 P2-6）。 */
const PLUGIN_START = Date.now()

let saveTimer
function scheduleSaveState() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    saveReadState(DATA_DIR, READ_TIMES, READ_META)
  }, 5000)
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

function isSourcePath(p) {
  const lower = String(p).toLowerCase()
  for (const ext of SOURCE_EXT) {
    if (lower.endsWith(ext)) return true
  }
  return false
}

function projectRootFor(dir) {
  return projectRootOf(dir, { cwd: dir, markers: PROJECT_MARKERS }) ?? dir
}

/**
 * 闸门是否真的在工作（2026-11-14 修 B3，第二版）。
 *
 * 第一版用 `ctx.tools.definitions()` 探测，**误报为 false**：不传 scope 时它只返回全局注册，
 * 而 write/edit 是按 agent scope 注册的，于是"明明有工具"被判定成"没有"。
 * 现在改成**按证据判断**，不猜注册表：
 *
 *   - 本会话出现过 write/edit 调用 → true（闸门确实在链路上）
 *   - 从没出现过，但脚本已经改过源码 → false（闸门空转，只剩提示词与台账）
 *   - 两者都没有 → null（无法判断，界面不要显示任何结论）
 *
 * @returns {boolean|null}
 */
function gateActivity() {
  return computeGateActivity({
    gateCalls: GATE_CALLS,
    shellSourceWrites: SHELL_SOURCE_WRITES,
    hasWriteTools: detectWriteTools(),
  })
}

/**
 * 按 **agent scope** 查一次 write/edit 是否存在（2026-11-14 修 B3 第三版）。
 * 不传 scope 只能看到全局注册，而这两个工具是按 scope 注册的。
 * @returns {boolean|null} 查得到 true/false，查不到 null
 */
function detectWriteTools() {
  try {
    const tools = TOOLS_REF
    if (tools === undefined || typeof tools.definitions !== 'function') return null
    // 2026-11-14 实测：没有 agent scope 时调 definitions(undefined) 只返回**全局**注册，
    // 看不到按 scope 注册的 write/edit，于是刚启动就误判成"没有工具"。
    // 没有 scope 就明确"不知道"，不要下结论。
    if (LAST_AGENT === null) return null
    const names = new Set(tools.definitions(LAST_AGENT).map(definition => definition?.name))
    if (names.size === 0) return null
    return names.has('write') && names.has('edit')
  } catch {
    return null
  }
}

/** 最近一次工具调用所属的 agent（用于 scope 查询）。 */
let LAST_AGENT = null
/** 工具注册表引用。 */
let TOOLS_REF

/** 本会话 Write/Edit 进入闸门的次数。 */
let GATE_CALLS = 0
/** 本会话里脚本改过源码的次数（扫描命中）。 */
let SHELL_SOURCE_WRITES = 0

/**
 * 已知的项目根候选（来自所有见过的绝对路径的父目录）。
 *
 * 作用：工具常传相对路径（`app/...`），而宿主进程的 cwd 不是工作区，
 * 于是 `existsSync(相对路径)` 永远 false —— 文件被当成"新建"放行，
 * 或反过来把新建文件挡掉。这里用"见过的绝对目录"去拼候选，两个问题一起解。
 */
const KNOWN_ROOTS = new Set()

function rememberRoot(p) {
  if (!isAbsolutePath(p)) return
  try {
    KNOWN_ROOTS.add(dirname(p))
  } catch {
    // 无父目录的路径（如根目录本身）忽略
  }
}

/** 把可能是相对路径的目标展开成若干候选绝对路径（第一个是原样）。 */
function candidatesOf(filePath) {
  const out = [filePath]
  if (isAbsolutePath(filePath)) return out
  for (const root of KNOWN_ROOTS) {
    out.push(join(root, filePath))
  }
  return out
}

/** 候选里有没有真实存在的文件；返回第一个存在的，否则 undefined。 */
function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // 非法路径跳过
    }
  }
  return undefined
}

/**
 * 绝对化后的判定键。
 * 相对路径无法绝对化（没有工作区根）时退回 `normPath`，但**不参与"是否读过"的宽松匹配**。
 */
function absoluteKeyOf(raw) {
  if (typeof raw !== 'string' || raw === '') return undefined
  const abs = isAbsolutePath(raw) ? raw : firstExisting(candidatesOf(raw))
  return normPath(abs ?? raw)
}

/**
 * 从一次工具调用里采集「读过什么」。
 *
 * 2026-11-14 复审修正（P0-4）：只记绝对 key（`keyOf` 会 resolve `..`），
 * 不再写"尾部 3 段"索引 —— 那个索引让 `projA/app/src/main.ts` 与
 * `projB/app/src/main.ts` 互认，等于放行未读写入（已被换机实测复现）。
 */
function recordRead(exec) {
  const tool = exec?.name
  const args = exec?.arguments ?? {}
  const raw = args.file_path ?? args.path
  if (tool === 'read') {
    rememberRoot(raw)
    const key = absoluteKeyOf(raw)
    if (key !== undefined) {
      READ_FILES.add(key)
      const at = Date.now()
      READ_TIMES.set(key, at)
      // 第 2 步：记下这次读覆盖的行范围（供 read-depth 规则使用）
      const range = rangeFromReadArgs(args)
      const prev = READ_META.get(key)
      READ_META.set(key, { at, ranges: mergeRange(prev?.ranges, range) })
      scheduleSaveState()
    }
    return
  }
  if (tool === 'grep' || tool === 'glob') {
    rememberRoot(raw)
    const key = absoluteKeyOf(raw)
    if (key !== undefined) READ_FILES.add(key)
  }
}

function applyEdit(text, oldStr, newStr) {
  if (typeof oldStr !== 'string' || typeof newStr !== 'string') return undefined
  if (!text.includes(oldStr)) return undefined
  return text.replace(oldStr, newStr)
}

/**
 * 最近一次"值得让人看到"的事件：拒绝 / 发现绕过。
 *
 * 为什么要有：拒绝只写在台账里时，界面上完全安静 —— 用户看到的是"什么都没发生"，
 * 于是会以为插件没在工作（2026-11-14 的反馈：基本类似静默了）。
 * 状态接口把它带出去，界面状态条据此弹一条提示。
 */
let LAST_EVENT = null
/** 最近一次成功的验证时间（第 4 步：只有 ok 的验证才算数）。 */
let LAST_VERIFY_OK = 0
function noteEvent(event) {
  LAST_EVENT = { ...event, ts: Date.now() }
}

/** 状态快照：界面状态条与 /work-guard/status 都用它。 */
function guardStatus() {
  const today = localDay()
  const rows = tail(2000)
  // 统计口径（第 1 步）：since = 本次插件启动以来；today = 当天全量。
  // 之前用"今天全量"当唯一口径，会把历史（含修复前误报）算进当前面板。
  const stats = computeStats(rows, { getTime: entryTime, sinceTs: PLUGIN_START, today })
  // 申报的欠账也必须是"本次启动以来"的口径：否则今天所有的历史 bypass 都会算成当前欠账
  // （2026-11-14 实测：整张台账算出 288 条，全是历史，和面板其他数字自相矛盾）。
  const rowsSinceStart = rows.filter(row => entryTime(row) >= PLUGIN_START)
  return {
    alive: true,
    today,
    sinceTs: PLUGIN_START,
    // 2026-11-14 修 B3：本会话到底有没有 write/edit 工具。
    // 没有的话闸门根本不在链路上（独立测试会话里就是这种局面），
    // 状态条必须能看出"看起来在守、其实没守"。
    gateActive: gateActivity().active,
    gateGateReason: gateActivity().reason,
    // 顶层字段保持"本次启动以来"的语义，面板照旧读它们
    edits: stats.since.edits,
    verifies: stats.since.verifies,
    unverified: stats.since.unverified,
    bypass: stats.since.bypass,
    denies: stats.since.denies,
    todayStats: stats.today,
    lifetime: stats.lifetime,
    readFiles: READ_FILES.size,
    ledgerRows: rows.length,
    rules: listRules().map(rule => ({ id: rule.id, languages: rule.languages ?? null })),
    configSource: CONFIG_SOURCE,
    undeclared: (() => {
      // 口径：本次启动以来的脚本改动（历史欠账不追）。2026-11-14 实测：这里曾用整张台账，
      // 状态条显示 289 条"未申报"，全是历史。
      const result = undeclaredChanges(rowsSinceStart)
      // 标注文件是否还在：删掉之后欠账仍然成立（事实发生过），但不能让人点开是空。
      const items = result.undeclared.slice(0, 10).map(item => ({
        file: item.file,
        exists: (() => {
          try {
            return existsSync(item.file)
          } catch {
            return false
          }
        })(),
      }))
      return {
        count: result.undeclared.length,
        missing: items.filter(item => item.exists === false).length,
        files: items.map(item => item.file),
        items,
        declaredCount: result.declaredCount,
      }
    })(),
    // 把数字翻译成"下一步做什么"（2026-11-14：面板从计数改为待办）
    verdicts: (() => {
      const evidence = fixEvidence(rows)
      const undeclaredInfo = undeclaredChanges(rowsSinceStart)
      return verdictsOf({
        unverified: stats.since.unverified,
        fixEvidence: { state: evidence.state, stillFailing: evidence.stillFailing, baseline: evidence.baseline },
        undeclared: { count: undeclaredInfo.undeclared.length },
        gateActive: gateActivity().active,
        // 最近一次验证是不是"一条测试都没跑到"（P0-1）
        emptyVerifications: (() => {
          const last = [...rowsSinceStart].reverse().find(row => row?.kind === 'verify')
          return last?.zeroTests === true ? 1 : 0
        })(),
      })
    })(),
    fixEvidence: (() => {
      const evidence = fixEvidence(rows)
      return { state: evidence.state, summary: describeFixEvidence(evidence), baseline: evidence.baseline, stillFailing: evidence.stillFailing }
    })(),
    lastEvent: LAST_EVENT,
    recent: rows.slice(-5).map(row => ({
      day: row.day,
      t: row.t,
      kind: row.kind,
      file: row.file ? String(row.file).split(/[\\/]/u).slice(-1)[0] : undefined,
    })),
  }
}

/** 写闸门：跑规则注册表，通过才记账。返回值 undefined = 放行。 */
async function gate(exec) {
  const tool = exec?.name
  const args = exec?.arguments ?? {}
  const filePath = args.file_path ?? args.path
  if (typeof filePath !== 'string' || filePath === '') return undefined

  rememberRoot(filePath)
  const candidates = candidatesOf(filePath)
  const existing = firstExisting(candidates)

  const isSource = isSourcePath(filePath)
  // 新建判定（2026-11-14 修）：相对路径也能判断了，但要"失败即拒绝"。
  // 有已知根时：任一候选存在 → 不是新建；都不存在 → 是新建。
  // 没有已知根时：无法解析相对路径 → 一律按"非新建"处理（要求先读），
  // 否则第一个相对路径写入就能绕过闸门。
  const isNew = existing !== undefined
    ? false
    : (isAbsolutePath(filePath) || KNOWN_ROOTS.size > 0)
  // 已读判定（2026-11-14 复审修正 P0-4）：只比绝对 key，不再用尾部 3 段兜底。
  // 尾部兜底会让两个同构项目互认，放行一次未读写入 —— 那是这个插件唯一的硬承诺。
  const key = normPath(existing ?? (isAbsolutePath(filePath) ? filePath : candidates[candidates.length - 1]))
  const readBefore = key !== undefined && READ_FILES.has(key)

  // 第 2 步：把 mtime、已读范围、改动行跨度交给规则
  let fileMtime
  try {
    fileMtime = existing !== undefined ? statSync(existing).mtimeMs : undefined
  } catch {
    fileMtime = undefined
  }
  const readMeta = key !== undefined ? READ_META.get(key) : undefined

  let afterText
  let editSpan
  if (tool === 'write') {
    afterText = typeof args.content === 'string' ? args.content : undefined
  } else {
    const source = existing ?? candidates[0]
    const before = existing !== undefined && existsSync(source) ? readFileSync(source, 'utf8') : ''
    afterText = applyEdit(before, args.old_string, args.new_string)
    editSpan = lineSpanOf(before, args.old_string)
  }

  // 第 3 步：这个文件属于什么语言的项目 + 它自己是什么语言。
  // 供"只在某种语言里生效"的规则做门。
  const projectRoot = existing !== undefined ? projectRootFor(dirname(existing)) : undefined
  const projectKind = detectProjectKind(projectRoot)
  const languages = new Set([fileLanguage(filePath), projectKind].filter(Boolean))

  const hit = await runRules('pre-write', {
    tool,
    filePath,
    languages,
    resolved: existing,
    isSource,
    isNew,
    readBefore,
    readMeta,
    fileMtime,
    editSpan,
    afterText,
    args,
  }, { isEnabled: id => RULES_CONFIG[id] !== false, languages })
  if (hit) {
    noteEvent({ kind: 'deny', rule: hit.ruleId, file: filePath, reason: hit.reason })
    append({ kind: 'deny', rule: hit.ruleId, file: String(filePath).replace(/\\/g, '/') })
    return { kind: 'deny', reason: hit.reason }
  }

  append({
    kind: tool === 'write' ? 'write' : 'edit',
    file: String(filePath).replace(/\\/g, '/'),
    lines: typeof afterText === 'string' && afterText !== ''
      ? afterText.split(/\r?\n/u).length
      : (typeof args.content === 'string' ? args.content.split(/\r?\n/u).length : null),
  })
  return undefined
}

/**
 * 读一次配置并装配到运行期状态（2026-11-14：从 apply() 抽出，供测试直接调用）。
 * 不碰台账、不注册任何东西，只改 CONFIG_SOURCE / 规则开关等。
 */
export function reloadConfig() {
  const loaded = loadConfig(DATA_DIR)
  CONFIG_SOURCE = loaded.source
  PROMPT_SECTION = loaded.config.prompt
  SOURCE_EXT = new Set((loaded.config.sourceExtensions ?? []).map(ext => String(ext).toLowerCase()))
  VERIFY_RE = verifyRegex(loaded.config)
  READ_TTL_HOURS = Number(loaded.config.state?.readTtlHours ?? 24) || 24
  PROJECT_MARKERS = loaded.config.projectMarkers ?? DEFAULT_CONFIG.projectMarkers
  RULES_CONFIG = loaded.config.rules ?? DEFAULT_CONFIG.rules ?? {}
  return loaded
}

export function apply(ctx) {
  TOOLS_REF = ctx.tools
  // ⓪ 装配配置
  const loaded = reloadConfig()
  configureLedger(
    loaded.config.ledger?.path || join(DATA_DIR, 'work-ledger.jsonl'),
    { rotateAtRows: Number(loaded.config.ledger?.rotateAtRows ?? 5000) },
  )

  // 已读集合持久化
  // 先恢复行覆盖范围，再恢复已读时间（范围决定 read-depth 是否放行）
  for (const [key, meta] of loadReadMeta(DATA_DIR, READ_TTL_HOURS)) {
    const k = normPath(key)
    if (k !== undefined) READ_META.set(k, meta)
  }
  for (const [key, ts] of loadReadState(DATA_DIR, READ_TTL_HOURS)) {
    const n = normPath(key)
    if (n !== undefined) {
      READ_FILES.add(n)
      READ_TIMES.set(n, ts)
      if (!READ_META.has(n)) READ_META.set(n, { at: ts, ranges: [] })
    }
  }

  // ① 提示层
  try {
    ctx.systemPrompt.section({ name: 'work-guard-discipline', order: 40, text: PROMPT_SECTION })
  } catch {
    // 提示注入失败不影响闸门
  }

  // ② 状态接口（显式依赖 webServer：静默跳过会让界面以为"闸门在"，实际 404）
  ctx.webServer.register({
    kind: 'exact',
    path: '/work-guard/status',
    resource: async () => new Response(JSON.stringify(guardStatus()), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
  })

  // ③ 采集 + 扫描 + 闸门
  ctx.on('tools/pre-execute', async (exec, next) => {
    recordRead(exec)
    if (exec?.agent) LAST_AGENT = exec.agent
    const tool = exec?.name
    const args = exec?.arguments ?? {}

    if (tool === 'write' || tool === 'edit') {
      const target = args.file_path ?? args.path
      if (typeof target === 'string' && target !== '') {
        TOUCHED_DIRS.add(dirname(target) || '.')
      }
    }

    // 验证记账与绕过扫描都在 post-execute（第 4 步 / 修 B2）：
    // 那时命令才真的执行完，文件才真的被改过。

    if (tool === 'write' || tool === 'edit') {
      GATE_CALLS += 1
      const decision = await gate(exec)
      if (decision !== undefined) return decision
    }

    return next()
  })

  // ③b 验证记账 + 绕过扫描（第 4 步 / 修 B2）：只有这里能拿到真实结果、文件才真的被改过
  ctx.on('tools/post-execute', async (exec, result, next) => {
    try {
      const tool = exec?.name
      if (tool === 'pwsh' || tool === 'bash') {
        const command = String(exec?.arguments?.command ?? '')

        // 绕过扫描（B2）：命令执行**之后**再看哪些源码被动过。
        // 之前放在 pre-execute，等于在命令跑之前检查，永远只能看到上一次的改动。
        try {
          const roots = new Set([...TOUCHED_DIRS].map(projectRootFor))
          const workdir = typeof exec?.arguments?.workdir === 'string' ? exec.arguments.workdir : undefined
          if (workdir !== undefined && workdir !== '') roots.add(projectRootFor(workdir))
          for (const hint of cwdHintsOf(command)) roots.add(projectRootFor(hint))
          // 2026-11-15 修 P1-2：命令里写着写入目标（Set-Content -Path / > / tee）时，
          // 即使没有 cd，也要把目标所在目录纳入扫描——否则绝对路径写入完全漏报。
          for (const target of writeTargetsOf(command, workdir ?? process.cwd())) {
            const dir = dirname(target)
            if (dir !== '') roots.add(projectRootFor(dir))
          }
          if (roots.size === 0) {
            try {
              roots.add(projectRootFor(process.cwd()))
            } catch {
              // 拿不到 cwd 就维持空范围（宁可漏报，不误报）
            }
          }
          const written = scanBypassWrites({ command, roots, isSourceFile: isSourcePath, floorMs: PLUGIN_START })
          if (written > 0) {
            SHELL_SOURCE_WRITES += written
            noteEvent({ kind: 'bypass', count: written })
          }
        } catch {
          // 扫描失败不影响工具结果
        }

        // 2026-11-14 修 B1：pwsh 的结果里没有 exitCode 字段，退出码在输出文本 `[exit code: N]` 里。
        // 文本只取一次，同时喂给退出码解析与红→绿用例名解析。
        const text = resultText(result)
        const outcome = verifyOutcome({ result, command, verifyRe: VERIFY_RE, text })
        if (outcome !== undefined) {
          // 红→绿证据（第 5 步）：从输出里抽出失败用例名，供 fixEvidence 判定
          const parsed = failingTests(text)
          append({
            kind: 'verify',
            ok: outcome.ok,
            source: outcome.source,
            exitCode: outcome.exitCode,
            failed: parsed.names,
            failedParser: parsed.parser,
            cmd: command.replace(/\s+/gu, ' ').slice(0, 110),
          })
          LAST_VERIFY_OK = outcome.ok ? Date.now() : LAST_VERIFY_OK
        } else if (looksLikeVerify(command, VERIFY_RE)) {
          // 是验证命令，但结果不可判定 —— 记一条 unknown，不冒充成功
          append({
            kind: 'verify',
            ok: null,
            source: 'unknown',
            cmd: command.replace(/\s+/gu, ' ').slice(0, 110),
          })
        }
      }
    } catch {
      // 记账失败绝不影响工具结果
    }
    return next()
  })

  // ④ 台账查询工具
  ctx.tools.register({
    name: 'work_ledger',
    description:
      '查「我改过什么」的台账：每一次 write/edit、每一次构建验证、每一次绕过闸门的脚本写入，都有一条记录。'
      + '当需要回答"这个文件为什么改成这样""上次改完验证了吗""今天动过哪些文件"时用它。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'number', description: '最近多少条，默认 15，最多 200。' },
        file: { type: 'string', description: '只看某个文件（路径片段）。' },
        note: { type: 'string', description: '可选：往台账里记一句备注（用来回答"为什么"）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { report: { type: 'string' }, count: { type: 'integer' } },
        required: ['report'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.report ?? '') }],
    },
    presentCall: () => ({ card: 'generic', title: '改动台账', kind: 'other' }),
    async execute(args) {
      const limit = Math.min(Math.max(Number(args?.limit) || 15, 1), 200)
      const file = typeof args?.file === 'string' && args.file !== '' ? args.file : undefined
      const note = typeof args?.note === 'string' && args.note !== '' ? args.note : undefined
      if (note !== undefined) append({ kind: 'note', note: note.slice(0, 200) })

      let rows = tail(limit * 3, file)
      // 读取时去重：同一文件同一分钟内被不同写入源记了多条时只留最后一条
      rows = rows.filter((row, index) => {
        if (row.kind !== 'bypass') return true
        const key = pathTail(normPath(String(row.file ?? '')) ?? '')
        for (let k = index + 1; k < rows.length; k += 1) {
          const other = rows[k]
          if (other.kind !== 'bypass') continue
          if (pathTail(normPath(String(other.file ?? '')) ?? '') !== key) continue
          if (Math.abs(entryTime(row) - entryTime(other)) <= 60_000) return false
        }
        return true
      }).slice(-limit)

      if (rows.length === 0) return { count: 0, report: '台账还是空的（本次会话没有写入，或插件刚装还没记录）。' }
      const lines = rows.map(row => {
        if (row.kind === 'verify') {
          // 2026-11-15 修 P2-3：把结论也写出来，否则"验证"这一行看不出过没过
          const flag = row.ok === true ? '通过' : (row.ok === false ? '失败' : '未知')
          const zero = row.zeroTests ? '（0 条测试）' : ''
          return `· ${row.day} ${row.t}  验证 ${flag}${zero}  ${row.cmd}`
        }
        if (row.kind === 'bypass') return `· ${row.day} ${row.t}  绕过  ${row.file}  ← 脚本改的，没走工具`
        if (row.kind === 'note') return `· ${row.day} ${row.t}  备注  ${row.note}`
        // 2026-11-15 修 P2-2：申报行之前渲染成 "declare undefined"
        if (row.kind === 'declare') {
          const count = Array.isArray(row.files) ? row.files.length : 0
          const why = row.why ? `：${row.why}` : ''
          return `· ${row.day} ${row.t}  申报 ${count} 个文件${why}`
        }
        const size = row.lines == null ? '' : `  (${row.lines} 行)`
        return `· ${row.day} ${row.t}  ${row.kind}  ${row.file}${size}`
      })
      return { count: rows.length, report: lines.join('\n') }
    },
  })

  // ⑤ 申报工具（第 6 步）：脚本改动的欠账怎么还
  ctx.tools.register({
    name: 'work_declare',
    description:
      '申报「这些源码文件是我用脚本改的」。脚本写入不经过工具，闸门拦不住，只能事后记账；'
      + '没被申报覆盖的脚本改动会一直显示在状态条上。'
      + '跑完批量替换/代码生成这类脚本后，用这个工具把改动的文件列出来，并写明为什么改。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '被脚本改动的文件（绝对路径或项目内相对路径）。',
        },
        why: { type: 'string', description: '为什么用脚本改（例如：批量重命名 37 处）。' },
      },
      required: ['files'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { report: { type: 'string' }, declared: { type: 'integer' }, remaining: { type: 'integer' } },
        required: ['report'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.report ?? '') }],
    },
    presentCall: () => ({ card: 'generic', title: '申报脚本改动', kind: 'other' }),
    async execute(args) {
      const files = Array.isArray(args?.files)
        ? args.files.filter(item => typeof item === 'string' && item !== '').slice(0, 200)
        : []
      if (files.length === 0) return { declared: 0, remaining: 0, report: '没有给文件列表，未申报任何改动。' }
      const why = typeof args?.why === 'string' ? args.why.slice(0, 200) : ''

      // 2026-11-14：申报前先看文件是否存在。路径打错时不该"申报成功"却什么都没覆盖，
      // 那会让人以为已经交代过了。
      const missing = files.filter(file => {
        try {
          return !existsSync(file)
        } catch {
          return true
        }
      })

      append({ kind: 'declare', files, why })
      noteEvent({ kind: 'declare', count: files.length })

      const { undeclared } = undeclaredChanges(tail(2000).filter(row => entryTime(row) >= PLUGIN_START))
      const remaining = undeclared.length
      const missingNote = missing.length > 0
        ? `其中 ${missing.length} 个路径当前不存在（${missing.slice(0, 3).join('、')}）——路径写错的话这次申报不会覆盖任何欠账。`
        : ''
      return {
        declared: files.length,
        remaining,
        report:
          `已申报 ${files.length} 个文件${why ? `（${why}）` : ''}。`
          + (missingNote ? `${missingNote}` : '')
          + (remaining === 0
            ? '当前没有未申报的脚本改动。'
            : `仍有 ${remaining} 个文件是脚本改的、但没申报。`),
      }
    },
  })

  // ⑥ 验证工具（2026-11-14）：跑测试，但只把结论还给模型
  ctx.tools.register({
    name: 'work_verify',
    description:
      '跑这个项目的测试/构建，并把结果压成几行（过没过、哪几条没过、退出码是多少）。'
      + '改完代码、报告完成之前用它，而不是自己敲测试命令把几百行输出搬进上下文。'
      + '结果同时写进台账——它记录的是真实退出码。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: '在哪个目录跑（默认：最近写过的文件所在项目根）。' },
        command: { type: 'string', description: '覆盖自动探测到的命令（一般不用给）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string' },
          ok: { type: 'boolean' },
          command: { type: 'string' },
        },
        required: ['report'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.report ?? '') }],
    },
    presentCall: args => ({ card: 'terminal', title: '跑验证', cwd: typeof args?.cwd === 'string' ? args.cwd : undefined }),
    async execute(args) {
      const explicitCwd = typeof args?.cwd === 'string' && args.cwd !== '' ? args.cwd : undefined
      const lastTouched = [...TOUCHED_DIRS].slice(-1)[0]

      // 2026-11-15 修 P2-1：没有 cwd、也没写过任何文件时，**不要**跑宿主进程 cwd 的项目。
      // 那份 cwd 通常不是用户的工作区（实测：白跑了一次 Memore 的全量 Gradle 构建）。
      if (explicitCwd === undefined && lastTouched === undefined) {
        return {
          ok: false,
          command: '',
          report: '不知道在哪个项目里跑：这个会话还没写过文件。请用 cwd 参数指定项目目录，例如 cwd: "E:\\\\proj"。',
        }
      }

      // 默认目录：最近被写过的文件所在项目根
      const baseDir = explicitCwd ?? lastTouched
      // 2026-11-15 修 P2-4：目录不存在就直说，别上溯到父目录后在那里跑
      if (explicitCwd !== undefined && !existsSync(explicitCwd)) {
        return { ok: false, command: '', report: `目录不存在：${explicitCwd}（没有在别的地方代替你跑）` }
      }
      const root = projectRootFor(baseDir)

      let command = typeof args?.command === 'string' && args.command.trim() !== '' ? args.command.trim() : undefined
      let source = 'explicit'
      if (command === undefined) {
        const detected = detectVerifyCommand(root)
        if (detected === undefined) {
          return {
            ok: false,
            command: '',
            report: `没有在这个项目里认出验证命令（${root}）。请用 command 参数指定，例如 command: "npm test"。`,
          }
        }
        command = detected.command
        source = detected.source
      }

      // 120 秒上限：同步调用期间界面没有动静，不能允许它卡 5 分钟
      const run = runCommand({ command, cwd: root, timeoutMs: 120_000 })
      const text = `${run.stdout}\n${run.stderr}`
      const summary = summarizeRun({ text, exitCode: run.exitCode, timedOut: run.timedOut })
      // 失败且文本里没拿到用例名时，读 JUnit XML（Gradle/Maven 只输出 BUILD FAILED）
      if (!summary.ok && summary.failed.length === 0) {
        const junitFailed = readJunitFailures(root)
        if (junitFailed.length > 0) {
          summary.junitFailed = junitFailed
          summary.failed = junitFailed.map(item => item.name)
        }
      }
      const report = renderSummary(summary, command)

      // 记台账：和 shell 里跑的验证同等对待（ok / exitCode 都是真的）
      // 2026-11-15 修 P0-1：0 条测试记 ok:null —— 命令确实成功，但什么都没证明，
      // 不能让它清掉"未验证"，也不能让红→绿认它作绿。
      append({
        kind: 'verify',
        ok: summary.zeroTests ? null : summary.ok,
        zeroTests: summary.zeroTests || undefined,
        source: 'tool',
        exitCode: summary.exitCode ?? undefined,
        failed: summary.failed,
        failedParser: summary.junitFailed ? 'junit-xml' : summary.parser,
        cmd: command.slice(0, 110),
      })
      if (summary.ok && !summary.zeroTests) LAST_VERIFY_OK = Date.now()
      else if (!summary.ok) noteEvent({ kind: 'verify-failed', count: summary.failed.length })

      return {
        ok: summary.ok,
        command,
        report: `${report}\n（命令来自 ${source}；目录 ${root}）`,
      }
    },
  })
}

// 规则在模块加载期注册：测试直接调 gate() 时也要有规则，不依赖 apply()
registerRule(readBeforeWrite)
registerRule(readFreshness)
registerRule(readDepth)
registerRule(noUnkeyedDerivedState)

/** 供测试使用。 */
export const __internals = {
  gate,
  recordRead,
  guardStatus,
  isSourcePath,
  READ_FILES,
  READ_META,
  ledgerFile,
  projectRootFor,
  cwdHintsOf,
  gateActivity,
  reloadConfig,
  GATE_CALLS_get: () => GATE_CALLS,
  SHELL_SOURCE_WRITES_get: () => SHELL_SOURCE_WRITES,
}
