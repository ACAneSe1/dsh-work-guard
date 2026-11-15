/**
 * 台账测试（复审 P1-5：之前台账 IO 零测试，而它是最脆的一块）。
 */
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { append, configureLedger, ledgerFile, rotateIfNeeded, tail } from '../lib/ledger.js'
import { makeTmp } from './helpers/tmp.mjs'

function freshLedger(name = 'ledger') {
  const dir = makeTmp(`wg-${name}-`)
  const file = join(dir, 'work-ledger.jsonl')
  configureLedger(file, { rotateAtRows: 5000 })
  return file
}

test('append 写入 v2 记录，带 ts 与本地 day/t', () => {
  const file = freshLedger('append')
  assert.equal(append({ kind: 'edit', file: 'src/a.ts', lines: 3 }), true)
  const row = JSON.parse(readFileSync(file, 'utf8').trim())
  assert.equal(row.v, 2)
  assert.equal(typeof row.ts, 'number')
  assert.equal(row.kind, 'edit')
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/)
})

test('tail 返回最近 N 条，并可按文件片段过滤', () => {
  const file = freshLedger('tail')
  for (let i = 0; i < 5; i += 1) append({ kind: 'write', file: `src/f${i}.ts` })
  assert.equal(tail(3).length, 3)
  assert.equal(tail(10, 'f1.ts').length, 1)
})

test('没有配置路径时不写文件、也不抛', () => {
  configureLedger('', {})
  assert.equal(append({ kind: 'edit', file: 'x' }), false)
  assert.equal(tail(5).length, 0)
})

test('超过阈值时轮转：原文件整体变 .1，之后可继续写', () => {
  const dir = makeTmp('wg-rotate-')
  const file = join(dir, 'work-ledger.jsonl')
  configureLedger(file, { rotateAtRows: 10 })
  // 2026-11-14 修：判据改成**行数**。旧实现按字节估算，还会先建空备份再 rename，
  // 在 Windows 上 rename 失败 → 只剩一个空 .1（实测发现）。
  const rows = Array.from({ length: 12 }, (_, i) => JSON.stringify({ v: 2, kind: 'write', file: `f${i}.ts` }))
  writeFileSync(file, rows.join('\n') + '\n', 'utf8')

  const rotated = rotateIfNeeded()
  assert.equal(rotated, true)
  assert.equal(existsSync(`${file}.1`), true)
  // 备份里必须是完整的历史，不能是空文件
  const backup = readFileSync(`${file}.1`, 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(backup.length, 12)

  // 轮转之后还能继续写
  assert.equal(append({ kind: 'edit', file: 'after.ts' }), true)
  assert.equal(tail(1).length, 1)
})

test('行数没到阈值时，即使单行很长也不轮转', () => {
  const dir = makeTmp('wg-rotate2-')
  const file = join(dir, 'work-ledger.jsonl')
  configureLedger(file, { rotateAtRows: 10 })
  writeFileSync(file, JSON.stringify({ v: 2, kind: 'write', file: 'x'.repeat(4000) }) + '\n', 'utf8')
  assert.equal(rotateIfNeeded(), false)
})

test('ledgerFile 返回当前路径', () => {
  const file = freshLedger('path')
  assert.equal(ledgerFile(), file)
})
