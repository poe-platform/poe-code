# Design System Multi-Format Output

## Goal

Make every design-system component render correctly in three output formats:
- **terminal** (rich) — current behavior: ANSI colors, Unicode symbols, box drawing
- **markdown** — plain markdown: `#` headings, `**bold**`, `- ` lists, pipe tables
- **json** — structured JSON objects

With a default format (from `OUTPUT_FORMAT` env var) and per-scope override capability.

## Current State

| Component | terminal | markdown | json |
|-----------|----------|----------|------|
| `renderTable` | ✅ | ✅ | ✅ |
| `intro` | ✅ | ✅ | ✅ (silent) |
| `introPlain` | ✅ | ✅ | ✅ (silent) |
| `outro` | ✅ | ❌ (silent) | ❌ (silent) |
| `note` | ✅ | ❌ (silent) | ❌ (silent) |
| `withSpinner` | ✅ | ❌ | ✅ (raw) |
| `logger.*` | ✅ | ❌ (plain text) | ❌ (plain text) |
| `text.*` | ✅ | ❌ | ❌ |
| `symbols` | ✅ | ❌ | ❌ |
| `help-formatter` | ✅ | ❌ | ❌ |
| `acp.*` | ✅ | ❌ | ❌ |
| `static/*` | ✅ | ❌ | ❌ |

## Design Decisions

### 0. Replace `@clack/prompts` for non-interactive primitives

We currently wrap clack and hack around it for format awareness. The non-interactive surface we use is small and simple — we should own it.

**What we use from clack (production):**

| Clack API | Usage | Complexity |
|-----------|-------|------------|
| `clack.intro(text)` | Styled bar + text | ~15 lines |
| `clack.outro(message)` | Closing bar + text | ~10 lines |
| `clack.note(message, title)` | Boxed message | ~20 lines |
| `clack.log.message/warn/error` | Symbol-prefixed lines with bar | ~15 lines each |
| `clack.spinner()` | Animated dots with message | ~40 lines |
| `clack.isCancel(val)` | Check cancel symbol | 1 line |
| `clack.cancel(msg)` | Show cancel message | ~5 lines |

**What we keep from clack (for now):**

| Clack API | Reason |
|-----------|--------|
| `clack.select` | Complex interactive (stdin, cursor, key events) |
| `clack.text` | Complex interactive |
| `clack.confirm` | Complex interactive |
| `clack.password` | Complex interactive (masked input) |

**Approach:** Replace non-interactive primitives with own implementations in `src/prompts/primitives/`. Each primitive is format-aware from the start — no wrapping needed. Interactive prompts stay on clack for now but behind our own types (drop the `Parameters<typeof clack.X>[0]` hack, define our own interfaces).

**Own primitives to implement:**

```
src/prompts/primitives/intro.ts     — bar + styled text (terminal), # heading (md), noop (json)
src/prompts/primitives/outro.ts     — closing bar (terminal), --- (md), json obj (json)
src/prompts/primitives/note.ts      — boxed note (terminal), blockquote (md), json obj (json)
src/prompts/primitives/log.ts       — symbol-prefixed lines (terminal), markdown list (md), NDJSON (json)
src/prompts/primitives/spinner.ts   — animated dots (terminal), plain text (md), json obj (json)
src/prompts/primitives/cancel.ts    — cancel symbol + message
```

The terminal rendering for these follows the same visual style as clack (bar character, box drawing, symbols) — we're replacing the implementation, not the design. The `promptTheme` symbols config stays.

**Type ownership for interactive prompts:**

```typescript
// Before (hacked from clack):
export type SelectOptions<Value> = Parameters<typeof clack.select<Value>>[0];

// After (owned):
export interface SelectOptions<Value> {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValue?: Value;
}
```

This decouples our public types from clack internals. If we replace interactive prompts later, consumers don't change.

### 1. Override mechanism

Keep `OUTPUT_FORMAT` env var as the global default. Add a scoped override:

```typescript
import { withOutputFormat } from "@poe-code/design-system";

// Scoped override — format reverts after callback
withOutputFormat("json", () => {
  logger.info("this renders as JSON");
});

// For async
await withOutputFormat("markdown", async () => {
  await doSomething();
});
```

