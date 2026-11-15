/** lib/config.js 的测试：默认值、文件合并、坏配置回退、环境变量覆盖。 */
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_CONFIG, DEFAULT_PROMPT, loadConfig, ruleEnabled, verifyRegex } from '../lib/config.js'
import { makeTmp } from './helpers/tmp.mjs'

test('没有配置文件时用默认值', () => {
  const dir = makeTmp('wg-cfg-none-')
  const { config, source } = loadConfig(dir)
  assert.equal(source, 'default')
  assert.equal(config.prompt, DEFAULT_PROMPT)
  assert.equal(config.state.readTtlHours, 24)
})

test('文件里的字段与默认值深合并（只覆盖给出的键）', () => {
  const dir = makeTmp('wg-cfg-merge-')
  writeFileSync(join(dir, 'work-guard.config.json'), JSON.stringify({
    prompt: '自定义',
    state: { readTtlHours: 1 },
  }), 'utf8')
  const { config, source } = loadConfig(dir)
  assert.equal(source, 'file')
  assert.equal(config.prompt, '自定义')
  assert.equal(config.state.readTtlHours, 1)
  // 没给的键仍是默认值
  assert.deepEqual(config.sourceExtensions, DEFAULT_CONFIG.sourceExtensions)
})

test('坏 JSON 退回默认，并标成 broken（能和"没有文件"区分）', () => {
  const dir = makeTmp('wg-cfg-broken-')
  writeFileSync(join(dir, 'work-guard.config.json'), '{ not json', 'utf8')
  const { config, source } = loadConfig(dir)
  assert.equal(source, 'broken')
  assert.equal(config.prompt, DEFAULT_PROMPT)
})

test('ruleEnabled：缺省开启，显式 false 才关', () => {
  assert.equal(ruleEnabled(DEFAULT_CONFIG, 'read-before-write'), true)
  assert.equal(ruleEnabled({ rules: { 'read-before-write': false } }, 'read-before-write'), false)
})

test('verifyRegex：写坏的表达式回退默认', () => {
  const good = verifyRegex({ verifyPattern: 'gradlew' })
  assert.equal(good.test('./gradlew assembleDebug'), true)
  const bad = verifyRegex({ verifyPattern: '([' })
  assert.equal(bad.test('npm test'), true)
})
