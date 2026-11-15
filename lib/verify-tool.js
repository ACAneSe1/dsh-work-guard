/**
 * `work_verify` 的内核（2026-11-14）。
 *
 * 目的：把"跑测试"从**对话里的一整段输出**变成**一次工具调用的几行结论**。
 * 同一次测试、同一个退出码，进模型上下文的东西少一两个数量级。
 *
 * 为什么不起守护进程、不自动跑：那样要么占机器，要么自己烧 token。
 * 这里只是"被调用时跑一次"，跑完把结论还回去，并写台账。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { failingTests } from './testNames.js'

/**
 * 读 JUnit XML 报告里的失败用例（2026-11-15）。
 *
 * 为什么需要：Gradle / Maven / Android 这类项目的**控制台输出只有 `BUILD FAILED`**，
 * 没有测试名——所以只解析文本时，这些项目上 `work_verify` 退化成"过没过"。
 * 但它们都会把每条用例的成败写进 JUnit XML，读那个就是精确的。
 *
 * 这是通用机制（JVM 生态的标准产物），不是给某个项目特写。
 *
 * @param {string} root 项目根
 * @returns {Array<{ suite: string, name: string, message: string }>}
 */
export function readJunitFailures(root) {
  if (typeof root !== 'string' || root === '') return []

  // 常见报告目录：gradle / maven / 多模块
  const candidates = [
    join(root, 'app', 'build', 'test-results'),
    join(root, 'build', 'test-results'),
    join(root, 'target', 'surefire-reports'),
    join(root, 'target', 'failsafe-reports'),
  ]
  // 再补一层多模块：<module>/build/test-results
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      candidates.push(join(root, entry.name, 'build', 'test-results'))
    }
  } catch {
    // 读不到目录就算了
  }

  // 去重：同一目录可能被"常见列表"和"多模块循环"各加一次
  const files = []
  const seenDirs = new Set()
  for (const dir of candidates) {
    const key = dir.toLowerCase()
    if (seenDirs.has(key)) continue
    seenDirs.add(key)
    if (!existsSync(dir)) continue
    collectXml(dir, files, 0)
    if (files.length > 200) break
  }

  const failures = []
  const seenNames = new Set()
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    // 逐条 testcase 看它内部有没有 <failure> / <error>
    const re = /<testcase\b[^>]*\bname="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/gu
    let match
    while ((match = re.exec(text)) !== null) {
      const block = match[2] ?? ''
      if (!/<(failure|error)\b/u.test(block)) continue
      if (seenNames.has(match[1])) continue
      seenNames.add(match[1])
      const messageMatch = block.match(/<(?:failure|error)\b[^>]*\bmessage="([^"]*)"/u)
      failures.push({
        suite: '',
        name: match[1],
        message: decodeXml(messageMatch ? messageMatch[1] : '').slice(0, 160),
      })
      if (failures.length >= 10) return failures
    }
  }
  return failures
}

function collectXml(dir, out, depth) {
  if (depth > 3) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectXml(full, out, depth + 1)
    else if (entry.name.toLowerCase().endsWith('.xml')) out.push(full)
  }
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}

/**
 * 从项目根探测验证命令。
 * 顺序 = 置信度：显式配置 > package.json 的 test 脚本 > gradle > 其他。
 * @param {string} root
 * @returns {{ command: string, source: string } | undefined}
 */
export function detectVerifyCommand(root) {
  if (typeof root !== 'string' || root === '') return undefined

  const pkg = join(root, 'package.json')
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8'))
      const test = parsed?.scripts?.test
      if (typeof test === 'string' && test.trim() !== '') return { command: 'npm test', source: 'package.json#scripts.test' }
    } catch {
      // 坏 package.json 不算证据
    }
  }

  if (existsSync(join(root, 'gradlew.bat'))) return { command: 'gradlew.bat test', source: 'gradlew.bat' }
  if (existsSync(join(root, 'gradlew'))) return { command: './gradlew test', source: 'gradlew' }
  if (existsSync(join(root, 'Cargo.toml'))) return { command: 'cargo test', source: 'Cargo.toml' }
  if (existsSync(join(root, 'go.mod'))) return { command: 'go test ./...', source: 'go.mod' }
  if (existsSync(join(root, 'pyproject.toml'))) return { command: 'pytest -q', source: 'pyproject.toml' }

  return undefined
}

/**
 * 跑一次命令（同步，带超时）。
 *
 * 2026-11-14：默认超时从 300 秒降到 120 秒——同步调用期间界面完全没动静，
 * 允许它卡 5 分钟等于允许"看起来死机"。慢项目请给更窄的命令。
 * @param {{ command: string, cwd: string, timeoutMs?: number }} options
 * @returns {{ exitCode: number|null, timedOut: boolean, stdout: string, stderr: string, error?: string }}
 */
export function runCommand(options) {
  const { command, cwd, timeoutMs = 120_000 } = options
  const result = spawnSync(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })

  const timedOut = result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM'
  const stdout = String(result?.stdout ?? '')
  const stderr = String(result?.stderr ?? '')
  const exitCode = Number.isInteger(result?.status) ? result.status : null

  return {
    exitCode,
    timedOut,
    stdout,
    stderr,
    error: result?.error ? String(result.error.message ?? result.error) : undefined,
  }
}

