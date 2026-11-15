/**
 * 规则：没读过就不许写。
 *
 * 这是本插件的第一条，也是唯一一条**没有例外**的规则（没有 allow 标记）。
 * 读不到就明说读不到——不要靠猜内容开工。
 */

export const id = 'read-before-write'
export const stage = 'pre-write'

/** 只对源码文件生效；文档/配置不要求先读（它们常被整份重写）。 */
export function applies(context) {
  return Boolean(context?.isSource) && context?.isNew !== true
}

/**
 * @param {{ readBefore: boolean, filePath: string }} context
 */
export function check(context) {
  if (context.readBefore) return null
  return {
    deny: 'read-before-write',
    reason:
      `Work guard: read before write. \`${context.filePath}\` has not been read in this session.\n`
      + 'Open it with the read tool first (or grep to the exact lines), then come back.\n'
      + 'If it cannot be read, say so — do not guess its contents.',
  }
}

export default { id, stage, applies, check }
