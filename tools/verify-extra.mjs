/**
 * 补测：台账轮转 / 配置文件生效 / 并发写台账（2026-11-14）。
 *
 * 全部在临时目录里进行，不碰真实台账。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { append, configureLedger, rotateIfNeeded } from '../lib/ledger.js'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}

// ---------- ③ 台账轮转 ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'wg-rot-'))
  const file = join(dir, 'work-ledger.jsonl')
  configureLedger(file, { rotateAtRows: 10 })
  for (let i = 0; i < 25; i += 1) append({ kind: 'write', file: `f${i}.ts` })

  const rotated = rotateIfNeeded()
  const backup = existsSync(`${file}.1`)
    ? readFileSync(`${file}.1`, 'utf8').trim().split('\n').filter(Boolean)
    : []
  const allValid = backup.every(line => {
    try {
      JSON.parse(line)
      return true
    } catch {
      return false
    }
  })
  append({ kind: 'write', file: 'after.ts' })
  const live = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []
  record(
    '③ 台账轮转',
    rotated === true && backup.length === 25 && allValid && live.length === 1,
    `25 行、阈值 10 → 轮转=${rotated}，备份 ${backup.length} 行（应 25），可解析=${allValid}，之后新写入 ${live.length} 行（应 1）`,
  )
}

// ---------- ④ 配置文件生效 ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'wg-cfg-'))
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(
    join(dir, 'data', 'work-guard.config.json'),
    JSON.stringify({ rules: { 'read-depth': false } }),
    'utf8',
  )
  const script = `
    const mod = await import('file:///${join(process.cwd(), 'index.js').replace(/\\/g, '/')}')
    const g = mod.__internals
    g.reloadConfig()
    const fs = await import('node:fs')
    const file = ${JSON.stringify(join(dir, 'data', 'x.ts'))}
    fs.writeFileSync(file, Array.from({ length: 10 }, (_, i) => 'line' + (i + 1)).join('\\n') + '\\n')
    g.recordRead({ name: 'read', arguments: { file_path: file, offset: 1, limit: 2 } })
    const decision = await g.gate({ name: 'edit', arguments: { file_path: file, old_string: 'line10', new_string: 'line10x' } })
    const status = g.guardStatus()
    console.log(JSON.stringify({ decision: decision === undefined ? 'allow' : decision.kind, configSource: status.configSource }))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DSH_PROFILE_DIR: dir },
  })
  const out = String(run.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
  let parsed = {}
  try {
    parsed = JSON.parse(out)
  } catch {
    parsed = {}
  }
  record(
    '④ 配置文件生效',
    parsed.configSource === 'file' && parsed.decision === 'allow',
    `configSource=${parsed.configSource ?? '?'}，关掉 read-depth 后超出范围的改动=${parsed.decision ?? '?'}（应为 allow）`,
  )
}

// ---------- ② 并发写台账 ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'wg-conc-'))
  const file = join(dir, 'work-ledger.jsonl')
  const writer = `
    const mod = await import('file:///${join(process.cwd(), 'lib/ledger.js').replace(/\\/g, '/')}')
    mod.configureLedger(${JSON.stringify(file)}, { rotateAtRows: 100000 })
    for (let i = 0; i < 200; i += 1) mod.append({ kind: 'write', file: 'proc' + process.argv[1] + '-' + i + '.ts' })
  `
  spawnSync(process.execPath, ['--input-type=module', '-e', writer, 'A'], { encoding: 'utf8' })
  spawnSync(process.execPath, ['--input-type=module', '-e', writer, 'B'], { encoding: 'utf8' })
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []
  let badJson = 0
  for (const line of lines) {
    try {
      JSON.parse(line)
    } catch {
      badJson += 1
    }
  }
  const seen = new Set(lines.map(line => {
    try {
      return JSON.parse(line).file
    } catch {
      return 'bad'
    }
  }))
  record(
    '② 并发写台账（两次各 200 条）',
    lines.length === 400 && badJson === 0 && seen.size === 400,
    `行数=${lines.length}（期望 400），坏行=${badJson}，唯一文件数=${seen.size}`,
  )
}

console.log('')
const failed = results.filter(item => !item.ok).length
console.log(failed === 0 ? `全部通过（${results.length} 项）` : `有 ${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
