/** JUnit XML 解析测试（gradle/maven 的失败名单）。 */
import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { readJunitFailures } from '../lib/verify-tool.js'
import { makeTmp } from './helpers/tmp.mjs'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.FooTest" tests="3" failures="1" errors="1">
  <testcase name="passes" classname="com.example.FooTest" time="0.1"/>
  <testcase name="fails" classname="com.example.FooTest" time="0.2">
    <failure message="expected 1 but was 2">stack...</failure>
  </testcase>
  <testcase name="errors" classname="com.example.FooTest" time="0.3">
    <error message="boom &amp; bang">stack...</error>
  </testcase>
</testsuite>
`

test('从 app/build/test-results 读出失败与错误的用例名', () => {
  const root = makeTmp('wg-junit-')
  const dir = join(root, 'app', 'build', 'test-results', 'testDebugUnitTest')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'TEST-FooTest.xml'), SAMPLE, 'utf8')

  const failures = readJunitFailures(root)
  assert.deepEqual(failures.map(item => item.name).sort(), ['errors', 'fails'])
  assert.equal(failures.find(item => item.name === 'fails')?.message, 'expected 1 but was 2')
})

test('XML 实体被解码（&amp; → &）', () => {
  const root = makeTmp('wg-junit2-')
  const dir = join(root, 'build', 'test-results', 'test')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'TEST-Bar.xml'), SAMPLE, 'utf8')
  const failures = readJunitFailures(root)
  assert.equal(failures.find(item => item.name === 'errors')?.message, 'boom & bang')
})

test('没有报告目录 → 返回空数组（不抛）', () => {
  const root = makeTmp('wg-junit3-')
  assert.deepEqual(readJunitFailures(root), [])
})

test('全部通过的 XML → 没有失败', () => {
  const root = makeTmp('wg-junit4-')
  const dir = join(root, 'build', 'test-results', 'test')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'TEST-Ok.xml'), '<testsuite><testcase name="a"/></testsuite>', 'utf8')
  assert.deepEqual(readJunitFailures(root), [])
})
