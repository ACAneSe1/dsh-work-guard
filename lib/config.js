/**
 * 配置：JSON 文件 + 环境变量覆盖 + 内置默认。
 *
 * 为什么不用 Schemastery（2026-11-14 决定）：本插件要能"换台电脑 clone 就能跑"，
 * 配置必须是**人可以手改、可以随仓库拷贝**的纯 JSON；零依赖也少一个装不上的理由。
 *
 * 优先级：环境变量 > 配置文件 > 默认值。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 默认提示文本 —— 这是本插件的立场，可被配置覆盖，但覆盖后它就只是另一个壳。 */
export const DEFAULT_PROMPT = [
  '【工作方式】',
  '1. 改任何文件之前，先读它。读不到就说读不到，不猜内容。',
  '2. 报错或异常，先定位到具体文件与行号，再动手。定位不到就明说「尚未定位」，不要边改边找。',
  '3. 只改用户要求的部分。发现别的问题就记下来告诉他，不要顺手改。',
  '4. 被三处以上复用的组件，动之前先说明会影响哪些屏，等确认再改。',
  '5. 症状出现在 A 就修 A。禁止新增代码把症状盖住。动手前先写清因果：A 为什么导致 B。',
  '6. 说「修好了」之前必须有一次实跑：编译、运行、测量任一。没有就写「未验证」。',
  '7. 如果修复前有失败的测试，修完必须让同一批用例变绿（红→绿）；否则不算修好——',
  '   在别处加代码把现象盖住，不会让一条具体断言变绿。',
  '8. 结束这一轮之前，先自己问一句：这次改的地方验证了吗？红测试变绿了吗？',
  '   没验证就现在跑一次；还红着就继续改，不要先报告完成。',
  '9. 跑测试用 work_verify：它只回几行（过没过、哪条红、位置）。',
  '   不要自己敲测试命令把整段输出搬进上下文；它认不出命令时再自己跑。',
  '',
  '交付前用两句话自查：',
  '· 根因是哪一行的什么机制？答不出来 = 还没修，只是让它不显示了。',
  '· 这次改动里，有哪一处是用户没要求的？',
].join('\n')

export const DEFAULT_CONFIG = {
  version: 1,
  prompt: DEFAULT_PROMPT,
  sourceExtensions: ['.kt', '.kts', '.java', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.swift', '.cs', '.cpp', '.c', '.h'],
  // 2026-11-14 复审修正（P1-3）：补齐 Windows 上真实可用的写法（npm.cmd / pnpm.cmd）
  // 与其它常见测试入口；漏掉它们会让状态条上的 "未验证" 永远清不掉。
  verifyPattern: 'gradlew|gradle\\s|assemble|compileDebug|'
    + 'npm(\\.cmd)?\\s+(run\\s+)?(test|build)|pnpm(\\.cmd)?\\s+(run\\s+)?(test|build)|'
    + 'yarn(\\.cmd)?\\s+(test|build)|bun\\s+(test|run)|'
    + 'vitest|jest|pytest|mvnw?\\s|flutter\\s+test|cargo\\s+(build|test)|go\\s+test|dotnet\\s+build',
  ledger: { path: '', rotateAtRows: 5000 },
  state: { readTtlHours: 24 },
  projectMarkers: ['.git', 'package.json', 'settings.gradle.kts', 'settings.gradle', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pubspec.yaml'],
  rules: {
    'read-before-write': true,
    // 第 2 步：读的新鲜度与深度。两项都可用配置关掉，但默认开——
    // 关掉以后闸门就退回"读过这个文件"，那是被换机实测证明不够的口径。
    'read-freshness': true,
    'read-depth': true,
    'no-unkeyed-derived-state': true,
  },
}

function merge(base, patch) {
  const out = { ...base }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * 读配置。
 * @param {string} dataDir 配置所在目录（通常是 profile 的 data/）
 * @returns {{ config: object, source: 'file'|'default', path: string }}
 */
export function loadConfig(dataDir) {
  const path = join(dataDir, 'work-guard.config.json')
  let config = DEFAULT_CONFIG
  let source = 'default'

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8')
      config = merge(DEFAULT_CONFIG, JSON.parse(raw))
      source = 'file'
    } catch {
      // 坏配置：退回默认，但要能和「文件不存在」区分开（复审 P2-14）
      source = 'broken'
    }
  }

  // 环境变量覆盖（换机器临时调试用）
  if (process.env.DSH_WORK_GUARD_PROMPT) config = { ...config, prompt: process.env.DSH_WORK_GUARD_PROMPT }
  if (process.env.DSH_WORK_GUARD_LEDGER) config = { ...config, ledger: { ...config.ledger, path: process.env.DSH_WORK_GUARD_LEDGER } }

  return { config, source, path }
}

/** 配置是否声明开启某条规则（缺省视为开启）。 */
export function ruleEnabled(config, id) {
  const rules = config?.rules ?? {}
  return rules[id] !== false
}

/** 把 `verifyPattern` 编译成正则；写错就回退到默认。 */
export function verifyRegex(config) {
  try {
    return new RegExp(config?.verifyPattern ?? DEFAULT_CONFIG.verifyPattern, 'iu')
  } catch {
    return new RegExp(DEFAULT_CONFIG.verifyPattern, 'iu')
  }
}
