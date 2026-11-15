/** lib/time.js 的测试：本地时区派生 + 老记录兼容。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { entryTime, localClock, localDay, nowParts } from '../lib/time.js'

test('localDay 用本地时区，不是 UTC', () => {
  // 2026-11-14 00:30 本地 —— UTC 会是 11-13，这就是原来面板跳变的原因
  const local = new Date(2026, 10, 14, 0, 30, 0)
  assert.equal(localDay(local), '2026-11-14')
})

test('localClock 补零', () => {
  assert.equal(localClock(new Date(2026, 10, 14, 9, 5, 0)), '09:05')
})

test('nowParts 同时给 ts 与派生字段', () => {
  const d = new Date(2026, 10, 14, 18, 40, 0)
  const parts = nowParts(d)
  assert.equal(parts.ts, d.getTime())
  assert.equal(parts.day, '2026-11-14')
  assert.equal(parts.t, '18:40')
})

test('entryTime 优先 ts', () => {
  assert.equal(entryTime({ ts: 1794656070764, day: '2020-01-01', t: '00:00' }), 1794656070764)
})

test('entryTime 兼容只有 day/t 的老记录（按 UTC 解释）', () => {
  const t = entryTime({ day: '2026-11-14', t: '11:22' })
  assert.ok(t > 0)
  // 老记录的 day/t 由 toISOString() 生成，是 UTC 的钟点；按本地解释会差 8 小时
  assert.equal(new Date(t).getUTCHours(), 11)
  assert.equal(new Date(t).getUTCMinutes(), 22)
})

test('entryTime 坏数据返回 0 而不是 NaN', () => {
  assert.equal(entryTime({}), 0)
  assert.equal(entryTime(undefined), 0)
})
