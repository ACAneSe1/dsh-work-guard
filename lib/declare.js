/**
 * 脚本改动的"申报"机制（第 6 步）。
 *
 * 事实：shell 不走工具写入路径，闸门拦不住。与其假装能拦，不如让**未申报的改动可见**：
 *   - 扫描把脚本改动的源码记成 bypass
 *   - 一个 `work_declare` 工具允许事后申报："这些文件是我用脚本改的，为什么"
 *   - 没被申报覆盖的 bypass = **欠账**，状态条上一直显示
 *
 * 这不是阻止，是让"我偷偷用脚本改了一堆"变成"我申报了 3 个文件，还有 2 个没申报"。
 */

/** 一次申报覆盖多久之内的改动（毫秒）。脚本改完立刻申报，30 分钟足够。 */
export const DECLARE_WINDOW_MS = 30 * 60 * 1000

/**
 * 从台账里算：哪些 bypass 还没有被申报覆盖。
 *
 * 覆盖规则：某条 bypass 的文件在它**之后**的某条 declare 里出现过，且时间差在窗口内。
 *
 * @param {Array<object>} rows 时间升序
 * @returns {{ undeclared: Array<{file: string, ts: number}>, declaredCount: number }}
 */
export function undeclaredChanges(rows) {
  const list = rows ?? []
  const declares = list.filter(row => row?.kind === 'declare' && Array.isArray(row.files))

  const undeclared = []
  for (const row of list) {
    if (row?.kind !== 'bypass') continue
    const file = typeof row.file === 'string' ? row.file : undefined
    if (!file) continue
    const ts = Number(row.ts) || 0

    const covered = declares.some(declare => {
      const declaredAt = Number(declare.ts) || 0
      if (declaredAt < ts || declaredAt - ts > DECLARE_WINDOW_MS) return false
      return declare.files.some(candidate => samePath(candidate, file))
    })
    if (!covered) undeclared.push({ file, ts })
  }

  return { undeclared, declaredCount: declares.length }
}

/** 路径比较：忽略大小写与斜杠方向（只用于申报匹配，不用于安全判定）。 */
function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const norm = value => value.replace(/\\/gu, '/').toLowerCase()
  return norm(a) === norm(b)
}
