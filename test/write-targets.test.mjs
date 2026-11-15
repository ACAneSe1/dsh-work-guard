/** P1-2：从命令里抠写入目标（扫描范围的一部分）。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { writeTargetsOf } from '../lib/paths.js'

test('Set-Content -Path（带引号绝对路径）', () => {
  const targets = writeTargetsOf('Set-Content -Path "C:\\proj\\x.ts" -Value 1', 'E:\\base')
  assert.deepEqual(targets, ['c:/proj/x.ts'])
})

test('重定向 > 绝对路径', () => {
  assert.deepEqual(writeTargetsOf('echo hi > C:\\proj\\z.ts', 'E:\\base'), ['c:/proj/z.ts'])
})

test('tee -FilePath', () => {
  assert.deepEqual(writeTargetsOf('Get-Content a | tee -FilePath C:\\proj\\w.ts', 'E:\\base'), ['c:/proj/w.ts'])
})

test('相对路径按 baseDir 解析', () => {
  assert.deepEqual(writeTargetsOf('Add-Content -Path ./y.ts -Value 2', 'E:\\base'), ['e:/base/y.ts'])
})

test('输出设备不算文件（$null / > $null）', () => {
  assert.deepEqual(writeTargetsOf('Set-Content -Path $null -Value 1', 'E:\\base'), [])
  assert.deepEqual(writeTargetsOf('npm test > $null', 'E:\\base'), [])
})

test('变量无法解析 → 跳过（不猜）', () => {
  assert.deepEqual(writeTargetsOf('Set-Content -Path "$env:TEMP\\a.ts" -Value 1', 'E:\\base'), [])
})

test('同一条命令里多个目标 → 去重', () => {
  const targets = writeTargetsOf('Set-Content -Path "C:\\p\\a.ts" -Value 1; Add-Content -Path "C:\\p\\a.ts" -Value 2', 'E:\\base')
  assert.deepEqual(targets, ['c:/p/a.ts'])
})
