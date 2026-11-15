/**
 * 相对路径的回归测试（2026-11-14 真实翻车）：
 * 工具传相对路径时，宿主 cwd 不是工作区，existsSync 永远 false，
 * 于是任何文件都被当成"新建"放行 —— 闸门形同虚设。
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { __internals as g } from '../index.js'

test('相对路径 + 没读过 → 拒绝（不许走"新建"捷径）', async () => {
  g.READ_FILES.clear()
  const decision = await g.gate({
    name: 'edit',
    arguments: {
      file_path: 'proj-a/app/src/main/java/com/example/app/data/Model.kt',
      old_string: 'a',
      new_string: 'b',
    },
  })
  assert.equal(decision?.kind, 'deny')
})

test('相对路径 + 读过（尾部匹配）→ 放行', async () => {
  g.READ_FILES.clear()
  g.recordRead({
    name: 'read',
    arguments: { file_path: 'E:/somewhere/else/data/model/Zone.kt' },
  })
  const decision = await g.gate({
    name: 'edit',
    arguments: {
      file_path: 'proj-a/app/src/main/java/com/example/app/data/Model.kt',
      old_string: 'a',
      new_string: 'b',
    },
  })
  assert.equal(decision, undefined)
})
