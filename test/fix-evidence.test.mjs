/** 红→绿证据的判定测试。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { describeFixEvidence, fixEvidence } from '../lib/fix-evidence.js'

const red = (ts, names) => ({ kind: 'verify', ts, ok: false, failed: names })
const green = ts => ({ kind: 'verify', ts, ok: true, failed: [] })

test('没有基线：没跑过会失败的测试', () => {
  const evidence = fixEvidence([green(1), green(2)])
  assert.equal(evidence.state, 'no-baseline')
  assert.equal(describeFixEvidence(evidence), '没有红测试基线')
})

test('红之后没再跑：仍然是红', () => {
  const evidence = fixEvidence([red(1, ['用例 A'])])
  assert.equal(evidence.state, 'red')
  assert.deepEqual(evidence.stillFailing, ['用例 A'])
})

test('红之后跑绿：判为 green', () => {
  const evidence = fixEvidence([red(1, ['用例 A']), green(2)])
  assert.equal(evidence.state, 'green')
  assert.equal(evidence.greenAt, 2)
})

test('红之后又红（换了用例）：仍然是红，且报告最新失败用例', () => {
  const evidence = fixEvidence([red(1, ['用例 A']), red(3, ['用例 B'])])
  assert.equal(evidence.state, 'red')
  assert.deepEqual(evidence.stillFailing, ['用例 B'])
})

test('红之后跑绿、再跑红：以最近的基线为准', () => {
  const evidence = fixEvidence([red(1, ['A']), green(2), red(3, ['C'])])
  assert.equal(evidence.state, 'red')
  assert.equal(evidence.baseline.ts, 3)
})

test('通过但带失败用例（复合命令）不算转绿', () => {
  const mixed = { kind: 'verify', ts: 2, ok: true, failed: ['用例 A'] }
  const evidence = fixEvidence([red(1, ['用例 A']), mixed])
  assert.equal(evidence.state, 'red')
})

test('没有 failed 字段的旧记录不构成基线', () => {
  const legacy = { kind: 'verify', ts: 1, ok: false }
  assert.equal(fixEvidence([legacy, green(2)]).state, 'no-baseline')
})
