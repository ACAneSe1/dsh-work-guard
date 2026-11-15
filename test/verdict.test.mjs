/** 待办判定测试（把数字翻译成动作）。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { headlineOf, verdictsOf } from '../lib/verdict.js'

test('什么都没发生 → 只有"没有待办"', () => {
  const list = verdictsOf({ unverified: 0, fixEvidence: { state: 'no-baseline' }, undeclared: { count: 0 }, gateActive: true })
  assert.equal(list.length, 1)
  assert.equal(list[0].level, 'ok')
  assert.equal(headlineOf(list), undefined)
})

test('改了没验证 → block，并给出动作', () => {
  const list = verdictsOf({ unverified: 3 })
  assert.equal(list[0].level, 'block')
  assert.match(list[0].title, /改了 3 处/)
  assert.match(list[0].action, /跑一次测试/)
})

test('红测试没转绿 → block，优先级高于未验证', () => {
  const list = verdictsOf({
    unverified: 2,
    fixEvidence: { state: 'red', stillFailing: ['test_add', 'test_sub'] },
  })
  assert.equal(list[0].level, 'block')
  assert.match(list[0].title, /2 条红测试/)
  assert.match(list[0].detail, /test_add/)
})

test('脚本改动未申报 → warn', () => {
  const list = verdictsOf({ undeclared: { count: 2 } })
  assert.equal(list[0].level, 'warn')
  assert.match(list[0].action, /work_declare/)
})

test('闸门未生效 → warn', () => {
  const list = verdictsOf({ gateActive: false })
  assert.equal(list[0].level, 'warn')
  assert.match(list[0].title, /没有经过闸门/)
})

test('headline 只取第一条非 ok', () => {
  const list = verdictsOf({ unverified: 1, undeclared: { count: 1 }, gateActive: false })
  assert.equal(list.length, 3)
  assert.equal(headlineOf(list)?.level, 'block')
})

test('空输入不抛', () => {
  assert.equal(verdictsOf().length, 1)
  assert.equal(verdictsOf().at(0).level, 'ok')
})
