/**
 * 本地时间。取代原先一律用 UTC 的写法。
 *
 * 起因（2026-11-14）：台账的 `day` 用的是 `toISOString()`，那是 UTC 的日期。
 * UTC+8 的凌晨 0:00–8:00，`today` 还是前一天——面板上的「今天改了几处」会跳。
 * 现在：`ts`（毫秒）是主键，`day`/`t` 只由本地时区派生，供显示与筛选。
 */

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 本地日期 `YYYY-MM-DD`。 */
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 本地时刻 `HH:MM`。 */
export function localClock(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * 台账时间字段。
 * `ts` 是权威值；`day`/`t` 是派生值，老记录没有 `ts` 时用它们反推。
 */
export function nowParts(date = new Date()) {
  return { ts: date.getTime(), day: localDay(date), t: localClock(date) }
}

/**
 * 把一条台账记录的时间还原成毫秒。
 *
 * 兼容规则（2026-11-14）：
 *   - 有 `ts`：直接用它（新记录）
 *   - 只有 `day`/`t`：**按 UTC 解释** —— 旧的 `nowParts` 用的就是 `toISOString()`，
 *     那些记录里的 12:12 是 UTC 的 12:12。按本地解释会差 8 小时，
 *     于是"10 分钟内写过"判定失败，工具写过的文件被误记成 bypass（今天实际发生）。
 */
export function entryTime(entry) {
  if (entry && Number.isFinite(entry.ts)) return entry.ts
  const day = entry?.day ?? ''
  const clock = entry?.t ?? '00:00'
  if (day !== '') {
    const utc = Date.parse(`${day}T${clock}:00Z`)
    if (Number.isFinite(utc)) return utc
  }
  return 0
}
