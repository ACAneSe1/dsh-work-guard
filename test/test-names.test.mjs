/** 红→绿证据的解析层测试。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { failingTests, resultText } from '../lib/testNames.js'

test('node --test 的 TAP 格式：抽 not ok 的名字', () => {
  const out = [
    'TAP version 13',
    'not ok 1 - 故意失败',
    'ok 2 - 这个通过',
    'not ok 3 - 另一个失败 (1.2ms)',
  ].join('\n')
  const { names, parser } = failingTests(out)
  assert.deepEqual(names, ['故意失败', '另一个失败 (1.2ms)'])
  assert.equal(parser, 'node-tap')
})

test('node --test 的 spec 格式：抽 ✖ 名字', () => {
  const out = ['✔ 通过 (1ms)', '✖ 故意失败 (1.7ms)'].join('\n')
  const { names, parser } = failingTests(out)
  assert.deepEqual(names, ['故意失败'])
  assert.equal(parser, 'node-spec')
})

test('pytest 格式：抽 FAILED 的用例路径', () => {
  const out = ['FAILED tests/test_x.py::test_add - AssertionError: 1 != 2'].join('\n')
  const { names, parser } = failingTests(out)
  assert.deepEqual(names, ['tests/test_x.py::test_add'])
  assert.equal(parser, 'pytest')
})

test('go test 格式：抽 --- FAIL 的名字', () => {
  const out = ['--- FAIL: TestAdd (0.00s)', '--- PASS: TestSub (0.00s)'].join('\n')
  const { names, parser } = failingTests(out)
  assert.deepEqual(names, ['TestAdd'])
  assert.equal(parser, 'go-test')
})

test('没有任何失败标记时返回空（不猜）', () => {
  const out = ['ℹ tests 84', 'ℹ pass 84', 'ℹ fail 0'].join('\n')
  const { names } = failingTests(out)
  assert.deepEqual(names, [])
})

test('去重：同一用例名只留一次', () => {
  const out = ['not ok 1 - 同一个', 'not ok 2 - 同一个'].join('\n')
  const { names } = failingTests(out)
  assert.deepEqual(names, ['同一个'])
})

test('resultText 能从嵌套结构里捞出文本', () => {
  const result = {
    value: { output: 'not ok 1 - 失败', nested: { lines: ['a', 'b'] } },
    content: [{ text: '✖ 另一个' }],
  }
  const text = resultText(result)
  assert.match(text, /not ok 1 - 失败/)
  assert.match(text, /另一个/)
})

test('resultText 对空结果返回空串', () => {
  assert.equal(resultText({}), '')
  assert.equal(resultText(undefined), '')
})
