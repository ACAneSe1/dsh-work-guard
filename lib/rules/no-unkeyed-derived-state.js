/**
 * 规则：无 key 的 `remember { derivedStateOf { … } }` 是永不重算的缓存。
 *
 * 这条来自 2026-11-14 的真实故障：转圈不消失/不出现，根因就是它。
 * 判定前要剥掉反引号包裹的文档片段——否则插件自己的报错文案会被当成代码。
 */

export const id = 'no-unkeyed-derived-state'
export const stage = 'pre-write'

const RE = /remember\s*\{\s*(?:[A-Za-z.]+\s*\{\s*)?derivedStateOf/u
export const ALLOW_MARKER = 'work-guard: allow'

/**
 * 语言门（第 3 步）：这是 Kotlin/Compose 规则，只在 Kotlin 项目里生效。
 * 没有这一条时，任何一个 TS 项目也会被这条规则扫一遍——既不必要，也误导。
 */
export const languages = ['kotlin']

export function applies(context) {
  return typeof context?.afterText === 'string' && context.afterText !== ''
}

/** 返回命中行（1-based）。 */
export function findViolations(text) {
  const lines = String(text).split(/\r?\n/u)
  const hits = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.includes(ALLOW_MARKER)) continue
    const code = line.replace(/`[^`]*`/gu, '')
    if (RE.test(code)) {
      hits.push({ line: i + 1, text: line.trim() })
      continue
    }
    if (/remember\s*\{\s*$/u.test(code) && /^\s*derivedStateOf/u.test(lines[i + 1] ?? '')) {
      hits.push({ line: i + 1, text: line.trim() })
    }
  }
  return hits
}

export function check(context) {
  const hits = findViolations(context.afterText)
  if (hits.length === 0) return null
  const listed = hits.slice(0, 3).map(hit => `  L${hit.line} ${hit.text}`).join('\n')
  return {
    deny: 'no-unkeyed-derived-state',
    reason:
      'Work guard: `remember { derivedStateOf { ... } }` is a cache that never recomputes — '
      + 'a keyless remember is created once and derivedStateOf only tracks State it reads.\n'
      + `This write reintroduces it:\n${listed}\n`
      + 'Use `remember(dependency) { compute(...) }` or just `val x = compute(input)`.\n'
      + '(Exception: add `// work-guard: allow` at the end of that line.)',
  }
}

export default { id, stage, applies, check, findViolations, languages }
