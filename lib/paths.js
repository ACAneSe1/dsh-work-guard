/**
 * 路径：绝对化、项目根探测、相对展示。
 *
 * 取代两处旧做法（2026-11-14 评审）：
 *   1. `repoRootOf` 只向上找 `.git` —— 在外层仓库下会把根取太高，
 *      台账里出现 `outer/proj-a/...` 这种前缀。
 *   2. 判定用「路径尾部 3 段」比较 —— 两个项目里的同名文件会被认成一个。
 *
 * 新规则：
 *   - 比较、去重、已读判定：一律用 `keyOf`（绝对化 + 正斜杠 + 小写）
 *   - 显示：用 `relativeTo(root, abs)`
 *   - 根：`projectRootOf(abs, markers)`，按**文件自己**向上找最近的标记文件
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** 默认的项目标记：按"越靠内越可能是项目根"的顺序给，命中即停。 */
export const DEFAULT_MARKERS = [
  '.git',
  'package.json',
  'settings.gradle.kts',
  'settings.gradle',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pubspec.yaml',
]

/**
 * 归一化：正斜杠 + （按平台）大小写折叠。
 *
 * 2026-11-14 复审修正（P2-7）：原来无条件 `toLowerCase()`，
 * 在 Linux/macOS 上会把 `A.ts` 与 `a.ts` 认成同一个文件 —— 正好是 P0-4 的镜像问题。
 * 现在只在大小写不敏感的平台（Windows / macOS 默认）折叠。
 */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

export function normPath(p) {
  if (typeof p !== 'string' || p === '') return undefined
  const slashed = p.replace(/\\/g, '/')
  return CASE_INSENSITIVE_FS ? slashed.toLowerCase() : slashed
}

/**
 * 路径尾部 N 段。
 *
 * **只用于台账读取时的去重与显示**。不再参与"这个文件是哪一个"的判断 ——
 * 那个判断用 `keyOf`（绝对化），因为两个同构项目里的同名文件会撞车（2026-11-14 实测复现）。
 */
export function pathTail(n, segments = 3) {
  if (typeof n !== 'string') return ''
  return n.split('/').filter(Boolean).slice(-segments).join('/')
}

/** 是否为绝对路径（Windows 盘符 或 POSIX 根）。 */
export function isAbsolutePath(p) {
  if (typeof p !== 'string' || p === '') return false
  return isAbsolute(p) || /^[a-zA-Z]:[\\/]/u.test(p)
}

/**
 * 判定用的键：绝对化后的归一化路径。
 * 相对路径需要 `cwd` 才能绝对化——调用方必须传真实工作目录，
 * 不要用宿主的 `process.cwd()`（今天踩过：那不是工作区）。
 */
export function keyOf(p, cwd) {
  if (typeof p !== 'string' || p === '') return undefined
  const abs = isAbsolutePath(p) ? resolve(p) : (typeof cwd === 'string' && cwd !== '' ? resolve(cwd, p) : resolve(p))
  return normPath(abs)
}

/** 目录缓存：一次进程内不重复 stat。 */
const rootCache = new Map()

/**
 * 从某个文件/目录向上找最近的"项目根"。
 * @param {string} target 绝对或相对路径（相对时按 cwd 解析）
 * @param {{ cwd?: string, markers?: string[] }} [options]
 * @returns {string|undefined} 绝对路径形式的根；找不到返回起点目录
 */
