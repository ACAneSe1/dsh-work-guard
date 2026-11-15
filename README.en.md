# dsh-work-guard

**Turn "I fixed it" into evidence you can check.**

> English · [中文](README.md)

> Not advice to the model — **four gates and one ledger**: a file you never read cannot be written;
> a failed verification is never recorded as a pass; the tests that were red must go green before
> the work counts as done.
> **Honest scope**: the plugin itself has **only been installed and run on Windows + DSH Desktop**.
> The test suite runs on Linux and Windows (Node 22 / 24) in CI; **macOS and headless profiles are
> unverified**.

## Three things you have probably seen

1. **"Fixed" — and the tests were never run.**
2. **Tests red, report green.** (an empty suite, or a failure recorded as success)
3. **The wrong place edited.** A file judged without reading it, or the first ten lines read and
   line five hundred changed.

This plugin speaks at exactly three moments:

| Question | Its answer |
|---|---|
| Was this file read? | Not read → **write denied** |
| You said "verified" — what was the exit code? | No exit code → recorded as unknown, **not a pass** |
| Are the previously-red tests green now? | Not green → the panel stays red and names them |

## Mechanisms, not suggestions

| Mechanism | What it does |
|---|---|
| **Read before write** | `write` / `edit` on a source file that was not read in this session is **denied**. |
| **Read freshness** | Denied when the file changed after you read it (2 s clock-skew tolerance). |
| **Read depth** | Denied when the edited lines fall outside the ranges you actually read; replacing a file wholesale needs a full read. |
| **Real verification** | `work_verify` runs the project's check and returns a few lines; the exit code is taken by the tool itself, never from a shell pipe. |
| **Red → green** | Failing test names come from the output or the JUnit XML; the same tests must turn green. |
| **Script declarations** | Shell writes are not blocked, but anything not declared with `work_declare` stays visible as unaccounted work. |
| **Change ledger** | Every write, every verification (exit code + failing names), every denial and every bypass goes into one JSONL. |
| **Prompt section** | Nine habits plus two self-check questions, injected through `systemPrompt.section`, so they arrive with **every** request. |
| **UI** | One small button in the composer (pending items + history) and one status line under it: say something when there is something to say, otherwise just "no pending items". |
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

Requires DSH `>=0.2.2-rc.1 <0.4.0-0`.

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
  "verifyPattern": "gradlew|npm test|cargo (build|test)|go test|pytest",
  "ledger": { "path": "", "rotateAtRows": 5000 },
  "state": { "readTtlHours": 24 },
  "projectMarkers": ["package.json", ".git"],
  "rules": {
    "read-before-write": true,
    "read-freshness": true,
    "read-depth": true,
    "no-unkeyed-derived-state": true
  }
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

162 cases: path identity, project-root discovery, local-time compatibility, ledger rotation,
config merging, state TTL, rule registry, and the gate's deny/allow behaviour.

## Known limits

- Path identity is an **absolute normalised key** (`keyOf`). The old three-segment-tail matching was
  removed in 0.3: it let two same-named files in different projects unlock each other. A relative
  path is resolved against known project roots first; when it cannot be resolved the write is denied
  (fail-closed).
- Bypass scanning walks the repository on shell calls, capped at 200 hits and depth 16.
- Configuration changes need a restart (no hot reload).
- **Web / Desktop only.** `webServer` is a hard dependency (the status route lives there), so in a
  headless or SDK profile the plugin does not activate at all.
- `/work-guard/status` has no authentication; it answers any local process. `recent[]` is reduced
  to file names and contains no command text.
- `read` now records the covered line ranges; an edit outside them is denied. What still cannot be
  checked is whether the read was *understood* — the guard verifies exposure, not comprehension.
- **Only installed and run on Windows.** The suite passes on `ubuntu-latest` and `windows-latest`
  (Node 22 / 24, four jobs green in CI), but the plugin has never been registered inside a DSH on
  Linux or macOS — macOS has no evidence at all.
- Ledger rotation and the config file are not on a real-session path, but `tools/verify-extra.mjs`
  exercises them for real (it builds a 5 000-row ledger to trigger rotation, and writes a config
  then re-reads it in a fresh process).

## License

MIT
