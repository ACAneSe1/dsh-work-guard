/**
 * 项目语言检测（第 3 步）。
 *
 * 目的：让"语言专用规则"只在说那种语言的项目里生效。
 * 现在的问题：`no-unkeyed-derived-state` 是 Kotlin/Compose 专用的，但在一个 TS 项目里
 * 它同样会跑——既浪费，也让人误以为这个插件懂 Kotlin 之外的东西。
 *
 * 检测方式刻意保持"便宜"：只看文件标记，不解析构建脚本。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 项目类型 → 认定它需要的标记文件（任一命中即可）。顺序 = 优先级。 */
export const PROJECT_MARKERS = [
  { kind: 'kotlin', markers: ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle'] },
  { kind: 'rust', markers: ['Cargo.toml'] },
  { kind: 'go', markers: ['go.mod'] },
  { kind: 'flutter', markers: ['pubspec.yaml'] },
  { kind: 'python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
  { kind: 'ts', markers: ['tsconfig.json', 'package.json'] },
]

/** 扩展名 → 语言。检测不到返回 undefined。 */
const EXT_LANG = new Map([
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.java', 'kotlin'], // Kotlin 项目里常见的 Java 混编
  ['.ts', 'ts'],
  ['.tsx', 'ts'],
  ['.js', 'ts'],
  ['.jsx', 'ts'],
  ['.mjs', 'ts'],
  ['.cjs', 'ts'],
  ['.rs', 'rust'],
  ['.go', 'go'],
  ['.py', 'python'],
  ['.dart', 'flutter'],
])

const kindCache = new Map()

export function fileLanguage(filePath) {
  const lower = String(filePath).toLowerCase()
  for (const [ext, lang] of EXT_LANG) {
    if (lower.endsWith(ext)) return lang
  }
  return undefined
}

/**
 * 检测一个项目根的类型。
 * @param {string} rootDir
 * @returns {string|undefined} 'kotlin' | 'ts' | 'rust' | 'go' | 'flutter' | 'python'
 */
export function detectProjectKind(rootDir) {
  if (typeof rootDir !== 'string' || rootDir === '') return undefined
  const cached = kindCache.get(rootDir)
  if (cached !== undefined) return cached

  let kind
  for (const rule of PROJECT_MARKERS) {
    if (rule.markers.some(marker => existsSync(join(rootDir, marker)))) {
      kind = rule.kind
      break
    }
  }

  // 没有任何标记文件时，用"目录里有没有该语言源码"兜底看一眼（只看一层）
  if (kind === undefined) {
    try {
      for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const lang = fileLanguage(entry.name)
        if (lang !== undefined) {
          kind = lang
          break
        }
      }
    } catch {
      // 读不到就不判断
    }
  }

  kindCache.set(rootDir, kind)
  return kind
}

/** 清空缓存（测试用）。 */
export function resetKindCache() {
  kindCache.clear()
}

/**
 * 一条规则在这个上下文里是否应运行。
 * 规则可以声明 `languages: ['kotlin']`；没声明 = 语言无关。
 * @param {object} rule
 * @param {Set<string>} languages 当前文件所属项目 + 文件本身的语言
 */
export function ruleMatchesLanguage(rule, languages) {
  const declared = rule?.languages
  if (!Array.isArray(declared) || declared.length === 0) return true
  if (!(languages instanceof Set) || languages.size === 0) return false
  return declared.some(lang => languages.has(lang))
}
