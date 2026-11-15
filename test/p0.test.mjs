/** P0 修复的回归测试（来自 2026-11-15 独立测试报告）。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { verdictsOf } from '../lib/verdict.js'
import { renderSummary, summarizeRun } from '../lib/verify-tool.js'

test('P0-1：0 条测试不算绿（zeroTests 标记 + 文案）', () => {
  const summary = summarizeRun({ text: 'ℹ tests 0\nℹ pass 0\nℹ fail 0', exitCode: 0 })
  assert.equal(summary.zeroTests, true)
  const rendered = renderSummary(summary, 'npm test')
  assert.match(rendered, /一条测试都没跑到/)
  assert.match(rendered, /不能算"已验证"/)
})

test('P0-1：有测试且通过时 zeroTests 为 false', () => {
  const summary = summarizeRun({ text: 'ℹ tests 5\nℹ pass 5\nℹ fail 0', exitCode: 0 })
  assert.equal(summary.zeroTests, false)
  assert.match(renderSummary(summary, 'npm test'), /✓ 通过/)
})

test('P0-1：面板对"0 条测试"给出 warn，而不是静默', () => {
  const list = verdictsOf({ emptyVerifications: 1 })
  assert.equal(list[0].level, 'warn')
  assert.match(list[0].title, /没跑到任何测试/)
  assert.ok(list[0].action.length > 0, '必须给出下一步动作')
})

test('P0-1：没有这种记录时不出现该 warn', () => {
  const list = verdictsOf({ emptyVerifications: 0 })
  assert.equal(list.length, 1)
  assert.equal(list[0].level, 'ok')
})
