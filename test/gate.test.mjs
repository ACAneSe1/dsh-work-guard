/**
 * 基础单元测试（第 3 批后：判定逻辑已搬到 lib/rules 与 lib/paths，
 * 所以这里直接测那些模块，而不是测 index 的内部函数）。
 *
 * 注意：本文件里的"坏写法"是测试样本，按规则自带的方式加破例标记。
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { normPath, pathTail, keyOf } from '../lib/paths.js'
import { findViolations } from '../lib/rules/no-unkeyed-derived-state.js'
import { __internals as g } from '../index.js'

test('keyOf：相对路径按工作目录绝对化后与绝对路径一致', () => {
  const rel = keyOf('app/src/main.ts', '/work/proj-a')
  const abs = keyOf('/work/proj-a/app/src/main.ts', '/work/proj-a')
  assert.equal(rel, abs)
})

test('两个项目里的同名文件 keyOf 不同（旧"尾部 3 段"做法会把它们认成一个）', () => {
  const a = keyOf('proj-a/app/src/main.ts', '/work')
  const b = keyOf('proj-b/app/src/main.ts', '/work')
  assert.notEqual(a, b)
})

test('源码后缀识别', () => {
  assert.equal(g.isSourcePath('X.kt'), true)
  assert.equal(g.isSourcePath('X.md'), false)
  assert.equal(g.isSourcePath('X.KT'), true)
})

test('无 key 的 derivedStateOf 会被抓出来（单行与换行两种写法）', () => {
  const oneLine = 'val x by remember { derivedStateOf { list.size } }' // work-guard: allow
  assert.equal(findViolations(oneLine).length, 1)

  const wrapped = ['val x by remember {', '    derivedStateOf { list.size }', '}'].join('\n')
  assert.equal(findViolations(wrapped).length, 1)

  const correct = 'val x = remember(list) { list.size }'
  assert.equal(findViolations(correct).length, 0)
})

test('破例标记能让那一行通过', () => {
  const line = 'val x by remember { derivedStateOf { list.size } } // work-guard: allow' // work-guard: allow
  assert.equal(findViolations(line).length, 0)
})
