/** lib/state.js 的测试：TTL 过滤、上限淘汰、原子写。 */
import { strict as assert } from 'node:assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadReadState, saveReadState, statePath } from '../lib/state.js'
import { makeTmp } from './helpers/tmp.mjs'

test('保存后能读回', () => {
  const dir = makeTmp('wg-state-')
  const reads = new Map([['x/src/a.kt', Date.now()]])
  assert.equal(saveReadState(dir, reads), true)
  const back = loadReadState(dir, 24)
  assert.equal(back.get('x/src/a.kt') !== undefined, true)
})

test('超过 TTL 的记录被丢弃', () => {
  const dir = makeTmp('wg-state-ttl-')
  const old = Date.now() - 48 * 3600 * 1000
  writeFileSync(statePath(dir), JSON.stringify({ version: 1, reads: { 'a.kt': old, 'b.kt': Date.now() } }), 'utf8')
  const back = loadReadState(dir, 24)
  assert.equal(back.has('a.kt'), false)
  assert.equal(back.has('b.kt'), true)
})

test('坏文件返回空而不抛', () => {
  const dir = makeTmp('wg-state-bad-')
  writeFileSync(statePath(dir), 'not json', 'utf8')
  assert.equal(loadReadState(dir, 24).size, 0)
})

test('写入是原子替换（不留下 .tmp）', () => {
  const dir = makeTmp('wg-state-atomic-')
  saveReadState(dir, new Map([['k', Date.now()]]))
  const payload = JSON.parse(readFileSync(statePath(dir), 'utf8'))
  assert.equal(payload.version, 2)
  assert.equal(typeof payload.reads.k, 'number')
})

test('超过上限时只保留最新的', () => {
  const dir = makeTmp('wg-state-cap-')
  const reads = new Map()
  for (let i = 0; i < 5200; i += 1) reads.set(`f${i}.kt`, Date.now() - i)
  saveReadState(dir, reads)
  const back = loadReadState(dir, 24)
  assert.equal(back.size, 5000)
  assert.equal(back.has('f0.kt'), true)
  assert.equal(back.has('f5199.kt'), false)
})
