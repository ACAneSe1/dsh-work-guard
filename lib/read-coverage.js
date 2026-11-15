/**
 * 记录一次读取覆盖了哪些行（第 2 步：读的深度）。
 *
 * 之前只记"这个文件被读过"，于是 `read(limit=10)` 之后可以改第 500 行。
 * 现在把 read 的 offset/limit 换算成行范围存下来，edit 时比对改动落在哪几行。
 */

/** 1-based 行范围 [start, end]；end = Infinity 表示读到文件尾。 */
export function rangeFromReadArgs(args) {
  const offset = Number(args?.offset)
  const limit = Number(args?.limit)
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 1
  if (!Number.isFinite(limit) || limit <= 0) return { start, end: Number.POSITIVE_INFINITY, full: start === 1 }
  return { start, end: start + Math.floor(limit) - 1, full: start === 1 && false }
}

/** 某一行是否被任一范围覆盖。 */
export function covers(ranges, line) {
  for (const range of ranges ?? []) {
    if (line >= range.start && line <= range.end) return true
  }
  return false
}

/** 是否读过整个文件（范围从 1 开始且到文件尾）。 */
export function coversWholeFile(ranges) {
  for (const range of ranges ?? []) {
    if (range.start <= 1 && range.end === Number.POSITIVE_INFINITY) return true
  }
  return false
}

/**
 * 找一段文本（edit 的 old_string）在全文里的行跨度。
 * @returns {{ start: number, end: number } | undefined}
 */
export function lineSpanOf(text, needle) {
  if (typeof text !== 'string' || typeof needle !== 'string' || needle === '') return undefined
  const index = text.indexOf(needle)
  if (index < 0) return undefined
  const start = text.slice(0, index).split('\n').length
  const lineCount = needle.split('\n').length
  return { start, end: start + lineCount - 1 }
}

/**
 * 合并同一文件的多次读取范围（只保留能覆盖更多的那种，避免数组无限增长）。
 * 规则：整文件读 → 直接覆盖成 [1, ∞)；单次上限 32 段，超出后按起点排序合并相邻。
 */
export function mergeRange(ranges, next) {
  const list = [...(ranges ?? [])]
  if (next.start <= 1 && next.end === Number.POSITIVE_INFINITY) return [{ start: 1, end: Number.POSITIVE_INFINITY }]
  list.push(next)
  list.sort((a, b) => a.start - b.start)
  const merged = []
  for (const range of list) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged.slice(-32)
}
