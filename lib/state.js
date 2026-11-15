/**
 * 已读集合的持久化。
 *
 * 为什么需要（2026-11-14 评审第 5 条）：原先 `READ_FILES` 只是内存 Set，
 * 重启即清零 —— 同一台机器上反复改同一个文件，每次都要重新读一遍，
 * 既慢又费 token，而且和"换电脑"无关：这是**同一个会话模型之外的记忆**。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_ENTRIES = 5000

/** 状态文件路径。 */
export function statePath(dataDir) {
  return join(dataDir, 'work-guard-state.json')
}

/**
 * 读取已读记录，丢掉过期的。
 * @param {string} dataDir
 * @param {number} ttlHours
 * @returns {Map<string, number>} key（归一化绝对路径）→ 毫秒时间戳
 */
export function loadReadState(dataDir, ttlHours = 24) {
  const file = statePath(dataDir)
  const out = new Map()
  if (!existsSync(file)) return out

  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return out
  }

  const cutoff = Date.now() - ttlHours * 3600 * 1000
  const reads = raw?.reads ?? {}
  for (const [key, ts] of Object.entries(reads)) {
    if (Number.isFinite(ts) && ts >= cutoff) out.set(key, ts)
  }
  return out
}

/**
 * 读取「行覆盖范围」（第 2 步）：key → { at, ranges }。
 * ranges 里 `end: null` 表示读到文件尾（JSON 不能存 Infinity）。
 */
export function loadReadMeta(dataDir, ttlHours = 24) {
  const file = statePath(dataDir)
  const out = new Map()
  if (!existsSync(file)) return out
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return out
  }
  const cutoff = Date.now() - ttlHours * 3600 * 1000
  const meta = raw?.meta ?? {}
  for (const [key, value] of Object.entries(meta)) {
    const at = Number(value?.at)
    if (!Number.isFinite(at) || at < cutoff) continue
    const ranges = Array.isArray(value?.ranges)
      ? value.ranges
        .filter(range => Number.isFinite(range?.start))
        .map(range => ({ start: range.start, end: range.end === null ? Number.POSITIVE_INFINITY : Number(range.end) }))
      : []
    out.set(key, { at, ranges })
  }
  return out
}

/**
 * 写回已读记录（原子写：先写临时文件再改名，避免半截 JSON）。
 * 超过上限时按最旧淘汰。
 *
 * v2：同时写 `meta`（行覆盖范围），这样重启后 read-depth 不会把
 * 之前读过整份的文件当成"只读了一部分"。
 * @param {Map<string, number>} reads
 * @param {Map<string, {at: number, ranges: Array<{start: number, end: number}>}>} [meta]
 */
export function saveReadState(dataDir, reads, meta) {
  try {
    mkdirSync(dataDir, { recursive: true })
    const entries = [...reads.entries()]
      .filter(([, ts]) => Number.isFinite(ts))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTRIES)
    const metaOut = {}
    if (meta instanceof Map) {
      for (const [key, value] of [...meta.entries()].slice(-MAX_ENTRIES)) {
        if (!Number.isFinite(value?.at)) continue
        metaOut[key] = {
          at: value.at,
          ranges: (value.ranges ?? []).map(range => ({
            start: range.start,
            end: Number.isFinite(range.end) ? range.end : null,
          })),
        }
      }
    }
    const payload = { version: 2, reads: Object.fromEntries(entries), meta: metaOut }
    const file = statePath(dataDir)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(payload), 'utf8')
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
