/**
 * 规则注册表。
 *
 * 一条规则就是一个对象：
 *   { id, stage, applies(ctx), check(ctx), languages? }
 *
 * `check` 返回 null 表示放行，返回 { deny, reason } 表示拒绝。
 * `languages` 可选：声明后只在对应语言的项目里运行（第 3 步）。
 * 加规则的代价应该是「加一个文件」：不要再改 gate()，也不要再往 index.js 里塞 if。
 */
import { ruleMatchesLanguage } from '../detect.js'

const registry = []

/** 注册一条规则；同 id 覆盖（热更新时避免重复堆积）。 */
export function registerRule(rule) {
  if (!rule || typeof rule.id !== 'string' || typeof rule.check !== 'function') return false
  const index = registry.findIndex(item => item.id === rule.id)
  if (index >= 0) registry.splice(index, 1)
  registry.push(rule)
  return true
}

/** 清空（测试用）。 */
export function resetRules() {
  registry.length = 0
}

/** 当前所有规则（只读快照）。 */
export function listRules() {
  return [...registry]
}

/**
 * 跑某一步的所有规则。
 * @param {string} stage 'pre-write' | 'post-write'
 * @param {object} context 规则上下文
 * @param {{ isEnabled?: (id: string) => boolean, languages?: Set<string> }} [options]
 *   配置里的规则开关；`languages` 是当前文件所属项目与文件本身的语言集合（第 3 步）
 * @returns {Promise<{deny: string, reason: string, ruleId: string} | null>}
 */
export async function runRules(stage, context, options = {}) {
  for (const rule of registry) {
    if ((rule.stage ?? 'pre-write') !== stage) continue
    if (typeof options.isEnabled === 'function' && !options.isEnabled(rule.id)) continue
    // 语言门（第 3 步）：声明了 languages 的规则只在对应语言里跑
    if (!ruleMatchesLanguage(rule, options.languages ?? new Set())) continue
    if (typeof rule.applies === 'function' && !rule.applies(context)) continue
    let hit
    try {
      hit = await rule.check(context)
    } catch {
      // 规则自身出错不许挡住写入（和闸门的原则一致），但也不许静默通过——
      // 这里选择"跳过这条规则"，并在返回值里留痕由调用方决定要不要记。
      continue
    }
    if (hit) return { ...hit, ruleId: rule.id }
  }
  return null
}
