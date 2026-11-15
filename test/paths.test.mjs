/** lib/paths.js 的测试：同名文件不再混淆、根按文件算。 */
import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { isAbsolutePath, keyOf, projectRootOf, relativeTo } from '../lib/paths.js'
import { makeTmp } from './helpers/tmp.mjs'

test('keyOf：相对路径按 cwd 绝对化后与绝对路径一致', () => {
  const cwd = 'E:/work/proj'
  const a = keyOf('src/a.ts', cwd)
  const b = keyOf('E:/work/proj/src/a.ts', cwd)
  assert.equal(a, b)
})

test('两个项目里的同名文件不再相等（旧的尾部 3 段做法会误判）', () => {
  const cwd = 'E:/work'
  const x = keyOf('projA/src/main/index.ts', cwd)
  const y = keyOf('projB/src/main/index.ts', cwd)
  assert.notEqual(x, y)
})

test('isAbsolutePath 认得 Windows 盘符与 POSIX 根', () => {
  assert.equal(isAbsolutePath('E:/a/b'), true)
  assert.equal(isAbsolutePath('E:\\a\\b'), true)
  assert.equal(isAbsolutePath('/a/b'), true)
  assert.equal(isAbsolutePath('src/a.ts'), false)
})

test('projectRootOf 命中最近的项目标记（package.json），不是外层 .git', () => {
  const outer = makeTmp('contract-outer-')
  mkdirSync(join(outer, '.git'), { recursive: true })
  const inner = join(outer, 'app')
  mkdirSync(join(inner, 'src'), { recursive: true })
  writeFileSync(join(inner, 'package.json'), '{}', 'utf8')
  const file = join(inner, 'src', 'index.ts')
  writeFileSync(file, 'export {}\n', 'utf8')

  const root = projectRootOf(file)
  assert.equal(root.replace(/\\/g, '/'), inner.replace(/\\/g, '/'))
})

test('projectRootOf 找不到标记时退回文件所在目录', () => {
  const dir = makeTmp('contract-none-')
  const file = join(dir, 'x.ts')
  writeFileSync(file, 'x\n', 'utf8')
  const root = projectRootOf(file, { markers: ['definitely-not-here.marker'] })
  assert.equal(root.replace(/\\/g, '/'), dir.replace(/\\/g, '/'))
})

test('relativeTo 给出相对根的显示路径', () => {
  // 用真实临时目录，避免把盘符写死（CI 的 Linux 分支不认 E:/）
  const root = makeTmp('relative-')
  const file = join(root, 'src', 'a.ts')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(file, 'x\n', 'utf8')

  assert.equal(relativeTo(root, file).replace(/\\/gu, '/'), 'src/a.ts')

  // 根之外的文件：原样返回绝对路径
  const outside = join(makeTmp('relative-out-'), 'b.ts')
  const shown = relativeTo(root, outside).replace(/\\/gu, '/')
  assert.ok(shown.endsWith('b.ts'), `根之外应给绝对路径，实际 ${shown}`)
})
