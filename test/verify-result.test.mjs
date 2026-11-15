/** 第 4 步测试：验证的判定来源是真实结果，不是命令字符串。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { exitCodeOf, looksLikeVerify, verifyOutcome } from '../lib/verify-result.js'

const re = /gradlew|npm(\s|\.cmd\s+)(run\s+)?(test|build)/iu

test('looksLikeVerify：算验证与不算验证的命令', () => {
  assert.equal(looksLikeVerify('npm test', re), true)
  assert.equal(looksLikeVerify('npm.cmd test', re), true)
  assert.equal(looksLikeVerify('./gradlew :app:assembleDebug', re), true)
  assert.equal(looksLikeVerify('ls -la', re), false)
  assert.equal(looksLikeVerify('echo npm test', re), false)
  assert.equal(looksLikeVerify('', re), false)
})

test('P2-3：引号里的 "npm test" 字样不算验证（真的跑了才算）', () => {
  assert.equal(looksLikeVerify('node build-fail.js --command "npm test"', re), false)
  assert.equal(looksLikeVerify('pwsh -Command "npm test"', re), false)
  // 真实的调用仍然认
  assert.equal(looksLikeVerify('npm test -- --reporter=dot', re), true)
  assert.equal(looksLikeVerify('npm test -- "某个用例"', re), true)
})

test('exitCodeOf 从多种形状里取退出码', () => {
  assert.equal(exitCodeOf({ value: { exitCode: 0 } }), 0)
  assert.equal(exitCodeOf({ value: { exit_code: 2 } }), 2)
  assert.equal(exitCodeOf({ value: { result: { exitCode: 1 } } }), 1)
  assert.equal(exitCodeOf({ value: {} }), undefined)
})

test('退出码 0 → ok:true，来源 exit-code', () => {
  const outcome = verifyOutcome({ result: { isError: false, value: { exitCode: 0 } }, command: 'npm test', verifyRe: re })
  assert.deepEqual(outcome, { ok: true, exitCode: 0, source: 'exit-code' })
})

test('退出码非 0 → ok:false（即使 isError 为 false）', () => {
  const outcome = verifyOutcome({ result: { isError: false, value: { exitCode: 1 } }, command: 'npm test', verifyRe: re })
  assert.equal(outcome?.ok, false)
  assert.equal(outcome?.exitCode, 1)
})

test('没有退出码时**不再**退回 isError（B1：工具成功 ≠ 命令成功）', () => {
  const outcome = verifyOutcome({ result: { isError: true, value: {} }, command: 'npm test', verifyRe: re })
  assert.equal(outcome?.ok, null)
  assert.equal(outcome?.source, 'is-error-unreliable')
})

test('非验证命令返回 undefined（不记账）', () => {
  assert.equal(verifyOutcome({ result: { isError: false, value: { exitCode: 0 } }, command: 'ls', verifyRe: re }), undefined)
})

test('结果不可判定时返回 ok:null（记 unknown，不冒充成功）', () => {
  const outcome = verifyOutcome({ result: {}, command: 'npm test', verifyRe: re })
  assert.equal(outcome?.ok, null)
  assert.equal(outcome?.source, 'unknown')
})

test('复合命令（管道/分号）退出码不可信 → ok:null', () => {
  const piped = verifyOutcome({
    result: { isError: false, value: { exitCode: 0 } },
    command: 'npm test 2>&1 | Select-Object -Last 4',
    verifyRe: re,
  })
  assert.equal(piped?.ok, null)
  assert.equal(piped?.source, 'ambiguous-shell')

  const chained = verifyOutcome({
    result: { isError: false, value: { exitCode: 0 } },
    command: 'npm test; echo done',
    verifyRe: re,
  })
  assert.equal(chained?.ok, null)
})

test('干净的单条命令才用退出码判定', () => {
  const clean = verifyOutcome({
    result: { isError: false, value: { exitCode: 1 } },
    command: 'npm test',
    verifyRe: re,
  })
  assert.equal(clean?.ok, false)
  assert.equal(clean?.exitCode, 1)
})