Implementation: use `AsyncLocalStorage` to store a format override that takes precedence over the env-var-based cached value in `resolveOutputFormat()`.

```typescript
// output-format.ts additions
import { AsyncLocalStorage } from "node:async_hooks";

const formatStorage = new AsyncLocalStorage<OutputFormat>();

export function resolveOutputFormat(env = process.env): OutputFormat {
  // 1. Check scoped override first
  const scoped = formatStorage.getStore();
  if (scoped) return scoped;
  // 2. Fall back to env/cache
  if (cached) return cached;
  const raw = env.OUTPUT_FORMAT?.toLowerCase();
  cached = VALID_FORMATS.has(raw as OutputFormat) ? (raw as OutputFormat) : "terminal";
  return cached;
}

export function withOutputFormat<T>(format: OutputFormat, fn: () => T): T {
  return formatStorage.run(format, fn);
}
```

This is zero-breaking-change: every existing call to `resolveOutputFormat()` automatically picks up scoped overrides. No API changes needed on individual components.

### 2. `stripAnsi` — deduplicate

`stripAnsi` is currently duplicated in `table.ts` and `prompts/index.ts`. Extract to a shared internal utility.

```
src/internal/strip-ansi.ts
```

### 3. `text.*` — format-aware string returns

The `text` object functions currently return ANSI-styled strings. They need to return format-appropriate strings.

**terminal:** current behavior (ANSI)
**markdown:** markdown formatting equivalents
**json:** plain text (no decoration)

| Function | terminal | markdown | json |
|----------|----------|----------|------|
| `intro(s)` | `chalk.bgMagenta(...)` | `**${s}**` | `s` |
| `heading(s)` | `theme.header(s)` | `## ${s}` | `s` |
| `section(s)` | `bold(s)` | `**${s}**` | `s` |
| `command(s)` | `theme.accent(s)` | `` `${s}` `` | `s` |
| `argument(s)` | `theme.muted(s)` | `\<${s}\>` | `s` |
| `option(s)` | `chalk.yellow(s)` | `` `${s}` `` | `s` |
| `example(s)` | `theme.muted(s)` | `` `${s}` `` | `s` |
| `usageCommand(s)` | `chalk.green(s)` | `` `${s}` `` | `s` |
| `link(s)` | `theme.accent(s)` | `[${s}](${s})` | `s` |
| `muted(s)` | `theme.muted(s)` | `*${s}*` | `s` |
| `badge(s)` | `theme.badge(s)` | `[${s}]` | `s` |
| `selectLabel(l,d)` | current | `${l} — ${d}` | `${l} — ${d}` |

Implementation pattern — dispatch inside each function:

```typescript
intro(content: string): string {
  const format = resolveOutputFormat();
  if (format === "json") return content;
  if (format === "markdown") return `**${content}**`;
  return getTheme().intro(content);
},
```

### 4. `symbols` — format-aware

| Symbol | terminal | markdown | json |
|--------|----------|----------|------|
| `info` | `chalk.magenta("●")` | `(i)` | `info` |
| `success` | `chalk.magenta("◆")` | `[ok]` | `success` |
| `resolved` | `theme.resolvedSymbol` | `>` | `resolved` |
| `errorResolved` | `theme.errorSymbol` | `[!]` | `error` |
| `warning` | `▲` | `[!]` | `warning` |
| `active` | `◆` | `[x]` | `active` |
| `inactive` | `○` | `[ ]` | `inactive` |
| `bar` | `│` | `|` | (omit) |

### 5. `logger` — proper format dispatch

Currently: terminal uses `@clack/prompts` log, non-terminal writes plain text.

**markdown format:**
```
- **info:** Configuring claude-code...
- **success:** Configuration complete!
- > **warning:** API key expires in 7 days
- > **error:** Failed to write config file
- **API Key:** poe-abc...xyz
```

**json format:**
```json
{"level":"info","message":"Configuring claude-code..."}
{"level":"success","message":"Configuration complete!"}
{"level":"warn","message":"API key expires in 7 days"}
{"level":"error","message":"Failed to write config file"}
{"level":"resolved","label":"API Key","value":"poe-abc...xyz"}
```

