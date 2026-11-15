/**
 * 台账：追加、尾部读取、轮转。
 *
 * 从 index.js 抽出来的原因（2026-11-14 第 3 批）：index 之前同时做装配、判定、
 * IO 三件事，加一条规则要改一大片。现在 IO 只在这里。
 *
 * 记录格式 v2：`ts`（毫秒）是权威时间，`day`/`t` 只做显示。
 * v1（只有 day/t）照读：那些时间戳是 UTC 生成的，按 UTC 解释（见 lib/time.js）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { entryTime, nowParts } from './time.js'

let ledgerPath = ''
let rotateAtRows = 5000
let appendCount = 0

/** 装配台账位置。 */
export function configureLedger(path, options = {}) {
  ledgerPath = path
  if (Number.isFinite(options.rotateAtRows) && options.rotateAtRows > 0) rotateAtRows = options.rotateAtRows
  rotateIfNeeded()
}

export function ledgerFile() {
  return ledgerPath
}

/** 追加一条；失败只返回 false，绝不抛。 */
export function append(entry) {
  try {
    if (ledgerPath === '') return false
    mkdirSync(dirname(ledgerPath), { recursive: true })
    const row = { v: 2, ...nowParts(), ...entry }
    appendFileSync(ledgerPath, JSON.stringify(row) + '\n', 'utf8')
    appendCount += 1
    if (appendCount % 200 === 0) rotateIfNeeded()
    return true
  } catch {
    return false
  }
}

/** 读最近 N 条（可按文件片段过滤）。 */
export function tail(limit, fileFilter) {
  try {
    if (ledgerPath === '' || !existsSync(ledgerPath)) return []
    const raw = readFileSync(ledgerPath, 'utf8').trim()
    if (raw === '') return []
    let rows = raw.split('\n').slice(-5000)
      .map(line => { try { return JSON.parse(line) } catch { return undefined } })
      .filter(Boolean)
    if (fileFilter) rows = rows.filter(row => String(row.file ?? '').includes(fileFilter))
    return rows.slice(-limit)
  } catch {
    return []
  }
}

/**
 * 台账轮转：超过行数上限就改名成 `.1`，原文件由下一次 append 重建。
 *
 * 2026-11-14 实测修：旧实现先 `writeFileSync(backup, '')` 再 `renameSync` 到同一个路径，
 * Windows 上 rename 到已存在文件会失败 → 结果**只留下一个空备份，台账没迁走**。
 * 现在：先删旧备份，再 rename。
 *
 * 判定用**行数**而不是估算字节：行长得差异很大，`rows * 220` 这种估法在短行台账上永远不触发。
 */
export function rotateIfNeeded() {
  try {
    if (ledgerPath === '' || !existsSync(ledgerPath)) return false
    const raw = readFileSync(ledgerPath, 'utf8')
    const rows = raw === '' ? 0 : raw.split('\n').filter(line => line !== '').length
    if (rows < rotateAtRows) return false

    const backup = `${ledgerPath}.1`
    if (existsSync(backup)) rmSync(backup, { force: true })
    renameSync(ledgerPath, backup)
    return true
  } catch {
    return false
  }
}

/** 时间还原：给规则与扫描用（优先 ts，v1 按 UTC）。 */
export { entryTime }
