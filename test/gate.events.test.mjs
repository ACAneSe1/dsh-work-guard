/**
 * 闸门与「看得见」的测试（2026-11-14 新增）。
 *
 * 两件事必须能验：
 *   1. 相对路径的新建文件不该被挡，但"没有已知根 + 相对路径 + 未读"要 fail-closed。
 *   2. 拒绝要留痕（台账 + lastEvent），否则界面上等于静默。
 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { __internals as g } from '../index.js'
import { makeTmp } from './helpers/tmp.mjs'

const dir = makeTmp('wg-gate2-')

function reset() {
  g.READ_FILES.clear()
}

test('没有已知根 + 相对路径 + 未读：拒绝（fail-closed）', async () => {
  reset()
  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: 'some/project/src/Unknown.kt', old_string: 'a', new_string: 'b' },
  })
  assert.equal(decision?.kind, 'deny')
})

test('已知根下、候选都不存在：当作新建，放行', async () => {
  reset()
  // 先读一个真实文件，让闸门记住它的父目录
  const anchor = join(dir, 'Anchor.kt')
  writeFileSync(anchor, 'val a = 1\n', 'utf8')
  g.recordRead({ name: 'read', arguments: { file_path: anchor } })

  const decision = await g.gate({
    name: 'write',
    arguments: { file_path: join(dir, 'Brand-new.kt'), content: 'val b = 2\n' },
  })
  assert.equal(decision, undefined)
})

test('拒绝会记一条 deny 台账，并留下 lastEvent', async () => {
  reset()
  // 绝对路径 + 文件确实存在 + 没读过 → 必须拒绝（这条不受"已知根"影响）
  const target = join(dir, 'Existing-unread.kt')
  writeFileSync(target, 'val old = 1\n', 'utf8')

  const before = g.guardStatus().lastEvent
  const decision = await g.gate({
    name: 'edit',
    arguments: { file_path: target, old_string: 'val old = 1', new_string: 'val old = 2' },
  })
  assert.equal(decision?.kind, 'deny')
  const after = g.guardStatus().lastEvent
  assert.notEqual(after, before)
  assert.equal(after?.kind, 'deny')
  assert.equal(typeof after?.rule, 'string')
})

test('状态里能看到规则清单（含语言声明）与 lastEvent 字段', () => {
  const status = g.guardStatus()
  assert.ok(Array.isArray(status.rules))
  const ids = status.rules.map(rule => rule.id)
  assert.ok(ids.includes('read-before-write'))
  // 第 3 步：Kotlin 专用规则会带上 languages 声明
  const kotlinRule = status.rules.find(rule => rule.id === 'no-unkeyed-derived-state')
  assert.deepEqual(kotlinRule?.languages, ['kotlin'])
  assert.ok('lastEvent' in status)
})
