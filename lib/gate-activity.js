/**
 * 闸门是否真的在工作（2026-11-14 B3 第三版）。
 *
 * 前两版都有问题：
 *   1. `ctx.tools.definitions()` 不传 scope → 只返回全局注册，而 write/edit 是
 *      按 agent scope 注册的 → 明明有工具却判成"没有"。
 *   2. 只用"证据"（gateCalls/shellSourceWrites）→ 本会话只用了脚本、还没写过文件时，
 *      会说"闸门未挂载"，但工具其实好端端在那儿。
 *
 * 第三版：先按 scope 查一次工具（能力存在 → true），查不到再退回证据。
 *
 * @param {{
 *   gateCalls: number,
 *   shellSourceWrites: number,
 *   hasWriteTools: boolean|null,
 * }} counts
 * @returns {{ active: boolean|null, reason: 'tools'|'used'|'idle'|'unknown' }}
 */
export function computeGateActivity(counts) {
  const gateCalls = Number(counts?.gateCalls) || 0
  const shellWrites = Number(counts?.shellSourceWrites) || 0
  const hasTools = counts?.hasWriteTools

  // ① 能力存在：闸门在链路上（即使本次会话还没用过）
  if (hasTools === true) return { active: true, reason: 'tools' }
  // ② 用过：闸门确实在工作
  if (gateCalls > 0) return { active: true, reason: 'used' }
  // ③ 明确没有工具：闸门空转
  if (hasTools === false) return { active: false, reason: 'idle' }
  // ④ 工具有没有不知道，但脚本确实改过源码 → 至少"闸门没被用到"
  if (shellWrites > 0) return { active: false, reason: 'idle' }
  // ⑤ 什么都不知道
  return { active: null, reason: 'unknown' }
}
