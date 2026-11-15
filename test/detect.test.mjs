/**
 * 第 3 步测试：语言检测 + 规则语言门。
 *
 * 注意：下面那行"坏写法"是测试样本，按规则自带方式加破例标记。
 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { detectProjectKind, fileLanguage, resetKindCache, ruleMatchesLanguage } from '../lib/detect.js'
import { listRules, runRules } from '../lib/rules/index.js'
// 副作用导入：index.js 在模块加载期注册内置规则（这里不调 apply()，但注册表要齐）
import '../index.js'
import { makeTmp } from './helpers/tmp.mjs'

function project(name, marker, content = '') {
  const dir = makeTmp(`wg-kind-${name}-`)
  if (marker) writeFileSync(join(dir, marker), content, 'utf8')
  return dir
}

test('fileLanguage 按扩展名判断', () => {
  assert.equal(fileLanguage('a.kt'), 'kotlin')
  assert.equal(fileLanguage('a.ts'), 'ts')
  assert.equal(fileLanguage('a.rs'), 'rust')
  assert.equal(fileLanguage('a.md'), undefined)
})

test('detectProjectKind：Kotlin 项目（settings.gradle.kts）', () => {
  resetKindCache()
  const dir = project('kt', 'settings.gradle.kts')
  assert.equal(detectProjectKind(dir), 'kotlin')
})

test('detectProjectKind：TS 项目（package.json）', () => {
  resetKindCache()
  const dir = project('ts', 'package.json', '{}')
  assert.equal(detectProjectKind(dir), 'ts')
})

test('detectProjectKind：Rust / Go / Python / Flutter', () => {
  resetKindCache()
  assert.equal(detectProjectKind(project('rs', 'Cargo.toml')), 'rust')
  assert.equal(detectProjectKind(project('go', 'go.mod')), 'go')
  assert.equal(detectProjectKind(project('py', 'pyproject.toml')), 'python')
  assert.equal(detectProjectKind(project('dart', 'pubspec.yaml')), 'flutter')
})

test('没有任何标记时看目录里的源码后缀', () => {
  resetKindCache()
  const dir = project('bare', null)
  writeFileSync(join(dir, 'main.ts'), 'export {}\n', 'utf8')
  assert.equal(detectProjectKind(dir), 'ts')
})

test('ruleMatchesLanguage：声明了语言的规则只在该语言里跑', () => {
  const rule = { id: 'x', languages: ['kotlin'] }
  assert.equal(ruleMatchesLanguage(rule, new Set(['kotlin'])), true)
  assert.equal(ruleMatchesLanguage(rule, new Set(['ts'])), false)
  assert.equal(ruleMatchesLanguage(rule, new Set()), false)
  // 没声明 = 语言无关
  assert.equal(ruleMatchesLanguage({ id: 'y' }, new Set()), true)
})

test('Kotlin 规则在 TS 上下文里不执行（runRules 语言门）', async () => {
  const text = 'val x by remember { derivedStateOf { list.size } }' // work-guard: allow
  const hitsInKotlin = await runRules(
    'pre-write',
    { filePath: 'a.kt', isSource: true, isNew: true, readMeta: { at: Date.now(), ranges: [] }, afterText: text },
    { languages: new Set(['kotlin']) },
  )
  assert.equal(hitsInKotlin?.ruleId, 'no-unkeyed-derived-state')

  const hitsInTs = await runRules(
    'pre-write',
    { filePath: 'a.ts', isSource: true, isNew: true, readMeta: { at: Date.now(), ranges: [] }, afterText: text },
    { languages: new Set(['ts']) },
  )
  assert.equal(hitsInTs, null)
})

test('语言无关的规则在任何语言里都跑（read-before-write）', () => {
  const universal = listRules().filter(rule => !Array.isArray(rule.languages))
  assert.ok(universal.some(rule => rule.id === 'read-before-write'))
})