export function projectRootOf(target, options = {}) {
  const markers = options.markers ?? DEFAULT_MARKERS
  if (typeof target !== 'string' || target === '') return undefined
  let cur = isAbsolutePath(target) ? resolve(target) : resolve(options.cwd ?? process.cwd(), target)

  // 传进来的可能是个文件：先退到目录
  try {
    if (statSync(cur).isFile()) cur = dirname(cur)
  } catch {
    if (!existsSync(cur)) cur = dirname(cur)
  }

  const cacheKey = `${normPath(cur)}|${markers.join(',')}`
  const cached = rootCache.get(cacheKey)
  if (cached !== undefined) return cached

  let probe = cur
  for (let i = 0; i < 32; i += 1) {
    for (const marker of markers) {
      if (existsSync(join(probe, marker))) {
        rootCache.set(cacheKey, probe)
        return probe
      }
    }
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  rootCache.set(cacheKey, cur)
  return cur
}

/** 相对根的显示路径（正斜杠）；不在根下就原样返回。 */
export function relativeTo(root, abs) {
  const a = String(abs).replace(/\\/g, '/')
  if (typeof root !== 'string' || root === '') return a
  const r = String(root).replace(/\\/g, '/').replace(/\/+$/u, '')
  if (a.toLowerCase().startsWith(r.toLowerCase() + '/')) return a.slice(r.length + 1)
  return a
}

/**
 * 从一条 shell 命令里猜出"它会在哪个目录里干活"（2026-11-14 修 B2）。
 *
 * 为什么需要：扫描范围原本只来自三个地方——write/edit 工具写过的目录、命令的 workdir 参数、
 * 宿主进程的 cwd。**当会话没有 write/edit 工具、命令也没带 workdir 时，三者全空**，
 * 于是脚本在项目里改文件也一条都发现不了（独立测试会话实测复现）。
 *
 * 这里只认最明确的形态：`cd <路径>` / `Set-Location <路径>` / `pushd <路径>`，
 * 路径可以是绝对路径、带引号、或 `..`。其余一律不猜。
 *
 * @param {string} command
 * @returns {string[]} 绝对路径候选（未去重，调用方自行归并）
 */
export function cwdHintsOf(command) {
  if (typeof command !== 'string' || command === '') return []
  const hints = []
  const re = /(?:^|[;&|]\s*|\s)(?:cd|Set-Location|sl|pushd)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/giu
  let match
  while ((match = re.exec(command)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3]
    if (typeof raw !== 'string' || raw === '') continue
    // 过滤明显不是路径的写法（变量、通配符、flag）
    if (/^[-/]?[A-Za-z_$][\w$]*$/u.test(raw) && !/[\\/]/u.test(raw)) {
      if (!/^[A-Za-z]:$/u.test(raw)) continue
    }
    try {
      const resolved = isAbsolutePath(raw) ? raw : resolve(process.cwd(), raw)
      hints.push(normPath(resolved) ?? resolved)
    } catch {
      // 解析不了就跳过
    }
  }
  return hints
}

/**
 * 从一条 shell 命令里抠出"它打算写到哪些文件"（2026-11-15 修 P1-2）。
 *
 * 为什么需要：扫描根原先只来自"命令里带 cd"、write/edit 工具目录、宿主 cwd。
 * 于是 `Set-Content -Path "C:\proj\x.ts"` 这种**不带 cd 的绝对路径写入完全漏报**——
 * 脚本改了源码，面板却一条欠账都没有。
 *
 * 只认明确的写入形态，且只用来**扩大扫描范围**，不改变任何判定规则：
 *   Set-Content -Path X / Add-Content -Path X / Out-File X / Tee-Object -FilePath X
 *   > X  /  >> X  /  tee X
 *
 * 输出设备（$null、nul、/dev/null）一律排除。
 *
 * @param {string} command
 * @param {string} [baseDir] 相对路径的基准（默认进程 cwd）
 * @returns {string[]} 写入目标的绝对路径（已归一化、去重）
 */
export function writeTargetsOf(command, baseDir) {
  if (typeof command !== 'string' || command === '') return []

  const base = typeof baseDir === 'string' && baseDir !== '' ? baseDir : process.cwd()
  const raw = []
  const quoted = String.raw`(?:"([^"]+)"|'([^']+)'|([^\s|;&>]+))`

  const patterns = [
    new RegExp(String.raw`(?:Set-Content|Add-Content|Out-File|Tee-Object)\b[^|;]*?(?:-Path|-FilePath)\s+${quoted}`, 'giu'),
    new RegExp(String.raw`(?:^|[\s;|&])>{1,2}\s*${quoted}`, 'gu'),
    new RegExp(String.raw`\btee\s+(?:-a\s+|--append\s+)?(?:-FilePath\s+)?${quoted}`, 'giu'),
  ]

  for (const re of patterns) {
    let match
    while ((match = re.exec(command)) !== null) {
      const value = match[1] ?? match[2] ?? match[3]
      if (typeof value !== 'string' || value === '') continue
      raw.push(value)
    }
  }

  const out = []
  const seen = new Set()
  for (const value of raw) {
    const trimmed = value.trim()
    if (trimmed === '') continue
    // 输出设备 / 空设备：不是文件
    if (/^(\$null|nul|\/dev\/null|-)$/iu.test(trimmed)) continue
    // 变量或表达式：无法解析，跳过（不猜）
    if (/^\$|^\x60/u.test(trimmed)) continue
    try {
      const resolved = isAbsolutePath(trimmed) ? trimmed : resolve(base, trimmed)
      const key = normPath(resolved) ?? resolved
      if (seen.has(key)) continue
      seen.add(key)
      out.push(key)
    } catch {
      // 解析不了就跳过
    }
  }
  return out
}
