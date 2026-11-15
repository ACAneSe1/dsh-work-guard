/**
 * 红→绿证据（核心问题 #2 的代理指标）。
 *
 * 规则：
 *   - **基线** = 最近一次"有失败用例"的验证（红灯）
 *   - **转绿** = 基线之后出现一次"通过且没有失败用例"的验证
 *   - 没有基线 = 没跑过会失败的测试，谈不上证据
 *
 * 它挡的是"在别处加代码把现象盖住"：那种改动几乎不可能让一条具体断言变绿。
 */

/**
 * @param {Array<object>} rows 台账（时间升序）
 * @returns {{
 *   state: 'no-baseline'|'red'|'green',
 *   baseline: { ts: number, names: string[], cmd?: string } | null,
 *   greenAt: number | null,
 *   stillFailing: string[],
 * }}
 */
export function fixEvidence(rows) {
  const verifies = (rows ?? []).filter(row => row?.kind === 'verify')

  let baselineIndex = -1
  for (let i = verifies.length - 1; i >= 0; i -= 1) {
    const row = verifies[i]
    const names = Array.isArray(row.failed) ? row.failed.filter(name => typeof name === 'string' && name !== '') : []
    if (row.ok === false && names.length > 0) {
      baselineIndex = i
      break
    }
  }

  if (baselineIndex < 0) {
    return { state: 'no-baseline', baseline: null, greenAt: null, stillFailing: [] }
  }

  const baselineRow = verifies[baselineIndex]
  const baseline = {
    ts: Number(baselineRow.ts) || 0,
    names: baselineRow.failed,
    cmd: baselineRow.cmd,
  }

  // 基线之后是否出现"通过且无失败用例"
  for (let i = baselineIndex + 1; i < verifies.length; i += 1) {
    const row = verifies[i]
    const names = Array.isArray(row.failed) ? row.failed : []
    if (row.ok === true && names.length === 0) {
      return { state: 'green', baseline, greenAt: Number(row.ts) || 0, stillFailing: [] }
    }
  }

  // 还没绿：报告现在还有多少条红的（取最新的失败记录）
  let stillFailing = baseline.names
  for (let i = verifies.length - 1; i > baselineIndex; i -= 1) {
    const row = verifies[i]
    if (Array.isArray(row.failed) && row.failed.length > 0) {
      stillFailing = row.failed
      break
    }
  }
  return { state: 'red', baseline, greenAt: null, stillFailing }
}

/** 给状态条/工具的短描述。 */
export function describeFixEvidence(evidence) {
  if (evidence.state === 'no-baseline') return '没有红测试基线'
  if (evidence.state === 'green') return `红 → 绿：${evidence.baseline.names.length} 条已通过`
  return `红测试仍然红：${evidence.stillFailing.length} 条`
}
