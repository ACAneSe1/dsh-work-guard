/**
 * 绕过扫描测试（复审 P1-5：scan 之前零测试，而它是最容易出错的文件系统遍历）。
 */
import { strict as assert } from 'node:assert'
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { append, configureLedger, tail } from '../lib/ledger.js'
import { scanBypassWrites } from '../lib/scan.js'
import { makeTmp } from './helpers/tmp.mjs'

function setup(name) {
  const dir = makeTmp(`wg-scan-${name}-`)
  configureLedger(join(dir, 'work-ledger.jsonl'), { rotateAtRows: 5000 })
  return dir
}

const isSource = name => name.endsWith('.ts')

test('刚改过、且台账里没有对应写入的源码 → 记一条 bypass', () => {
  const dir = setup('hit')
  writeFileSync(join(dir, 'a.ts'), 'export {}\n', 'utf8')

  const written = scanBypassWrites({ command: 'python patch.py', roots: [dir], isSourceFile: isSource })
  assert.equal(written, 1)
  const rows = tail(5)
  assert.equal(rows.at(-1).kind, 'bypass')
  assert.match(rows.at(-1).file, /a\.ts$/)
})

test('60 秒内同文件再次扫描不会重复记', () => {
  const dir = setup('dedupe')
  writeFileSync(join(dir, 'b.ts'), 'export {}\n', 'utf8')
  scanBypassWrites({ command: 'cmd 1', roots: [dir], isSourceFile: isSource })
  const second = scanBypassWrites({ command: 'cmd 2', roots: [dir], isSourceFile: isSource })
  assert.equal(second, 0)
})

test('台账里已有 write 记录的同一文件不算绕过', () => {
  const dir = setup('covered')
  const file = join(dir, 'c.ts')
  writeFileSync(file, 'export {}\n', 'utf8')
  append({ kind: 'write', file: file.replace(/\\/g, '/') })

  const written = scanBypassWrites({ command: 'cmd', roots: [dir], isSourceFile: isSource })
  assert.equal(written, 0)
})

test('早于 floorMs 修改的文件不算本次绕过（复审 P2-6）', () => {
  const dir = setup('floor')
  const file = join(dir, 'old.ts')
  writeFileSync(file, 'export {}\n', 'utf8')
  const old = new Date(Date.now() - 5 * 60_000)
  utimesSync(file, old, old)

  const written = scanBypassWrites({
    command: 'cmd', roots: [dir], isSourceFile: isSource, floorMs: Date.now() - 60_000,
  })
  assert.equal(written, 0)
})

test('非源码后缀不记', () => {
  const dir = setup('ext')
  writeFileSync(join(dir, 'notes.md'), '# n\n', 'utf8')
  const written = scanBypassWrites({ command: 'cmd', roots: [dir], isSourceFile: isSource })
  assert.equal(written, 0)
})
