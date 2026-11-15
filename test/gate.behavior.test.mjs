/**
 * 闸门的真实行为测试：不是纯函数，而是走 gate() 的拒绝/放行两条路。
 *
 * 这五条覆盖今天翻车过的情形：
 *   1. 没读过就写 → 拒绝
 *   2. 读过再写 → 放行
 *   3. 文档里的代码片段（反引号包裹）不算违规
 *   4. 真代码里的无 key 缓存 → 拒绝
 *   5. 非源码文件不管
 *
 * 注：本文件里出现的坏写法是**测试样本**，按法条 7 章在行尾加破例标记。
 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { __internals as g } from '../index.js'
import { makeTmp } from './helpers/tmp.mjs'

const dir = makeTmp('work-guard-')

function freshSource(name, content) {
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  g.READ_FILES.clear()
  return file
}

test('没读过就写：拒绝', async () => {
  const file = freshSource('Unread.kt', 'val a = 1\n')
  const decision = await g.gate({ name: 'edit', arguments: { file_path: file, old_string: 'val a = 1', new_string: 'val a = 2' } })
  assert.equal(decision?.kind, 'deny')
  assert.match(String(decision?.reason), /read before write/i)
})

test('读过再写：放行', async () => {
  const file = freshSource('Read.kt', 'val a = 1\n')
  g.recordRead({ name: 'read', arguments: { file_path: file } })
  const decision = await g.gate({ name: 'edit', arguments: { file_path: file, old_string: 'val a = 1', new_string: 'val a = 2' } })
  assert.equal(decision, undefined)
})

test('文档里的代码片段不算违规（反引号剥掉）', async () => {
  const file = freshSource('Doc.kt', '// placeholder\n')
  g.recordRead({ name: 'read', arguments: { file_path: file } })
  const docLine = 'val msg = "用 `remember { derivedStateOf { x } }` 是错的"\n' // work-guard: allow
  const decision = await g.gate({ name: 'write', arguments: { file_path: file, content: docLine } })
  assert.equal(decision, undefined)
})

test('真代码里的无 key 缓存：拒绝', async () => {
  const file = freshSource('Bad.kt', '// placeholder\n')
  g.recordRead({ name: 'read', arguments: { file_path: file } })
  const bad = 'val ids by remember { derivedStateOf { tasks.map { it.id } } }\n' // work-guard: allow
  const decision = await g.gate({ name: 'write', arguments: { file_path: file, content: bad } })
  assert.equal(decision?.kind, 'deny')
  assert.match(String(decision?.reason), /never recomputes/i)
})

test('非源码文件不管（.md 不需要先读）', async () => {
  const file = join(dir, 'notes.md')
  writeFileSync(file, '# n\n', 'utf8')
  g.READ_FILES.clear()
  const decision = await g.gate({ name: 'write', arguments: { file_path: file, content: '# x\n' } })
  assert.equal(decision, undefined)
})
