/** 申报机制测试：脚本改动要么被申报，要么一直显示为欠账。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DECLARE_WINDOW_MS, undeclaredChanges } from '../lib/declare.js'

const bypass = (ts, file) => ({ kind: 'bypass', ts, file })
const declare = (ts, files) => ({ kind: 'declare', ts, files })

test('没有申报：所有 bypass 都是欠账', () => {
  const { undeclared } = undeclaredChanges([bypass(1000, 'a/A.kt'), bypass(2000, 'b/B.kt')])
  assert.equal(undeclared.length, 2)
})

test('申报之后覆盖：不算欠账', () => {
  const rows = [bypass(1000, 'a/A.kt'), declare(2000, ['a/A.kt'])]
  assert.deepEqual(undeclaredChanges(rows).undeclared, [])
})

test('申报早于改动：不能覆盖（顺序很重要）', () => {
  const rows = [declare(1000, ['a/A.kt']), bypass(2000, 'a/A.kt')]
  assert.equal(undeclaredChanges(rows).undeclared.length, 1)
})

test('超出申报窗口：不能覆盖', () => {
  const rows = [bypass(1000, 'a/A.kt'), declare(1000 + DECLARE_WINDOW_MS + 1, ['a/A.kt'])]
  assert.equal(undeclaredChanges(rows).undeclared.length, 1)
})

test('只申报了部分文件：剩下的仍是欠账', () => {
  const rows = [bypass(1000, 'a/A.kt'), bypass(1000, 'a/B.kt'), declare(2000, ['a/A.kt'])]
  const { undeclared } = undeclaredChanges(rows)
  assert.equal(undeclared.length, 1)
  assert.equal(undeclared[0].file, 'a/B.kt')
})

test('路径斜杠与大小写不同也能匹配', () => {
  const rows = [bypass(1000, 'A\\a.KT'), declare(2000, ['a/a.kt'])]
  assert.deepEqual(undeclaredChanges(rows).undeclared, [])
})

test('没有 file 的 bypass 记录被忽略（不制造假欠账）', () => {
  const rows = [{ kind: 'bypass', ts: 1000 }]
  assert.deepEqual(undeclaredChanges(rows).undeclared, [])
})

test('declaredCount 反映申报次数', () => {
  const rows = [declare(1000, ['a/A.kt']), declare(2000, ['b/B.kt'])]
  assert.equal(undeclaredChanges(rows).declaredCount, 2)
})
