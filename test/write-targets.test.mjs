/** P1-2：从命令里抠写入目标（扫描范围的一部分）。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { normPath, writeTargetsOf } from '../lib/paths.js'

// 期望值一律过一遍 normPath：这样 Windows 上大小写折叠、Linux 上保留原样，测试跟着真实行为走
const expect = path => normPath(path)
const BASE = 'E:\\base'

test('Set-Content -Path（带引号绝对路径）', () => {
  const targets = writeTargetsOf('Set-Content -Path "C:\\proj\\x.ts" -Value 1', BASE)
  assert.deepEqual(targets, [expect('C:\\proj\\x.ts')])
})

test('重定向 > 绝对路径', () => {
  assert.deepEqual(writeTargetsOf('echo hi > C:\\proj\\z.ts', BASE), [expect('C:\\proj\\z.ts')])
})

test('tee -FilePath', () => {
  assert.deepEqual(
    writeTargetsOf('Get-Content a | tee -FilePath C:\\proj\\w.ts', BASE),
    [expect('C:\\proj\\w.ts')],
  )
})

test('相对路径按 baseDir 解析', () => {
  const targets = writeTargetsOf('Add-Content -Path ./y.ts -Value 2', BASE)
  assert.equal(targets.length, 1)
  assert.match(targets[0], /\/y\.ts$/u, `相对路径应以 baseDir 为基准，实际 ${targets[0]}`)
})

test('输出设备不算文件（$null / > $null）', () => {
  assert.deepEqual(writeTargetsOf('Set-Content -Path $null -Value 1', BASE), [])
  assert.deepEqual(writeTargetsOf('npm test > $null', BASE), [])
})

test('变量无法解析 → 跳过（不猜）', () => {
  assert.deepEqual(writeTargetsOf('Set-Content -Path "$env:TEMP\\a.ts" -Value 1', BASE), [])
})

test('同一条命令里多个目标 → 去重', () => {
  const targets = writeTargetsOf(
    'Set-Content -Path "C:\\p\\a.ts" -Value 1; Add-Content -Path "C:\\p\\a.ts" -Value 2',
    BASE,
  )
  assert.deepEqual(targets, [expect('C:\\p\\a.ts')])
})

test('POSIX 绝对路径在任何平台都能解析（CI 的 Linux 分支）', () => {
  const targets = writeTargetsOf('echo hi > /tmp/out.ts', '/tmp')
  assert.equal(targets.length, 1)
  assert.match(targets[0], /\/tmp\/out\.ts$/u)
})
