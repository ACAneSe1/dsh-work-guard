/**
 * 把数字翻译成"下一步做什么"（2026-11-14）。
 *
 * 为什么需要：面板上的 `3 改 · 0 验 · 2 绕过` 是**描述**，不是**建议**。
 * 用户看到这些数字不知道要干什么——包括作者本人。
 *
 * 规则：**一个指标如果不对应一个动作，就不该占据主位。**
 * 所以这里只产出三种东西：
 *   - block：有问题，且必须动（不许继续）
 *   - warn：有问题，可以不马上动，但要看得见
 *   - ok：没有待办（这时界面应该安静）
 *
 * @param {{
 *   unverified?: number,
 *   fixEvidence?: { state?: string, stillFailing?: string[], baseline?: { names?: string[] } },
 *   undeclared?: { count?: number },
 *   gateActive?: boolean|null,
 * }} status
 * @returns {Array<{ level: 'block'|'warn'|'ok', title: string, action?: string, detail?: string }>}
 */
export function verdictsOf(status) {
  const out = []
  const unverified = Number(status?.unverified) || 0
  const redState = status?.fixEvidence?.state
  const stillFailing = Array.isArray(status?.fixEvidence?.stillFailing) ? status.fixEvidence.stillFailing : []
  const undeclared = Number(status?.undeclared?.count) || 0
  const gateActive = status?.gateActive
  const zeroTests = Number(status?.emptyVerifications) || 0

  // 2026-11-15 修 P0-1：最近一次验证一条测试都没跑到 —— 这不是"验证过"
  if (zeroTests > 0) {
    out.push({
      level: 'warn',
      title: '最近一次验证没跑到任何测试（0 条）',
      action: '确认测试文件真的在跑：检查 test 脚本是否匹配到用例，别把空套件当通过',
    })
  }

  if (redState === 'red' && stillFailing.length > 0) {
    out.push({
      level: 'block',
      title: `${stillFailing.length} 条红测试还没变绿`,
      action: '让这些用例通过，或者说明它们为什么不该修——别在别处加代码把现象盖住',
      detail: stillFailing.slice(0, 3).join(' / '),
    })
  }

  if (unverified > 0) {
    out.push({
      level: 'block',
      title: `改了 ${unverified} 处，之后没有一次通过的验证`,
      action: '跑一次测试或构建；命令要单独一条，别加管道（管道会让退出码不可信）',
    })
  }

  if (undeclared > 0) {
    out.push({
      level: 'warn',
      title: `${undeclared} 个文件是脚本改的，没有申报`,
      action: '用 work_declare 申报，或把它们回滚',
    })
  }

  if (gateActive === false) {
    out.push({
      level: 'warn',
      title: '本会话的写入没有经过闸门',
      action: '脚本写入不经过闸门；要它守，请用 write / edit 改文件',
    })
  }

  if (out.length === 0) {
    out.push({ level: 'ok', title: '没有待办', action: '' })
  }

  return out
}

/** 面板只显示的第一条（ok 时返回 undefined，让界面安静）。 */
export function headlineOf(verdicts) {
  const first = (verdicts ?? []).find(item => item.level !== 'ok')
  return first
}