JSON uses NDJSON (one JSON object per line) — easy to parse, stream-friendly.

### 6. `prompts` — markdown & json for `outro`, `note`

**`outro`:**
- markdown: `---\n${message}\n`
- json: `{"type":"outro","message":"..."}`

**`note`:**
- markdown: `> **${title}**\n> ${message}` (blockquote)
- json: `{"type":"note","title":"...","message":"..."}`

**`withSpinner`:**
- markdown: print start/stop messages as plain text
- json: already handled, keep as-is

Interactive prompts (`select`, `text`, `confirm`, `password`) remain terminal-only — they require TTY. No change needed.

### 7. `acp/components` — format dispatch

Currently writes directly to stdout with chalk. Add format branching:

**markdown:**
```
- **agent:** message text
- *→ exec: title*
- *✓ exec*
- *thinking:* truncated text...
- **tokens:** 1000 in → 500 out ($0.01)
- **error:** message
```

**json (NDJSON):**
```json
{"type":"agent","message":"..."}
{"type":"tool_start","kind":"exec","title":"..."}
{"type":"tool_complete","kind":"exec"}
{"type":"reasoning","text":"..."}
{"type":"usage","input":1000,"output":500,"cached":0,"costUsd":0.01}
{"type":"error","message":"..."}
```

### 8. `help-formatter` — no direct changes needed

Delegates to `text.*` and `widths`. Once `text.*` is format-aware, help-formatter output will automatically adapt. Padding via `.padEnd()` works in all formats since it's just spaces.

### 9. `static/*` — format dispatch

Static renderers (`renderSpinnerFrame`, `renderSpinnerStopped`, `renderMenu`) are used for screenshots and tests. Add format branches:

**Spinner (markdown):** `- Processing... [1s]` / `- Complete! [2s]`
**Spinner (json):** `{"type":"spinner","state":"running"|"stopped","message":"...","timer":"1s"}`

**Menu (markdown):**
```
**Pick an agent:**
- [x] Claude Code
- [ ] Codex CLI
```

**Menu (json):**
```json
{"type":"menu","message":"Pick an agent:","options":[...],"selected":0}
```

### 10. `command-errors` — no direct changes

Delegates to `text.*` and `typography`. Gets format support for free.

### 11. Documentation generation

After implementation, run `npm run generate:design-docs` to regenerate `DESIGN_LANGUAGE.md` (rich/terminal).

Add two new generated docs:
- `docs/DESIGN_LANGUAGE_JSON.md` — shows JSON output for each component
- `docs/DESIGN_LANGUAGE_MARKDOWN.md` — shows markdown output for each component

These can be generated by running the demo script with `OUTPUT_FORMAT=json` and `OUTPUT_FORMAT=markdown`.

## Implementation Order

Each step is independently shippable and testable.

### Phase 1: Foundation
1. Extract `stripAnsi` to `src/internal/strip-ansi.ts`, deduplicate
2. Add `AsyncLocalStorage`-based `withOutputFormat` to `output-format.ts`
3. Tests for `withOutputFormat` (scoping, nesting, async)

### Phase 2: Replace clack non-interactive primitives
4. Own type definitions for interactive prompts (decouple from `Parameters<typeof clack.X>`)
5. Implement `src/prompts/primitives/log.ts` — replaces `clack.log.message/warn/error`
6. Implement `src/prompts/primitives/intro.ts` — replaces `clack.intro`
7. Implement `src/prompts/primitives/outro.ts` — replaces `clack.outro`
8. Implement `src/prompts/primitives/note.ts` — replaces `clack.note`
9. Implement `src/prompts/primitives/spinner.ts` — replaces `clack.spinner`
10. Implement `src/prompts/primitives/cancel.ts` — replaces `clack.cancel/isCancel`
11. Update `src/prompts/index.ts` to use own primitives instead of clack
12. Update `src/components/logger.ts` to use own log primitive
13. Remove `@clack/prompts` from non-interactive imports, verify no visual regression via screenshots
14. Tests for each primitive in all 3 formats

