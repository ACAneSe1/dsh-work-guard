/**
 * 规则：改动必须落在你真正读过的行范围内。
 *
 * 动机（第 2 步）：`read` 只看过前 10 行，却去改第 500 行 —— 闸门原来会放行。
 * 现在：
 *   - `edit`：old_string 在文件里的行跨度，必须全部落在已读范围内；
 *   - `write`（整份覆盖已存在的文件）：必须**整文件读过**。
 */
import { covers, coversWholeFile } from '../read-coverage.js'

export const id = 'read-depth'
export const stage = 'pre-write'

export function applies(context) {
  return Boolean(context?.isSource) && context?.isNew !== true && Boolean(context?.readMeta)
}

export function check(context) {
  const ranges = context?.readMeta?.ranges ?? []

  // 整份覆盖已存在的文件：要求整文件读过
  if (context.tool === 'write') {
    if (coversWholeFile(ranges)) return null
    return {
      deny: 'read-depth',
      reason:
        `Work guard: \`${context.filePath}\` is being replaced wholesale, `
        + 'but only part of it was read in this session.\n'
        + 'Read the whole file first (no offset/limit), or switch to an edit of the specific region.',
    }
  }

  const span = context.editSpan
  if (!span) return null // 定位不到 old_string 时交给 edit 工具自身报错
  for (let line = span.start; line <= span.end; line += 1) {
    if (covers(ranges, line)) continue
    return {
      deny: 'read-depth',
      reason:
        `Work guard: the change touches line ${line} of \`${context.filePath}\`, `
        + 'which is outside the range you read.\n'
        + `Read that region first (offset ≈ ${Math.max(1, line - 20)}, limit ≈ 60), then re-apply.\n`
        + 'Reading the first few lines of a file does not authorise editing the rest of it.',
    }
  }
  return null
}

export default { id, stage, applies, check }
