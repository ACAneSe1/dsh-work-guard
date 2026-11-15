/** B1/B2 修复的回归测试（来自独立测试会话的报告 2026-11-14）。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { cwdHintsOf } from '../lib/paths.js'
import { exitCodeOf, verifyOutcome } from '../lib/verify-result.js'

const re = /gradlew|npm(\s|\.cmd\s+)(run\s+)?(test|build)/iu

test('B1：退出码只在输出文本里（pwsh 的 [exit code: 1]）也能取到', () => {
  const text = '> node --test\n\n✖ 失败\n\n[exit code: 1]'
  assert.equal(exitCodeOf({ value: {} }, text), 1)
})

test('B1：失败的干净命令必须记 ok:false（不能靠 isError 兜底成成功）', () => {
  const outcome = verifyOutcome({
    result: { isError: false, value: {} },
    text: 'FAILED\n[exit code: 1]',
    command: 'npm test',
    verifyRe: re,
  })
  assert.equal(outcome?.ok, false)
  assert.equal(outcome?.exitCode, 1)
})

test('B1：通过的命令记 ok:true', () => {
  const outcome = verifyOutcome({
    result: { isError: false, value: {} },
    text: 'ℹ pass 84\n[exit code: 0]',
    command: 'npm test',
    verifyRe: re,
  })
  assert.equal(outcome?.ok, true)
})

test('B1：既没有结构化退出码、也没有文本标记 → 绝不判成功', () => {
  const outcome = verifyOutcome({
    result: { isError: false, value: {} },
    text: 'some output without exit marker',
    command: 'npm test',
    verifyRe: re,
  })
  assert.equal(outcome?.ok, null)
  assert.equal(outcome?.source, 'is-error-unreliable')
})

test('B2：从 cd / Set-Location 里取到目录', () => {
  const hints = cwdHintsOf('cd "E:\\proj"; npm test')
  assert.ok(hints.some(hint => hint.toLowerCase().includes('e:/proj')))
})

test('B2：没写 cd 的命令不产生提示（不猜）', () => {
  assert.deepEqual(cwdHintsOf('npm test'), [])
  assert.deepEqual(cwdHintsOf(''), [])
})

test('B2：相对 cd 被解析成绝对路径', () => {
  const hints = cwdHintsOf('cd sub/dir && npm test')
  assert.ok(hints.length === 1)
  assert.ok(hints[0].includes('sub/dir'))
})
