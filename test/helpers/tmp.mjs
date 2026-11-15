/**
 * 测试用临时目录（2026-11-15，修 P1-1）。
 *
 * 问题：test/*.mjs 里有 42 处 `mkdtempSync`，**一处清理都没有** →
 * 跑一次测试就往 %TEMP% 里扔几十个目录（实测累计 2587 个 / 13.1 MB）。
 *
 * 做法：`makeTmp(prefix)` 建目录并登记；进程退出时统一删除。
 * 为什么要挂在 process exit 而不是每个 test 的 `t.after`：
 *   - 42 处分布在 15 个文件，很多调用在辅助函数里，拿不到 `t`
 *   - 退出时删一次，效果相同（测试跑完目录就没了），改动面最小
 *
 * 注意：只删自己建的目录；删不掉就静默跳过（Windows 上偶发占用）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const created = []
let hooked = false

function hook() {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    for (const dir of created) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 删除失败不影响测试结果
      }
    }
  })
}

/**
 * 建一个临时目录，进程退出时自动删除。
 * @param {string} [prefix]
 * @returns {string}
 */
export function makeTmp(prefix = 'wg-') {
  hook()
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** 当前已登记但尚未删除的目录数（测试用）。 */
export function tmpCount() {
  return created.length
}
