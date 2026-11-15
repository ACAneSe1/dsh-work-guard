/**
 * shell 绕过扫描（第 3 批从 index.js 抽出）。
 *
 * 事实：shell（pwsh/bash）不经过工具的写入路径，闸门看不到它，也拦不住它
 * （写入权限由会话权限决定）。能做的只有**事后记录**：命令执行后扫一遍
 * 最近被动过的源码文件，台账里没有对应 write/edit 的，记一条 bypass。
 *
 * 去重：同一文件 60 秒内只记一条；10 分钟内的 write/edit 视为已覆盖。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { entryTime } from './time.js'
import { normPath, pathTail } from './paths.js'
import { append, tail } from './ledger.js'

const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', '.idea', 'dist', '.next', 'target', 'out', 'venv', '__pycache__'])

/**
 * @param {object} options
 * @param {string} options.command 触发本次扫描的命令（只用于台账备注）
 * @param {Set<string>|string[]} options.roots 要扫的项目根
 * @param {(name: string) => boolean} options.isSourceFile 是否算源码
 * @param {number} [options.sinceMs] 只看这么多毫秒内改过的文件
 * @param {number} [options.floorMs] 早于这个时间戳的文件一律不算（插件启动时间）——
 *   防止"装插件之前就存在的文件"在首轮被误报成绕过（2026-11-14 复审 P2-6）
 */
export function scanBypassWrites(options) {
  const { command, roots, isSourceFile } = options
  const windowStart = Date.now() - (options.sinceMs ?? 60_000)
  const since = Number.isFinite(options.floorMs) ? Math.max(windowStart, options.floorMs) : windowStart
  const rootList = [...(roots ?? [])].filter(Boolean)
  if (rootList.length === 0) return 0

  const recent = []
  const walk = (dir, depth) => {
    if (depth > 16 || recent.length >= 200) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(abs, depth + 1)
          continue
        }
        if (!entry.isFile() || !isSourceFile(entry.name)) continue
        if (statSync(abs).mtimeMs >= since) recent.push(abs)
      } catch {
        // 单个条目读不到就跳过
      }
    }
  }
  for (const root of rootList) walk(root, 0)
  if (recent.length === 0) return 0

  const cutoff = Date.now() - 10 * 60_000
  const dedupeCutoff = Date.now() - 60_000
  const rows = tail(600)
  const freshWrites = rows.filter(row => (row.kind === 'write' || row.kind === 'edit') && entryTime(row) >= cutoff)
  const seenBypass = new Set(
    rows.filter(row => row.kind === 'bypass' && entryTime(row) >= dedupeCutoff)
      .map(row => pathTail(normPath(String(row.file ?? '')) ?? '')),
  )

  let written = 0
  for (const abs of recent) {
    const key = pathTail(normPath(abs) ?? '')
    if (freshWrites.some(row => pathTail(normPath(String(row.file ?? '')) ?? '') === key)) continue
    if (seenBypass.has(key)) continue
    seenBypass.add(key)
    append({
      kind: 'bypass',
      file: String(abs).replace(/\\/g, '/'),
      cmd: String(command ?? '').replace(/\s+/gu, ' ').slice(0, 90),
    })
    written += 1
  }
  return written
}
