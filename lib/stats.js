/**
 * 台账统计（2026-11-14 第 1 步）。
 *
 * 为什么单独抽出来：之前"今天改了几处""几次绕过"是用**整个台账**算的，
 * 而台账里有历史（包括修复 bug 之前产生的误报），于是面板上的数字不可信。
 *
 * 新口径：
 *   - `since`：本次插件启动以来的数（重启即归零，等于"这个会话干了什么"）
 *   - `today`：当天全量（跨重启累计，用于"今天总共"的问题）
 *   - 两者都基于 `ts`，不依赖字符串比较
 */

/** 台账里算"改动"的两种 kind。 */
const EDIT_KINDS = new Set(['write', 'edit'])

function isEdit(row) {
  return EDIT_KINDS.has(row?.kind)
}

/**
 * 这次改动是不是"源码"（2026-11-15）。
 *
 * 为什么只对源码算"未验证"：验证命令（测试/构建）检验的是代码；
 * 改一份 README 却逼着跑测试，是形式主义——而红灯太多，人就会开始无视它。
 * 台账、申报、绕过仍然记**所有**文件，只是"未验证"这一盏灯只盯源码。
 * @param {(path: string) => boolean} [isSourceFile]
 */
function sourceEdit(row, isSourceFile) {
  if (!isEdit(row)) return false
  if (typeof isSourceFile !== 'function') return true
  const file = String(row?.file ?? '')
  if (file === '') return false
  return isSourceFile(file)
}

/**
 * 一条验证记录是否算"成功"。
 * 第 4 步：`ok` 来自真实退出码；`ok: null` 表示结果不可判定（不算成功）。
 * 没有 `ok` 字段的是 v1/旧记录（当时靠命令字符串判定），按成功处理以兼容历史。
 */
function isOkVerify(row) {
  if (row?.kind !== 'verify') return false
  if (row.ok === true) return true
  if (row.ok === undefined) return true // 旧记录：没有退出码字段
  return false
}

/** 最后一条**成功**验证之后的**源码**改动数。 */
function unverifiedSince(rows, isSourceFile) {
  let lastOk = -1
  for (let i = 0; i < rows.length; i += 1) {
    if (isOkVerify(rows[i])) lastOk = i
  }
  const tail = lastOk < 0 ? rows : rows.slice(lastOk + 1)
  return tail.filter(row => sourceEdit(row, isSourceFile)).length
}

/**
 * @param {Array<object>} rows 台账记录（按时间升序）
 * @param {{ getTime: (row: object) => number, sinceTs: number, today: string,
 *           isSourceFile?: (path: string) => boolean }} options
 *   `isSourceFile` 决定"未验证"是否只统计源码（不传则所有改动都算）。
 */
export function computeStats(rows, options) {
  const getTime = options.getTime ?? (row => Number(row.ts) || 0)
  const sinceTs = Number(options.sinceTs) || 0
  const today = options.today ?? ''
  const isSourceFile = options.isSourceFile

  const sinceStart = rows.filter(row => getTime(row) >= sinceTs)
  const todays = today === '' ? [] : rows.filter(row => row.day === today)

  const count = (list, predicate) => list.filter(predicate).length

  return {
    since: {
      edits: count(sinceStart, isEdit),
      // 源码改动单独计数：面板的"未验证"只看它
      sourceEdits: count(sinceStart, row => sourceEdit(row, isSourceFile)),
      verifies: count(sinceStart, isOkVerify),
      // 失败的验证单独计数：它是"跑了但没通过"的证据，和"没跑"不一样
      verifiesFailed: count(sinceStart, row => row?.kind === 'verify' && row.ok === false),
      verifiesUnknown: count(sinceStart, row => row?.kind === 'verify' && row.ok === null),
      bypass: count(sinceStart, row => row?.kind === 'bypass'),
      denies: count(sinceStart, row => row?.kind === 'deny'),
      unverified: unverifiedSince(sinceStart, isSourceFile),
    },
    today: {
      edits: count(todays, isEdit),
      sourceEdits: count(todays, row => sourceEdit(row, isSourceFile)),
      verifies: count(todays, isOkVerify),
      verifiesFailed: count(todays, row => row?.kind === 'verify' && row.ok === false),
      verifiesUnknown: count(todays, row => row?.kind === 'verify' && row.ok === null),
      bypass: count(todays, row => row?.kind === 'bypass'),
      denies: count(todays, row => row?.kind === 'deny'),
      unverified: unverifiedSince(todays, isSourceFile),
    },
    lifetime: { rows: rows.length },
  }
}
