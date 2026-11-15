/** 闸门活跃度判定（B3 第三版）测试。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeGateActivity } from '../lib/gate-activity.js'

test('工具存在（按 scope 查到）→ 在，即使本会话没写过文件', () => {
  const result = computeGateActivity({ gateCalls: 0, shellSourceWrites: 3, hasWriteTools: true })
  assert.equal(result.active, true)
  assert.equal(result.reason, 'tools')
})

test('用过 write/edit → 在', () => {
  const result = computeGateActivity({ gateCalls: 2, shellSourceWrites: 0, hasWriteTools: null })
  assert.equal(result.active, true)
  assert.equal(result.reason, 'used')
})

test('确认没有工具 → 空转', () => {
  const result = computeGateActivity({ gateCalls: 0, shellSourceWrites: 0, hasWriteTools: false })
  assert.equal(result.active, false)
  assert.equal(result.reason, 'idle')
})

test('工具未知但脚本改过源码 → 判为空转（提示而不是保证）', () => {
  const result = computeGateActivity({ gateCalls: 0, shellSourceWrites: 1, hasWriteTools: null })
  assert.equal(result.active, false)
})

test('什么证据都没有 → 不知道', () => {
  const result = computeGateActivity({ gateCalls: 0, shellSourceWrites: 0, hasWriteTools: null })
  assert.equal(result.active, null)
  assert.equal(result.reason, 'unknown')
})

test('空输入不抛', () => {
  assert.equal(computeGateActivity().active, null)
})