### Phase 3: Core components
15. `text.*` — add format dispatch to all functions
16. `symbols` — add format-aware getters
17. Tests for text + symbols in all 3 formats

### Phase 4: Remaining components
18. `acp/components` — format dispatch for all render functions
19. `static/*` — format branches for spinner and menu
20. Tests

### Phase 5: Docs & validation
21. Generate `DESIGN_LANGUAGE_MARKDOWN.md` and `DESIGN_LANGUAGE_JSON.md`
22. Update generate script to produce all 3 variants
23. Visual validation via screenshots — verify terminal output unchanged

## Testing Strategy

**Zero regressions on terminal output.** The rich/terminal format must look identical before and after every phase. Screenshots are the enforcement mechanism.

### Baseline (capture before any code changes)

**Design elements — all 30 components via `generate:design-docs`:**

```sh
npm run generate:design-docs
```

This captures every design element to `docs/design-language/` (layout-basic, layout-expanded, intro, heading, section, command, argument, option, example, usageCommand, link, muted, info, success, resolved, errorResolved, log-info, log-success, log-warn, log-error, prompt-intro, prompt-note, prompt-outro, prompt-resolved, prompt-errorResolved, menu, spinner-dots, spinner-timer, table, diff).

**poe-code commands:**

```sh
npm run screenshot-poe-code -- --help
npm run screenshot-poe-code -- configure --yes
npm run screenshot-poe-code -- configure --yes --agent claude
npm run screenshot-poe-code -- models
```

Store all outputs as the reference. Re-run and compare after every phase.

### Terminal-pilot: interactive regression scenarios

Drive via `npx tsx packages/terminal-pilot/src/mcp-server.ts mcp`. Run after Phase 2 (highest risk — clack replacement).

**Scenario 1: agent select navigation**

```json
terminal_create_session → command: "npm", args: ["run","dev","--silent","--","configure"], cols: 120, rows: 40
terminal_wait_for       → pattern: "Pick an agent"
terminal_read_screen    → assert: menu visible, active item highlighted with ◆, inactive items ○
terminal_press_key      → key: "ArrowDown"
terminal_read_screen    → assert: selection moved, correct item highlighted
terminal_press_key      → key: "Enter"
terminal_wait_for       → pattern: "model|configured|Waiting"
terminal_read_screen    → assert: next step rendered correctly
terminal_close_session
```

**Scenario 2: cancel mid-flow**

```json
terminal_create_session → same as above
terminal_wait_for       → pattern: "Pick an agent"
terminal_send_signal    → signal: "SIGINT"
terminal_read_history   → last: 10
// assert: cancellation message present, no garbled output, clean exit
terminal_close_session
```

**Scenario 3: full non-interactive flow**

```json
terminal_create_session → command: "npm", args: ["run","dev","--silent","--","configure","--yes","--agent","claude"]
terminal_wait_for       → pattern: "configured|complete"
terminal_read_history   → last: 30
// assert: intro banner contains "Poe -", ◇ before resolved key/value pairs, ◆ on success line
terminal_close_session
```

### What to assert in screen reads

| Element | Expected |
|---------|----------|
| Intro banner | Contains `Poe -` with surrounding spaces |
| Resolved symbol | `◇` before each key/value pair |
| Success symbol | `◆` on completion line |
| Select active item | `◆` on selected row, `○` on unselected |
| Note box | `│` border characters present |
| Spinner stop | `◆` before stop message |

### When to run

| Phase | Screenshots | terminal-pilot |
|-------|-------------|----------------|
| Before starting | Capture baseline | — |
| After Phase 2 | **Full comparison — must match baseline exactly** | All 3 scenarios |
| After Phase 3 | Re-run `--help`, `configure --yes` | Scenario 3 |
| After Phase 4 | Re-run `models` | — |

## Not in scope

- Replacing clack interactive prompts (select/confirm/text/password) — complex stdin handling, not worth the risk now. Stay on clack behind owned types.
- Theme changes — themes remain terminal-only concept; markdown/JSON don't use color
- `typography.*` — these are ANSI chalk wrappers, stay terminal-only; `text.*` is the public API that handles format dispatch
