# dsh-work-guard

**Working discipline for coding agents — enforced, not suggested.**

> Honest scope: the logic is covered by 54 tests and the packed bundle is verified to import
> standalone, but this has only been run on the author's Windows machine. Linux/macOS path
> handling and a fresh-profile install are **unverified** (see Known limits).

Telling a model "read the file first" is advice. Advice competes with the urge to finish the
task, and loses. This plugin turns three habits into mechanisms:

| Mechanism | What it does |
|---|---|
| **Read before write** | `write` / `edit` on a source file that was not read in this session is **denied**. |
| **Read freshness** | Denied when the file changed after you read it (2 s clock-skew tolerance). |
| **Read depth** | Denied when the edited lines fall outside the ranges you actually read; replacing a file wholesale needs a full read. |
| **Script declarations** | Shell writes are not blocked, but anything not declared with `work_declare` stays visible as unaccounted work. |
| **Red → green evidence** | Verification output is parsed for failing test names; a fix that had red tests must turn them green. |
| **Change ledger** | Every write/edit, every build command, and every detected bypass is appended to one JSONL file. |
| **Bypass detection** | Shell writes never pass through the tool layer. After a shell call the guard scans for recently modified sources with no matching ledger entry and records them as `bypass`. |
| **Prompt section** | Six habits plus two self-check questions, injected through `systemPrompt.section` so they arrive with **every** request instead of living in a document the model may never open. |
| **Status bar** | A green dot under the composer: gate alive, edits today, verifications, unverified changes, bypass count. |
| **One code-health rule** | `remember { derivedStateOf { … } }` — a keyless `remember` around `derivedStateOf` never recomputes. Denied at write time. **Kotlin-only.** |

## Why this exists

The trigger, quoted from the person this was built for:

> "When you chase a bug, review the code first — don't guess at the problem and then cover it with
> another pile of code."

Everything here comes from that sentence. In one day, the same three failures repeated:

1. **Guessing instead of reading.** A file's text was judged from its shape; the "fix" removed a
   design the user had asked for. No measurement, no question.
2. **Covering the symptom.** The bug lived in one line; the patch added code somewhere else so the
   symptom stopped showing.
3. **Claiming success without evidence.** "Fixed" was said after an edit, before any build.

None of those are solved by a better prompt. They are solved by moving the cost to the moment of
writing: **if the file was not read, the write does not happen.**

## What it does not do

- **It cannot block shell writes.** `pwsh` / `bash` do not go through the tool layer; whether they
  can write is a session-permission question, not a plugin question. The guard records them instead
  of pretending to stop them. The ledger number `bypass` is how that shows up.
- **It does not judge quality.** It knows whether a file was read and whether a build ran, not
  whether the change is correct.
- **No project paths are hardcoded**; project roots are discovered from the files actually
  edited, and rules can be language-scoped. The built-in Kotlin/Compose rule runs **only** in
  Kotlin projects; the three read rules apply everywhere.

## Install

```bash
npm pack                      # produces dsh-work-guard-<version>.tgz
# then, in the harness:
#   plugin_manager install_bundle <absolute path to the tgz>
```

Requires DSH `>=0.2.2-rc.1 <0.2.3-0`.

The plugin registers one HTTP route (`/work-guard/status`), one tool (`work_ledger`), one prompt
section, and one client slot (`conversation.composer.dock`). Removing the bundle removes all of them.

## Data

Everything lives in `<DSH_PROFILE_DIR>/data/`, or `~/.dsh/data/` when that variable is not set
(the Desktop host does not set it) — never in your repository:

```
work-ledger.jsonl        one row per write/edit/verify/bypass/note
work-guard-state.json    files read in the last 24h (so a restart doesn't force re-reading)
work-guard.config.json   optional configuration
```

Ledger rows (`v: 2`):

```json
{"v":2,"ts":1794656070764,"day":"2026-11-14","t":"18:32","kind":"edit","file":"src/a.ts","lines":12}
{"v":2,"ts":...,"kind":"verify","cmd":"./gradlew :app:assembleDebug"}
{"v":2,"ts":...,"kind":"bypass","file":"src/b.ts","cmd":"python patch.py"}
{"v":2,"ts":...,"kind":"note","note":"why this change was made"}
```

Old rows without `ts` are read as UTC (that is what the previous version wrote); new rows carry
milliseconds and a local-time day/clock for display only.

## Configuration (optional)

`<profile>/data/work-guard.config.json`, merged over defaults:

```json
{
  "version": 1,
  "prompt": "…",
  "sourceExtensions": [".ts", ".kt"],
  "verifyPattern": "gradlew|npm test",
  "ledger": { "path": "", "rotateAtRows": 5000 },
  "state": { "readTtlHours": 24 },
  "projectMarkers": ["package.json", ".git"],
  "rules": { "read-before-write": true, "no-unkeyed-derived-state": true }
}
```

Precedence: environment (`DSH_WORK_GUARD_PROMPT`, `DSH_WORK_GUARD_LEDGER`) → file → defaults.
A broken file falls back to defaults; `/work-guard/status` reports `configSource`.

## Adding a rule

A rule is an object; the gate is a registry:

```js
// lib/rules/no-platform-in-core.js
export const id = 'no-platform-in-core'
export const stage = 'pre-write'
export const applies = ctx => ctx.filePath.includes('/core/')
export function check(ctx) {
  return /android\.|process\.platform/u.test(ctx.afterText ?? '')
    ? { deny: id, reason: 'core must not know about platforms' }
    : null
}
```

Register it once (`registerRule(rule)`) — `gate()` does not change.

## Escape hatch

`// work-guard: allow` exempts a line from the `derivedStateOf` rule.
There is no escape from read-before-write: read the file.

## Tests

```bash
npm test        # 等价于 node --test
```

144 cases: path identity, project-root discovery, local-time compatibility, ledger rotation,
config merging, state TTL, rule registry, and the gate's deny/allow behaviour.

## Known limits

- Path identity uses an absolute normalised key; read-tracking also accepts a three-segment tail so
  that relative and absolute paths to the same file compare equal. Two different files with
  identical three-segment tails in one session could be confused — rare, and the cost is a missed
  prompt rather than a blocked edit.
- Bypass scanning walks the repository on shell calls, capped at 200 hits and depth 16.
- Configuration changes need a restart (no hot reload).
- **Web / Desktop only.** `webServer` is a hard dependency (the status route lives there), so in a
  headless or SDK profile the plugin does not activate at all.
- `/work-guard/status` has no authentication; it answers any local process. `recent[]` is reduced
  to file names and contains no command text.
- `read` now records the covered line ranges; an edit outside them is denied. What still cannot be
  checked is whether the read was *understood* — the guard verifies exposure, not comprehension.
- **Only verified on Windows.** Path identity, project-root discovery and ledger rotation pass
  unit tests, but a run on Linux/macOS has not happened yet.
- Ledger rotation and the config file have unit tests but have never triggered in a real session.

## License

MIT
