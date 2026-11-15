/** work_verify 内核测试：命令探测、结果压缩。 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { detectVerifyCommand, renderSummary, summarizeRun } from '../lib/verify-tool.js'
import { makeTmp } from './helpers/tmp.mjs'

test('有 package.json 且有 test 脚本 → npm test', () => {
  const dir = makeTmp('wg-cmd-')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8')
  assert.deepEqual(detectVerifyCommand(dir), { command: 'npm test', source: 'package.json#scripts.test' })
})

test('package.json 没有 test 脚本 → 不当证据，继续往下探', () => {
  const dir = makeTmp('wg-cmd2-')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {} }), 'utf8')
  assert.equal(detectVerifyCommand(dir), undefined)
})

test('gradle 项目 → gradlew', () => {
  const dir = makeTmp('wg-cmd3-')
  writeFileSync(join(dir, 'gradlew.bat'), '', 'utf8')
  assert.equal(detectVerifyCommand(dir)?.command, 'gradlew.bat test')
})

test('探测不到就返回 undefined（不猜）', () => {
  const dir = makeTmp('wg-cmd4-')
  assert.equal(detectVerifyCommand(dir), undefined)
})

test('通过的运行 → ok，summary 简洁', () => {
  const text = ['ℹ tests 133', 'ℹ pass 133', 'ℹ fail 0'].join('\n')
  const summary = summarizeRun({ text, exitCode: 0 })
  assert.equal(summary.ok, true)
  assert.equal(summary.total, 133)
  const rendered = renderSummary(summary, 'npm test')
  assert.match(rendered, /✓ 通过/)
  assert.match(rendered, /共 133/)
})

test('失败的运行 → 带失败用例名', () => {
  const text = ['✖ 故意失败 (1.2ms)', 'ℹ tests 3', 'ℹ pass 2', 'ℹ fail 1'].join('\n')
  const summary = summarizeRun({ text, exitCode: 1 })
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.failed, ['故意失败'])
  const rendered = renderSummary(summary, 'npm test')
  assert.match(rendered, /✖ 失败（exit 1）/)
  assert.match(rendered, /故意失败/)
})

test('超时不算通过', () => {
  const summary = summarizeRun({ text: '', exitCode: null, timedOut: true })
  assert.equal(summary.ok, false)
  assert.match(renderSummary(summary, 'npm test'), /超时/)
})

test('失败时给出第一处位置（node --test 的 test at file:line）', () => {
  const text = [
    '✖ 故意失败 (1.2ms)',
    '',
    'test at fail.test.mjs:4:1',
    '✖ 故意失败 (1.2ms)',
    '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
    '  1 !== 2',
  ].join('\n')
  const summary = summarizeRun({ text, exitCode: 1 })
  assert.deepEqual(summary.location, { file: 'fail.test.mjs', line: 4 })
  const rendered = renderSummary(summary, 'npm test')
  assert.match(rendered, /位置：fail\.test\.mjs:4/)
  assert.match(rendered, /AssertionError/)
})

test('失败时给出位置（pytest 的 file:line:）', () => {
  const text = ['FAILED tests/test_x.py::test_add', 'tests/test_x.py:42: AssertionError'].join('\n')
  const summary = summarizeRun({ text, exitCode: 1 })
  assert.equal(summary.location?.line, 42)
})

test('没有位置信息时不编造（渲染里不出现"位置"）', () => {
  const summary = summarizeRun({ text: 'BUILD FAILED', exitCode: 1 })
  assert.equal(summary.location, undefined)
  assert.ok(!renderSummary(summary, 'gradlew test').includes('位置'))
})

test('渲染结果不含整段日志（只给结论）', () => {
  const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
  const rendered = renderSummary(summarizeRun({ text: long, exitCode: 1 }), 'npm test')
  assert.ok(rendered.split('\n').length <= 6, `渲染应当很短，实际 ${rendered.split('\n').length} 行`)
})
