/**
 * dsh-work-guard 的浏览器半（2026-11-14）。
 *
 * 界面只有一个入口：输入栏左侧的小按钮。点开是浮层，里面是"待办"。
 * 每条待办可以点「问」——把一句具体的质问发给模型（一次点击 = 一轮，不合并）。
 * 右上角能翻历史：最多保留 10 轮，算上当前这轮共 11。
 *
 * 约束（照 ui-plugin 文档）：
 *   - 工厂不产生副作用；定时器/清理都放在 apply 里或组件 effect 内
 *   - 颜色走宿主主题变量，不写死
 *   - 不替换根、不读别人的 DOM
 */
window.__ModuleLoader__.load({
  id: 'dsh-work-guard',

  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/work-guard/status'
    const POLL_MS = 10000
    const HISTORY_KEY = 'work-guard-ask-history'
    // 用户定义：最多保存 10 轮历史，算上当前这轮一共 11 条
    const HISTORY_MAX = 11

    function useStatus() {
      const [state, setState] = React.useState({ phase: 'loading', data: null })

      React.useEffect(() => {
        let alive = true
        let timer

        const tick = async () => {
          try {
            const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error(String(res.status))
            const data = await res.json()
            if (alive) setState({ phase: 'ok', data })
          } catch {
            if (alive) setState({ phase: 'down', data: null })
          } finally {
            if (alive) timer = setTimeout(tick, POLL_MS)
          }
        }

        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      return state
    }

    function formatClock(ts) {
      const d = new Date(Number(ts) || 0)
      const p = n => String(n).padStart(2, '0')
      return `${p(d.getHours())}:${p(d.getMinutes())}`
    }

    /** 历史存在 localStorage：刷新页面不丢，最多 10 条。 */
    function readHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        const list = raw ? JSON.parse(raw) : []
        return Array.isArray(list) ? list.filter(item => item && typeof item.text === 'string').slice(-HISTORY_MAX) : []
      } catch {
        return []
      }
    }

    function writeHistory(list) {
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)))
      } catch {
        // 存储不可用时只影响历史，不影响发送
      }
    }

    /**
     * 事件提示：拒绝/发现绕过时弹一条，5 秒后自己消失。
     */
    function useEventToast(lastEvent) {
      const [toast, setToast] = React.useState(null)
      const seenRef = React.useRef(0)

      React.useEffect(() => {
        if (!lastEvent || !Number.isFinite(lastEvent.ts)) return
        if (lastEvent.ts <= seenRef.current) return
        if (Date.now() - lastEvent.ts > 30_000) {
          seenRef.current = lastEvent.ts
          return
        }
        seenRef.current = lastEvent.ts
        setToast(lastEvent)
        const timer = setTimeout(() => setToast(null), 5000)
        return () => clearTimeout(timer)
      }, [lastEvent?.ts])

      return toast
    }

    function toastText(event) {
      if (!event) return ''
      if (event.kind === 'deny') {
        const name = String(event.file ?? '').split(/[\\/]/u).slice(-2).join('/')
        return `闸门拦下：${event.rule ?? '规则'} · ${name}`
      }
      if (event.kind === 'bypass') return `脚本改了 ${event.count ?? 1} 个文件（未走工具）`
      return ''
    }

    /**
     * 把一句话送到模型那里。
     *
     * 真实 API（用户截图确认）：insertQuote, captureInsertion, insertText, setDraft,
     * persistDraft, addAttachments, removeAttachment, pruneAttachments, submit
     *
     * **submit 不接收文本**——它提交的是输入框里已有的草稿。
     * 所以固定顺序：setDraft(text) → submit()；submit 抛错就退回"已填入"。
     *
     * @returns {'sent'|'filled'|'copied'|'failed'}
     */
    function sendToModel(props, text) {
      const actions = props?.inputActions
      if (actions) {
        const writeDraft = typeof actions.setDraft === 'function'
          ? () => actions.setDraft(text)
          : (typeof actions.insertText === 'function' ? () => actions.insertText(text) : undefined)

        if (writeDraft !== undefined) {
          try {
            writeDraft()
          } catch {
            // 写不进草稿，走剪贴板兜底
          }
          if (typeof actions.submit === 'function') {
            try {
              actions.submit()
              return 'sent'
            } catch {
              return 'filled'
            }
          }
          return 'filled'
        }
      }
      try {
        navigator.clipboard.writeText(text)
        return 'copied'
      } catch {
        return 'failed'
      }
    }

    /** 每条待办对应一句可以直接发过去的质问。 */
    function questionFor(item, data) {
      if (item.level === 'block' && /红测试/.test(item.title)) {
        const names = Array.isArray(data?.fixEvidence?.stillFailing) ? data.fixEvidence.stillFailing : []
        return `这些测试还没变绿：${names.slice(0, 5).join('、')}。请说明为什么还没绿，并让它真的通过——不要用别处的代码把现象盖住。`
      }
      if (item.level === 'block') {
        return `你这次改了 ${data?.unverified ?? 0} 处但没有验证。请跑相关测试，把真实输出（含退出码）贴出来；命令要单独一条，别加管道。`
      }
      if (/脚本/.test(item.title)) {
        const files = Array.isArray(data?.undeclared?.files) ? data.undeclared.files : []
        return `这些文件是脚本改的：${files.slice(0, 5).join('、')}。请用 work_declare 申报，或者说明为什么不用申报。`
      }
      return '本会话的写入没有经过闸门。请说明你用的是什么方式写的，以及为什么。'
    }

    /**
     * 输入栏里的小按钮。
     *
     * 内容刻意少：待办（最多 3 条）、脚本改过的文件名（最多 3 个）、一行计数。
     * 每条待办带一个「问」：一次点击 = 一轮，只发这一条，不合并。
     */
    function GuardButton(props) {
      const { data } = useStatus()
      const toast = useEventToast(data?.lastEvent)
      const [open, setOpen] = React.useState(false)
      const [view, setView] = React.useState('todo') // 'todo' | 'history'
      const [notice, setNotice] = React.useState('')
      const [history, setHistory] = React.useState(readHistory)
      const boxRef = React.useRef(null)

      const muted = 'var(--muted-foreground, #8b8b8b)'
      const fg = 'var(--foreground, #e6e6e6)'
      const warn = 'var(--warning, #d9a441)'
      const danger = 'var(--destructive, #e5484d)'
      const okColor = 'var(--success, #3fb950)'

      React.useEffect(() => {
        if (!open) return undefined
        const onDown = event => {
          if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false)
        }
        const onKey = event => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      const alive = data && data.alive === true
      const verdicts = alive && Array.isArray(data.verdicts) ? data.verdicts : []
      const pending = verdicts.filter(item => item.level !== 'ok')
      const worst = pending.some(item => item.level === 'block') ? 'block' : (pending.length > 0 ? 'warn' : 'ok')
      const color = !alive ? muted : (worst === 'block' ? danger : (worst === 'warn' ? warn : okColor))
      const label = !alive ? '证据' : (pending.length === 0 ? '无待办' : `${pending.length} 项`)
      const files = alive && Array.isArray(data.undeclared?.items) ? data.undeclared.items.slice(0, 3) : []

      const nextRound = history.length === 0 ? 1 : (Number(history[history.length - 1].round) || 0) + 1

      const ask = (item) => {
        const text = questionFor(item, data)
        const result = sendToModel(props, text)
        setNotice(
          result === 'sent'
            ? `第 ${nextRound} 轮已发出（模型会开始回答）`
            : (result === 'filled'
              ? `第 ${nextRound} 轮已填入输入框，按回车才发送`
              : (result === 'copied' ? '已复制到剪贴板，粘贴到输入框' : '没发出去：没有可用的输入接口')),
        )
        // 只有真的发出去才算一轮；填进草稿也记，但标注清楚
        const entry = { round: nextRound, at: Date.now(), title: item.title, text, sent: result === 'sent' }
        const list = [...history, entry].slice(-HISTORY_MAX)
        setHistory(list)
        writeHistory(list)
      }

      const refill = (entry) => {
        const result = sendToModel({ ...props, inputActions: { ...(props?.inputActions ?? {}), submit: undefined } }, entry.text)
        setNotice(result === 'filled' || result === 'sent' ? '已重新填入输入框' : '无法填入，请复制历史文本')
      }

      const buttonStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid var(--border, rgba(127,127,127,0.24))',
        background: open ? 'var(--muted, rgba(127,127,127,0.12))' : 'transparent',
        color: worst === 'ok' || !alive ? muted : fg,
        font: '11px/1.2 var(--font-sans, system-ui, sans-serif)',
        cursor: 'pointer',
        userSelect: 'none',
      }
      const dot = { width: 6, height: 6, borderRadius: 3, background: color, flex: '0 0 auto' }
      const panel = {
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        zIndex: 40,
        width: 320,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--border, rgba(127,127,127,0.24))',
        background: 'var(--popover, #1b1b1e)',
        color: fg,
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        font: '11px/1.5 var(--font-sans, system-ui, sans-serif)',
      }
      const rowStyle = { display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0' }
      const small = { color: muted, fontSize: 10 }
      const askStyle = {
        marginLeft: 'auto',
        flex: '0 0 auto',
        padding: '1px 6px',
        borderRadius: 6,
        border: '1px solid var(--border, rgba(127,127,127,0.28))',
        background: 'transparent',
        color: muted,
        font: '10px/1.6 var(--font-sans, system-ui, sans-serif)',
        cursor: 'pointer',
      }
      const tabStyle = active => ({
        padding: '1px 6px',
        borderRadius: 6,
        border: '1px solid var(--border, rgba(127,127,127,0.28))',
        background: active ? 'var(--muted, rgba(127,127,127,0.16))' : 'transparent',
        color: active ? fg : muted,
        font: '10px/1.6 var(--font-sans, system-ui, sans-serif)',
        cursor: 'pointer',
      })

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
        h('button', { type: 'button', style: tabStyle(view === 'todo'), onClick: () => setView('todo') }, `待办 ${pending.length}`),
        h('span', { style: { flex: 1 } }),
        h('button', { type: 'button', style: tabStyle(view === 'history'), onClick: () => setView('history') }, `历史 ${history.length}/${HISTORY_MAX}`),
      )

      const todoBody = view === 'todo'
        ? (pending.length === 0
          ? h('div', { style: rowStyle }, h('span', { style: { color: okColor } }, '✓'), h('span', null, '没有待办'))
          : pending.slice(0, 3).map((item, index) => h('div', { key: `v${index}`, style: { ...rowStyle, alignItems: 'center' } },
            h('span', { style: { color: item.level === 'block' ? danger : warn } }, item.level === 'block' ? '⛔' : '⚠'),
            h('span', { style: { flex: 1 } }, item.title),
            h('button', { type: 'button', style: askStyle, title: '把这一条发给模型（一轮一条）', onClick: () => ask(item) }, '问'),
          )))
        : (history.length === 0
          ? h('div', { style: { ...small, padding: '6px 0' } }, '还没有问过。')
          : history.slice().reverse().map((entry, index) => h('div', { key: `h${index}`, style: { ...rowStyle, alignItems: 'center' } },
            h('span', { style: { color: muted, width: 30 } }, `#${entry.round}`),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: entry.text }, entry.title),
            h('span', { style: small }, formatClock(entry.at)),
            h('span', { style: { color: entry.sent ? okColor : warn } }, entry.sent ? '已发' : '草稿'),
            h('button', { type: 'button', style: askStyle, title: '重新填入输入框', onClick: () => refill(entry) }, '再填'),
          )))

      return h('div', { style: { position: 'relative', display: 'inline-block' }, ref: boxRef },
        toast ? h('div', { role: 'status', style: { ...small, marginBottom: 2, maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, toastText(toast)) : null,
        h('button', { type: 'button', style: buttonStyle, onClick: () => setOpen(value => !value), 'aria-expanded': open },
          h('span', { style: dot }),
          label,
        ),
        open ? h('div', { style: panel },
          header,
          todoBody,

          view === 'todo' && pending.length > 0 && pending[0].action
            ? h('div', { style: { ...small, paddingLeft: 16, marginTop: 2 } }, `→ ${pending[0].action}`)
            : null,

          view === 'todo' && files.length > 0
            ? h('div', { style: { ...small, marginTop: 8 } },
              '脚本改过：',
              ...files.map((item, index) => h('span', { key: `f${index}`, style: { marginRight: 6 } }, String(item.file ?? '').split(/[\\/]/u).slice(-1)[0])),
            )
            : null,

          view === 'todo' && alive
            ? h('div', { style: { ...small, marginTop: 8 } }, `本次 ${data.edits ?? 0} 处修改 · ${data.verifies ?? 0} 次验证 · ${data.undeclared?.count ?? 0} 处脚本改动没交代`)
            : null,

          notice ? h('div', { role: 'status', style: { marginTop: 8, color: okColor, fontSize: 11 } }, notice) : null,
        ) : null,
      )
    }

    /**
     * 输入框下方的状态行（2026-11-14 加回）。
     *
     * 用词按用户要求换过：不写"改/验/绕过"这种缩写，也不吓人。
     *   - 有欠账：只显示那一句（⛔/⚠ + 一句话）
     *   - 没欠账：显示一行计数（本次 N 处修改 · N 次验证 · N 处脚本改动）
     */
    function StatusLine() {
      const { data } = useStatus()
      const toast = useEventToast(data?.lastEvent)

      const muted = 'var(--muted-foreground, #8b8b8b)'
      const fg = 'var(--foreground, #e6e6e6)'
      const warn = 'var(--warning, #d9a441)'
      const danger = 'var(--destructive, #e5484d)'
      const okColor = 'var(--success, #3fb950)'

      const base = {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 12px',
        font: '11px/1.4 var(--font-sans, system-ui, sans-serif)',
        color: muted,
        userSelect: 'none',
      }

      if (!data || data.alive !== true) {
        return h('div', { style: base, title: '状态接口没有响应：插件可能没加载' },
          h('span', { style: { width: 6, height: 6, borderRadius: 3, background: danger } }),
          h('span', { style: { color: danger } }, '工作证据没连上'),
        )
      }

      const verdicts = Array.isArray(data.verdicts) ? data.verdicts : []
      const pending = verdicts.filter(item => item.level !== 'ok')
      const worst = pending.some(item => item.level === 'block') ? 'block' : (pending.length > 0 ? 'warn' : 'ok')
      const color = worst === 'block' ? danger : (worst === 'warn' ? warn : okColor)

      const counts = `本次 ${data.edits ?? 0} 处修改 · ${data.verifies ?? 0} 次验证 · ${data.primary?.bypass ?? data.bypass ?? 0} 处脚本改动`
      const detail = [
        ...verdicts.map(item => `${item.level === 'ok' ? '✓' : (item.level === 'block' ? '⛔' : '⚠')} ${item.title}${item.action ? ' → ' + item.action : ''}`),
        '',
        `${counts} · 台账 ${data.ledgerRows ?? 0} 条`,
      ].join('\n')

      return h('div', { style: base, title: detail },
        toast ? h('span', { style: { maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, toastText(toast)) : null,
        h('span', { style: { width: 6, height: 6, borderRadius: 3, background: color } }),
        pending.length > 0
          ? h('span', { style: { color: fg } }, pending[0].title)
          : h('span', null, counts),
        pending.length > 1 ? h('span', { style: { color: muted } }, `（另有 ${pending.length - 1} 项）`) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 输入框下方一行状态（原有的位置，用词已换）
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'work-guard-status', order: 5 },
            StatusLine,
          ),
        )
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'work-guard', order: 40 },
            GuardButton,
          ),
        )
      },
    }
  },
})
