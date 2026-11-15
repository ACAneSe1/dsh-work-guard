/**
 * 第 2 步：闸门两个新洞的测试。
 *   1. 读的新鲜度：读完文件后文件被改 → 拒绝
 *   2. 读的深度：只读了前几行却改后面的行 → 拒绝；整文件读过 → 放行
 */
import { strict as assert } from 'node:assert'
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { __internals as g } from '../index.js'
import { makeTmp } from './helpers/tmp.mjs'

const dir = makeTmp('wg-depth-')

function makeFile(name, lines) {
  const file = join(dir, name)
  writeFileSync(file, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n', 'utf8')
  return file
}

function reset() {
  g.READ_FILES.clear()
  g.READ_META?.clear?.()
}

test('只读了前 5 行，改第 30 行 → 拒绝（read-depth）', async () => {
  reset()
  const file = makeFile('partial.kt', 60)
  g.recordRead({ name: 'read', arguments: { file_path: file, offset: 1, limit: 5 } })

  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: file, old_string: 'line 30', new_string: 'line 30 changed' },
  })
  assert.equal(decision?.kind, 'deny')
  assert.match(String(decision?.reason), /outside the range you read/)
})

test('整文件读过之后再改任何一行 → 放行', async () => {
  reset()
  const file = makeFile('full.kt', 40)
  g.recordRead({ name: 'read', arguments: { file_path: file } })

  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: file, old_string: 'line 35', new_string: 'line 35 changed' },
  })
  assert.equal(decision, undefined)
})

test('读完文件后文件被改（mtime 晚于读）→ 拒绝（read-freshness）', async () => {
  reset()
  const file = makeFile('stale.kt', 20)
  g.recordRead({ name: 'read', arguments: { file_path: file } })
  // 把"读的时间"改成 30 秒前，再让 mtime 落在读之后、现在之前 —— 这才是"读完又被改"
  const key = [...g.READ_META.keys()].find(k => k.endsWith('stale.kt'))
  g.READ_META.set(key, { ...g.READ_META.get(key), at: Date.now() - 30_000 })
  const modified = new Date(Date.now() - 5_000)
  utimesSync(file, modified, modified)

  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: file, old_string: 'line 3', new_string: 'line 3 changed' },
  })
  assert.equal(decision?.kind, 'deny')
  assert.match(String(decision?.reason), /changed after you read it/)
})

test('mtime 在未来（时钟漂移）不算"被改" —— 夹到当前时间后放行', async () => {
  reset()
  const file = makeFile('future.kt', 10)
  g.recordRead({ name: 'read', arguments: { file_path: file } })
  // 关键：把"读的时间"推到 30 秒前。旧实现（把 mtime 夹到 now）在这种情况下仍会误拒，
  // 因为 now - readAt 远超容差；正确实现应当识别"未来 mtime 不可能是真实修改"。
  const key = [...g.READ_META.keys()].find(k => k.endsWith('future.kt'))
  g.READ_META.set(key, { ...g.READ_META.get(key), at: Date.now() - 30_000 })
  const future = new Date(Date.now() + 60_000)
  utimesSync(file, future, future)

  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: file, old_string: 'line 5', new_string: 'line 5 changed' },
  })
  assert.equal(decision, undefined)
})

test('整份覆盖已存在文件、但只读过一部分 → 拒绝（read-depth / write）', async () => {
  reset()
  const file = makeFile('overwrite.kt', 30)
  g.recordRead({ name: 'read', arguments: { file_path: file, offset: 1, limit: 3 } })

  const decision = await g.gate({
    name: 'write',
    arguments: { file_path: file, content: 'val x = 1\n' },
  })
  assert.equal(decision?.kind, 'deny')
  assert.match(String(decision?.reason), /wholesale|whole file/)
})

test('新建文件不受 read-depth 约束（没有可读的内容）', async () => {
  reset()
  const decision = await g.gate({
    name: 'write',
    arguments: { file_path: join(dir, 'brand-new.kt'), content: 'val a = 1\n' },
  })
  assert.equal(decision, undefined)
})
