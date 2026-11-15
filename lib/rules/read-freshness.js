/**
 * 规则：读到的内容必须比磁盘上的新。
 *
 * 动机（第 2 步）：`read` 之后文件被改过（别的进程、shell、或同一会话的脚本），
 * 再按旧内容 patch 会改到错的地方。判定很便宜：read 的时间戳 vs 文件 mtime。
 */
export const id = 'read-freshness'
export const stage = 'pre-write'

export function applies(context) {
  return Boolean(context?.isSource) && context?.isNew !== true
}

/** 文件系统时间戳与进程时钟之间的容差：2 秒内不算"读完之后被改"。 */
export const FSKEW_MS = 2000

export function check(context) {
  const meta = context?.readMeta
  const mtime = context?.fileMtime
  if (!Number.isFinite(mtime)) return null
  if (!meta) return null // 完全没读过的情形由 read-before-write 负责报

  // 2026-11-14 实测修正（两次）：
  //   mtime 落在"未来"（时钟漂移、网络盘、touch -d）时，它**不可能**是
  //   "读完之后发生的修改"——这种时间戳直接放行。
  //   第一次的写法是把它夹到 now，结果读与改之间隔几秒就又会误拒。
  const now = Date.now()
  if (mtime > now + FSKEW_MS) return null
  if (meta.at + FSKEW_MS >= mtime) return null
  return {
    deny: 'read-freshness',
    reason:
      `Work guard: \`${context.filePath}\` changed after you read it `
      + '(the file on disk is newer than your last read).\n'
      + 'Read it again before editing, then re-apply the change.\n'
      + 'If something else keeps touching it, say so instead of patching blind.',
  }
}

export default { id, stage, applies, check }
