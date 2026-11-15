/**
 * 状态口径回归测试（2026-11-14）。
 *
 * 这里保护的是一个**接线错误**，不是逻辑错误：`guardStatus()` 曾经把整张台账
 * 交给 undeclaredChanges，导致状态条上出现 289 条历史欠账。
 * 单测覆盖 lib 时永远发现不了——它错在"调用处传了哪个数组"。
 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { append, configureLedger } from '../lib/ledger.js'
import { __internals as g } from '../index.js'
import { makeTmp } from './helpers/tmp.mjs'

test('未申报只统计本次启动之后的脚本改动（历史欠账不算）', () => {
  const dir = makeTmp('wg-status-')
  configureLedger(join(dir, 'work-ledger.jsonl'), { rotateAtRows: 1000 })

  // 一条"历史"记改：把 ts 放到插件启动之前
  append({ kind: 'bypass', file: 'old/Historical.kt', ts: 1 })
  // 一条本次的记改：不带 ts，走 append 的默认 now
  append({ kind: 'bypass', file: 'now/Fresh.kt' })

  const status = g.guardStatus()
  assert.equal(status.undeclared.count, 1, '只应报告 1 条（本次的那条）')
  assert.ok(status.undeclared.files.some(file => String(file).includes('Fresh.kt')))
})

test('申报之后该条欠账消失', () => {
  const dir = makeTmp('wg-status2-')
  configureLedger(join(dir, 'work-ledger.jsonl'), { rotateAtRows: 1000 })

  append({ kind: 'bypass', file: 'now/Fresh2.kt' })
  assert.equal(g.guardStatus().undeclared.count, 1)

  append({ kind: 'declare', files: ['now/Fresh2.kt'], why: '测试' })
  assert.equal(g.guardStatus().undeclared.count, 0)
})

test('文件已删除时：欠账仍在，但标成 missing', () => {
  const dir = makeTmp('wg-status3-')
  configureLedger(join(dir, 'work-ledger.jsonl'), { rotateAtRows: 1000 })

  // 不存在的绝对路径：模拟"脚本改过、之后被删掉了"
  append({ kind: 'bypass', file: join(dir, 'gone', 'Deleted.kt') })
  const status = g.guardStatus()
  assert.equal(status.undeclared.count, 1, '事实发生过，欠账仍应存在')
  assert.equal(status.undeclared.missing, 1, '但要点明文件已经不在了')
  assert.equal(status.undeclared.items[0].exists, false)
})

test('真实存在的文件不会被标成 missing', () => {
  const dir = makeTmp('wg-status4-')
  configureLedger(join(dir, 'work-ledger.jsonl'), { rotateAtRows: 1000 })

  const file = join(dir, 'Real.kt')
  writeFileSync(file, 'val a = 1\n', 'utf8')
  append({ kind: 'bypass', file })
  const status = g.guardStatus()
  assert.equal(status.undeclared.count, 1)
  assert.equal(status.undeclared.missing, 0)
  assert.equal(status.undeclared.items[0].exists, true)
})
