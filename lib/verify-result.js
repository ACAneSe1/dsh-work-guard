/**
 * 从一次已完成的工具结果里读「验证是否成功」。
 *
 * 第 4 步的核心：不再用"命令字符串像不像测试"来判定验证，
 * 而是看这次 shell 调用的**真实结果**（exitCode / isError）。
 *
 * 结果形状随工具不同而不同，这里逐层兜底，取不到就返回 null（"未知"），
 * 绝不用"看起来成功"冒充。
 */

/** 命中即视为一次"验证尝试"的命令（与 lib/config.js 的 verifyPattern 同源）。 */
export function looksLikeVerify(command, verifyRe) {
  if (typeof command !== 'string' || command === '') return false
  // echo / Write-Output / printf 只是打印，不是验证
  if (/^\s*(echo|Write-Output|printf)\b/iu.test(command)) return false
  // 2026-11-15 修 P2-3：**引号里的字样不算真的跑了那条命令**。
  // 实测踩到：一个 node 脚本的参数里含 command: "npm test"，被记成一次验证。
  // 只对"去掉引号内容后"的文本做匹配：真实的 `npm test`（以及 `npm test -- "x"`）仍然命中。
  const unquoted = command.replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1/gu, ' ')
  return verifyRe instanceof RegExp ? verifyRe.test(unquoted) : false
}

/**
 * 命令是否"干净到退出码可信"。
 *
 * 2026-11-14 实测抓到：`npm test | Select-Object ...; "EXIT=$LASTEXITCODE"` 这种写法里，
 * shell 的退出码来自最后一条语句，失败的 npm 会被记成成功。
 * 出现管道、分号、&& / || 或换行时，退出码不再代表那条验证命令。
 */
export function ambiguousShell(command) {
  if (typeof command !== 'string') return true
  return /[|;]|&&|\|\||\r|\n/u.test(command)
}

/**
 * 从工具结果里取退出码。
 *
 * 2026-11-14 实测（独立测试会话）：pwsh 工具的 result 里**没有** exitCode 字段，
 * 退出码只出现在输出文本末尾 `[exit code: 1]`。所以这里必须先看结构化字段，
 * 再看文本，两者取不到才算未知。
 * @param {object} result
 * @param {string} [text] 结果文本（调用方用 resultText 提取）
 * @returns {number | undefined}
 */
export function exitCodeOf(result, text) {
  const value = result?.value
  const candidates = [
    value?.exitCode,
    value?.exit_code,
    value?.code,
    value?.result?.exitCode,
    value?.meta?.exitCode,
  ]
  for (const candidate of candidates) {
    if (Number.isFinite(candidate)) return Number(candidate)
  }
  if (typeof text === 'string' && text !== '') {
    // pwsh 工具会在输出末尾标注退出码；取**最后**一处（前面可能是命令自己的输出）
    const matches = [...text.matchAll(/\[exit code:\s*(-?\d+)\]/gu)]
    if (matches.length > 0) {
      const last = matches[matches.length - 1]
      const code = Number(last[1])
      if (Number.isFinite(code)) return code
    }
  }
  return undefined
}

/**
 * 汇总成一次验证记录。
 * @param {{ result: object, command: string, verifyRe: RegExp, text?: string }} options
 * @returns {{ ok: boolean|null, exitCode?: number, source: string } | undefined}
 *   undefined = 不是验证命令；ok:null = 是验证但结果不可判定
 */
export function verifyOutcome(options) {
  const { result, command, verifyRe, text } = options
  if (!looksLikeVerify(command, verifyRe)) return undefined

  const exitCode = exitCodeOf(result, text)

  // 复合命令的退出码不可信 —— 宁可记"未知"，也不冒充成功
  if (ambiguousShell(command)) {
    return {
      ok: null,
      exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
      source: 'ambiguous-shell',
    }
  }

  if (Number.isFinite(exitCode)) {
    return { ok: exitCode === 0, exitCode, source: 'exit-code' }
  }

  // 2026-11-14 修 B1：**绝不用 isError 兜底成成功**。
  // 工具调用成功 ≠ 命令成功：exitCode 缺失时 isError 往往仍是 false，
  // 用它判"验证通过"会把失败的测试记成绿灯（独立测试会话实测复现）。
  if (typeof result?.isError === 'boolean') {
    return { ok: null, source: 'is-error-unreliable' }
  }
  return { ok: null, source: 'unknown' }
}
