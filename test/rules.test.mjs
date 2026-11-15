/** lib/rules 的测试：注册、覆盖、开关、执行顺序。 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { listRules, registerRule, resetRules, runRules } from '../lib/rules/index.js'

function rule(id, hit, stage = 'pre-write') {
  return { id, stage, applies: () => true, check: () => hit }
}

test('注册后能列出；同 id 覆盖而不是堆积', () => {
  resetRules()
  registerRule(rule('a', null))
  registerRule(rule('a', null))
  registerRule(rule('b', null))
  assert.deepEqual(listRules().map(r => r.id).sort(), ['a', 'b'])
  resetRules()
})

test('runRules 返回第一条命中的规则 id', async () => {
  resetRules()
  registerRule(rule('first', null))
  registerRule(rule('second', { deny: 'x', reason: 'why' }))
  const hit = await runRules('pre-write', {})
  assert.equal(hit?.ruleId, 'second')
  resetRules()
})

test('isEnabled=false 的规则被跳过', async () => {
  resetRules()
  registerRule(rule('blocker', { deny: 'x', reason: 'why' }))
  const hit = await runRules('pre-write', {}, { isEnabled: () => false })
  assert.equal(hit, null)
  resetRules()
})

test('applies 返回 false 的规则不执行', async () => {
  resetRules()
  registerRule({ id: 'never', stage: 'pre-write', applies: () => false, check: () => ({ deny: 'x', reason: 'y' }) })
  assert.equal(await runRules('pre-write', {}), null)
  resetRules()
})

test('规则自身抛错时跳过它，不挡住写入', async () => {
  resetRules()
  registerRule({ id: 'boom', stage: 'pre-write', applies: () => true, check: () => { throw new Error('boom') } })
  registerRule(rule('after', null))
  assert.equal(await runRules('pre-write', {}), null)
  resetRules()
})

test('stage 不匹配的规则不执行', async () => {
  resetRules()
  registerRule(rule('post-only', { deny: 'x', reason: 'y' }, 'post-write'))
  assert.equal(await runRules('pre-write', {}), null)
  resetRules()
})
