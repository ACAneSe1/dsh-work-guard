/**
 * 从测试输出里抽"哪几条用例失败了"（红→绿证据的第一步）。
 *
 * 为什么需要：闸门能证明"文件读过"，但证明不了"修的是那个问题"。
 * 唯一便宜的硬证据是：**修复前有一批具体用例是红的，修复后它们变绿了。**
 * 在别处加代码把现象盖住，几乎不可能让一条具体断言变绿。
 *
 * 只认三种最常见格式，认不出就返回空数组——不猜。
 */

/** node --test（TAP 风格）：`not ok 3 - 用例名` */
const NODE_TAP = /^\s*not ok\s+\d+\s+-\s+(.+)$/gmu
/** node --test（spec 风格）：`✖ 用例名 (3.1ms)` */
const NODE_SPEC = /^\s*[✗✖]\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/gmu
/** jest / vitest：`  ✕ 用例名` 或 `  × 用例名` */
const JEST = /^\s*[✕×]\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*m?s\))?\s*$/gmu
/** pytest：`FAILED path/to/test_x.py::test_name - AssertionError` */
const PYTEST = /^\s*FAILED\s+(\S+?)(?:\s+-\s+.*)?$/gmu
/** go test：`--- FAIL: TestName (0.00s)` */
const GOTEST = /^\s*--- FAIL:\s+(\S+)/gmu

const PARSERS = [
  { name: 'node-tap', re: NODE_TAP },
  { name: 'pytest', re: PYTEST },
  { name: 'go-test', re: GOTEST },
  { name: 'node-spec', re: NODE_SPEC },
  { name: 'jest', re: JEST },
]

const MAX_NAMES = 40

/**
 * 从一段输出里抽失败用例名。
 * @param {string} text
 * @returns {{ names: string[], parser: string | undefined }}
 */
export function failingTests(text) {
  if (typeof text !== 'string' || text === '') return { names: [], parser: undefined }

  for (const { name, re } of PARSERS) {
    re.lastIndex = 0
    const found = []
    let match
    while ((match = re.exec(text)) !== null) {
      const label = String(match[1] ?? '').trim()
      if (label === '') continue
      // 2026-11-14 实测：spec 输出里有一行 `✖ failing tests:`，它是小节标题不是用例名
      if (/^failing tests?:?$/iu.test(label)) continue
      if (!found.includes(label)) found.push(label)
      if (found.length >= MAX_NAMES) break
    }
    if (found.length > 0) return { names: found, parser: name }
  }
  return { names: [], parser: undefined }
}

/**
 * 从工具结果里尽量捞出文本（形状随版本变，逐层兜底）。
 * 只在"验证命令"上调用，因此不需要处理超大输出。
 */
export function resultText(result, maxLength = 200_000) {
  const chunks = []
  const walk = (node, depth) => {
    if (chunks.length > 400 || depth > 6) return
    if (typeof node === 'string') {
      if (node !== '') chunks.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value, depth + 1)
    }
  }
  walk(result, 0)
  const text = chunks.join('\n')
  return text.length > maxLength ? text.slice(0, maxLength) : text
}
