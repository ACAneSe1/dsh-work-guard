/**
 * 统计口径测试（第 1 步：让面板数字可信）。
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { computeStats } from '../lib/stats.js'

const day = '2026-11-14'
const base = new Date(2026, 10, 14, 10, 0, 0).getTime()

function row(kind, offsetMs, extra = {}) {
  const d = new Date(base + offsetMs)
  const p = n => String(n).padStart(2, '0')
  return {
    kind,
    ts: d.getTime(),
    day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    t: `${p(d.getHours())}:${p(d.getMinutes())}`,
    ...extra,
  }
}

const rows = [
  row('write', 0),          // 历史（启动前）
  row('bypass', 1000),      // 历史
  row('edit', 60_000),      // 启动后
  row('verify', 120_000),   // 启动后
  row('bypass', 180_000),   // 启动后
]

test('since：只算本次启动之后的记录', () => {
  const stats = computeStats(rows, { getTime: r => r.ts, sinceTs: base + 30_000, today: day })
  assert.equal(stats.since.edits, 1)
  assert.equal(stats.since.verifies, 1)
  assert.equal(stats.since.bypass, 1)
})

test('today：算当天全量（含启动前）', () => {
  const stats = computeStats(rows, { getTime: r => r.ts, sinceTs: base + 30_000, today: day })
  assert.equal(stats.today.edits, 2)
  assert.equal(stats.today.bypass, 2)
})

test('unverified：最后一次验证之后的改动数', () => {
  const stats = computeStats(rows, { getTime: r => r.ts, sinceTs: base + 30_000, today: day })
  assert.equal(stats.since.unverified, 0) // 验证之后没有改动
  assert.equal(stats.today.unverified, 0)
})

test('验证之后又改动 → 计入未验证', () => {
  const more = [...rows, row('edit', 240_000)]
  const stats = computeStats(more, { getTime: r => r.ts, sinceTs: base + 30_000, today: day })
  assert.equal(stats.since.unverified, 1)
})

test('没有任何验证 → 所有改动都算未验证', () => {
  const only = [row('edit', 60_000), row('write', 90_000)]
  const stats = computeStats(only, { getTime: r => r.ts, sinceTs: 0, today: day })
  assert.equal(stats.since.unverified, 2)
})

test('deny 单独计数（被拦下的写入）', () => {
  const withDeny = [row('deny', 60_000), row('edit', 90_000)]
  const stats = computeStats(withDeny, { getTime: r => r.ts, sinceTs: 0, today: day })
  assert.equal(stats.since.denies, 1)
  assert.equal(stats.today.denies, 1)
})

test('lifetime 反映台账总行数', () => {
  const stats = computeStats(rows, { getTime: r => r.ts, sinceTs: 0, today: day })
  assert.equal(stats.lifetime.rows, rows.length)
})
