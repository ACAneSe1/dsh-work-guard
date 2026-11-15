import { detectVerifyCommand, renderSummary, runCommand, summarizeRun } from '../lib/verify-tool.js'

const root = process.cwd()
const detected = detectVerifyCommand(root)
console.log('探测结果:', detected)
if (!detected) process.exit(1)

const started = Date.now()
const run = runCommand({ command: detected.command, cwd: root, timeoutMs: 300_000 })
const summary = summarizeRun({ text: `${run.stdout}\n${run.stderr}`, exitCode: run.exitCode, timedOut: run.timedOut })
const rendered = renderSummary(summary, detected.command)

console.log('--- 模型会看到的全部内容 ---')
console.log(rendered)
console.log('--- 结束 ---')
console.log('渲染行数:', rendered.split('\n').length, '· 用时', Math.round((Date.now() - started) / 1000) + 's')
console.log('原始输出字符数:', `${run.stdout}${run.stderr}`.length)