/**
 * 把一大段输出压成几行结论。
 * 原则：**只回答"过没过、哪几条没过"**，不搬运日志。
 * @param {{ text: string, exitCode: number|null, timedOut?: boolean }} options
 */
export function summarizeRun(options) {
  const { text, exitCode, timedOut } = options
  const { names, parser } = failingTests(text)

  // 从常见汇总行里抠计数（有就报，没有不编）
  const count = (re) => {
    const match = text.match(re)
    return match ? Number(match[1]) : undefined
  }
  const total = count(/ℹ tests (\d+)/u) ?? count(/(\d+) passed/u)
  const failedCount = count(/ℹ fail (\d+)/u) ?? count(/(\d+) failed/u)
  const passCount = count(/ℹ pass (\d+)/u)

  // 尾部 3 行非空输出，作为"为什么失败"的最小线索
  const tail = text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '')
    .slice(-3)

  // 2026-11-14：只给"哪条没过"还是得让模型去翻文件。多给一处**位置**，
  // 省掉一次"打开测试文件"的往返。取第一处失败的文件:行。
  const location = firstFailureLocation(text)
  const assertion = firstAssertionLine(text)

  const ok = timedOut ? false : exitCode === 0

  // 2026-11-15 修 P0-1：**0 条测试不是绿**。
  // "什么都没跑却给出通过"与这个插件的存在理由自相矛盾，所以单独标出来：
  // ok 仍按退出码（命令确实成功了），但 zeroTests=true 让调用方不许把它当"已验证"。
  const zeroTests = !timedOut && total === 0 && names.length === 0

  return {
    ok,
    exitCode,
    timedOut: Boolean(timedOut),
    zeroTests,
    failed: names,
    parser,
    total,
    failedCount,
    passCount,
    tail,
    location,
    assertion,
  }
}

/**
 * 找第一处失败位置。
 * 认这些形态（按出现顺序取第一个）：
 *   test at fail.test.mjs:4:1                （node --test 的 spec 输出）
 *   at TestContext.<anonymous> (file:///C:/.../fail.test.mjs:5:10)
 *   /path/to/test_x.py:42: AssertionError    （pytest）
 *   some.test.js:12:5                        （通用）
 * @returns {{ file: string, line: number } | undefined}
 */
export function firstFailureLocation(text) {
  if (typeof text !== 'string' || text === '') return undefined

  const patterns = [
    /test at\s+([^\s:]+):(\d+)(?::\d+)?/u,
    /\(file:\/\/\/[^)\s]*\/([^/)\s]+):(\d+):\d+\)/u,
    /\(([A-Za-z]:\\[^)\s]+|\.{0,2}\/[^)\s]+):(\d+):\d+\)/u,
    /([A-Za-z0-9_.\-/\\]+\.(?:kt|mjs|js|ts|py|go|java|rs)):(\d+):/u,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const line = Number(match[2])
      if (Number.isFinite(line)) {
        // 只保留尾部两段，避免把整条绝对路径塞进上下文
        const parts = String(match[1]).replace(/\\/gu, '/').split('/').filter(Boolean)
        return { file: parts.slice(-2).join('/'), line }
      }
    }
  }
  return undefined
}

/** 第一处断言信息（AssertionError / expected … 之类），取一行，截短。 */
export function firstAssertionLine(text) {
  if (typeof text !== 'string' || text === '') return undefined
  const lines = text.split(/\r?\n/u).map(line => line.trim())
  const hit = lines.find(line => /AssertionError|Assertion failed|expected .* (but|to be|got)|Expected .* but got/u.test(line))
  if (hit === undefined) return undefined
  return hit.length > 100 ? `${hit.slice(0, 100)}…` : hit
}

/** 把结论渲染成给模型看的几行。 */
export function renderSummary(summary, command) {
  const head = summary.timedOut
    ? '⏱ 超时（命令没有在时限内结束）'
    : (summary.zeroTests
      ? '⚠ 通过，但一条测试都没跑到'
      : (summary.ok ? '✓ 通过' : `✖ 失败（exit ${summary.exitCode ?? '未知'}）`))

  const lines = [`${head} · ${command}`]
  if (summary.zeroTests) {
    lines.push('这条不能算"已验证"：0 条测试，什么都没证明')
  }
  if (summary.total !== undefined) {
    const parts = [`共 ${summary.total}`]
    if (summary.passCount !== undefined) parts.push(`通过 ${summary.passCount}`)
    if (summary.failedCount !== undefined) parts.push(`失败 ${summary.failedCount}`)
    lines.push(parts.join(' · '))
  }

  // 失败名单：JUnit XML（JVM 最准）优先，其次文本解析
  const junit = Array.isArray(summary.junitFailed) ? summary.junitFailed : []
  const names = junit.length > 0 ? junit.map(item => item.name) : summary.failed
  if (names.length > 0) lines.push(`失败用例：${names.slice(0, 5).join('、')}`)

  if (!summary.ok && junit.length > 0 && junit[0].message) {
    lines.push(`信息：${junit[0].message}`)
  }
  if (!summary.ok && summary.location) {
    lines.push(`位置：${summary.location.file}:${summary.location.line}${summary.assertion ? ` · ${summary.assertion}` : ''}`)
  }
  if (!summary.ok && summary.tail.length > 0) lines.push(`尾部：${summary.tail.join(' / ')}`)
  return lines.join('\n')
}
