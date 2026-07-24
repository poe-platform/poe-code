---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Explorer TUI overhaul

Rebuild the toolcraft-design explorer on one core so `poe-code plan` (and every other explorer consumer) is fast, smooth, and predictable: correct input parsing, diffed atomic rendering, an fzf-style interaction model, and the two-pane monolith deleted.

## 1. What we're building

The `poe-code plan` browser feels clunky, slow and buggy. The fix is to the underlying pattern/library, not the plan browser: one explorer core in `toolcraft-design` that all consumers (plan-browser, maestro-tui, agent-trace-viewer, agent-stash) share.

Non-goals:

- No new features in plan-browser beyond what falls out of the core fixes.
- No mouse click/drag support (wheel scroll only).
- No inline (non-alt-screen) rendering mode.
- No changes to plan discovery or plan actions' semantics.

## 2. User-facing shape

`poe-code plan` opens the same list + preview layout, but behaves like fzf/lazygit:

```
┌─ Plans ────────────────────────────────────────────────────────── 13/13 ─┐
│ > _                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
┏━ Plans ━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┌─ Preview ──────────────────── 12% ─┐
┃ ▸ ◌ gaslight-crash-resume.md    ┃ │ Gaslight Crash Resume              │
┃     Gaslight Crash Resume       ┃ │ ─────────────────────              │
┃   ◌ 32-agent-goal.md            ┃ │                                    │
┃     Agent goal — autonomous …   ┃ │ Persist Gaslight progress so a…    │
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ └────────────────────────────────────┘
  enter actions   ^e edit   ^p palette   tab focus   esc clear/quit
```

Interaction model (the core change):

- **Typing always filters.** Every printable character goes to the query. No bare-letter hotkey exists anywhere — `j`, `k`, `g`, `a`, `s`, `d`, `e`, `q` are typeable. Pasting is literal (bracketed paste).
- **Navigation**: `↑`/`↓`, `PageUp`/`PageDown`, `Home`/`End`, `Ctrl+U`/`Ctrl+D` (half page), wheel scroll. Cursor keeps a 3-row scroll margin (scrolloff); the viewport never jump-centers.
- **Actions**: `Enter` opens an action menu for the current/selected rows (consumer's actions, destructive ones marked). Each action may declare a `Ctrl+<letter>` accelerator shown in the footer. `Ctrl+P` opens the command palette. Destructive actions always confirm.
- **Escape**: dismiss modal → clear filter → quit. `Ctrl+C` always quits.
- **Focus**: `Tab` cycles panes; the focused pane gets a heavy/accented border, unfocused panes dim. Preview shows a scroll-position indicator.
- **Loading**: opening the explorer paints the frame immediately with a spinner in the pane header while rows load; "No items" appears only after loading resolved empty. Detail loads show the previous content until the new one is ready (no flash), spinner only past 150 ms.
- **Selection**: `Space` toggles (shown as `*`), selection count in the pane footer.

Feel: a keypress paints in the same tick, as one atomic frame — no repaint wave, no flicker, no dropped/misordered characters over ssh/tmux, no stuck "Loading detail…".

Library shape (what consumers see) is unchanged in spirit — declarative `ExplorerConfig` — with panes generalized:

```ts
import { runExplorer } from "toolcraft-design";

const result = await runExplorer<MyResult>({
  title: "Plans",
  panes: [
    { id: "plans", kind: "list", rows: loadRows, emptyHint: "No plans found" },
    { id: "preview", kind: "detail", render: renderPlan },
  ],
  actions: [
    { id: "edit", label: "Edit in $EDITOR", accelerator: "e", handler: edit },
    { id: "delete", label: "Delete", accelerator: "d", destructive: true, handler: del },
  ],
  refresh: discover,
});
```

`agent-stash browse` (list + list) uses the same config with two `kind: "list"` panes — `runTwoPaneExplorer` and `TwoPaneExplorerConfig` are deleted.

## 3. Implementation details and technical decisions

Autonomy audit: everything needed is in-repo — vitest, memfs, terminal-pilot for interactive QA, `npm run screenshot-poe-code`, existing consumers as migration targets. No env vars, credentials, or services required. New env var: `POE_CODE_TUI_TRACE=<path>` replaces the per-consumer trace wiring (writes JSONL key/frame events for debugging; off by default).

### Architecture

All work lands in `packages/toolcraft-design/src`. Three layers, each independently testable:

**Layer 1 — terminal driver (`src/terminal/`)** — replaces `dashboard/terminal.ts` input/output:

- `input.ts`: a stateful streaming parser (explicit state machine, no readline/PassThrough-per-chunk). Carries partial escape sequences across `data` chunks; a lone `ESC` resolves via 50 ms timer, never as a spurious quit. Handles CSI, SS3 (`ESC O A` arrows), bracketed paste (`ESC [200~ … ESC [201~` delivered as one `paste` event), and SGR mouse (`?1006`) wheel events. Emits typed `KeyEvent | PasteEvent | WheelEvent`.
- `output.ts`: per-frame writer. Enables alt screen, hides cursor, enables bracketed paste + mouse wheel + line-wrap off on start; restores all of it on exit, SIGINT, SIGTERM, and uncaughtException. Every frame is one `write()` wrapped in synchronized update (`\x1b[?2026h` … `\x1b[?2026l` — safely ignored by terminals without support). Tracks current SGR state and emits deltas only; coalesces horizontally adjacent changed cells into runs (one cursor move + one style per run, ratatui-style).

**Layer 2 — render core (`src/screen/`)** — replaces `dashboard/buffer.ts` cell handling:

- Cells are plain data: `{ ch: string, width: 1|2, style: number, fg: number, bg: number }` with style as packed bit flags. Diff compares numbers/strings directly — no `cloneCell`, no `normalizeStyle`, no painter chains, zero `Object.defineProperty`. `cellToAnsi`/`createColor` painter usage is removed from the hot path (the fluent painter stays for one-shot formatting elsewhere).
- Double buffer with swap: render into the back buffer, diff against front, swap — no `cloneBuffer` copy per frame. Wide-char diff correctness per ratatui's algorithm (`to_skip`/`invalidated` for 2-cell graphemes).
- Frame scheduler: `dispatch()` marks dirty and schedules a coalesced render on `setImmediate`; any number of state changes between ticks produce one frame (fzf's EventBox latest-wins semantics).
- Width: `terminal-width.ts` gains VS16 (`U+FE0F` promotes to width 2) and measures whole graphemes, not first code points. One `fit`/truncate implementation with ellipsis, used everywhere; `two-pane.ts`'s UTF-16 `slice` version dies with the file.
- Styled consumer content: a small ANSI-to-cells parser so detail/preview panes keep markdown colors instead of `stripAnsi`-to-monochrome.

**Layer 3 — explorer core (`src/explorer/`)** — the existing reducer/runtime, repaired and generalized:

- Panes become an array of `list | detail` regions; layout splits columns by pane count and collapses to the focused pane below 80 columns (fixes the broken 70-col render — the right border loss is the off-by-one in the two-pane layout math, which is deleted). The current single-pane explorer is the degenerate case; agent-stash's two lists is another.
- Keymap: bare printable bindings are rejected at config time (type-to-filter owns them). Sequences (`gg`) are removed. Actions declare `accelerator: "<letter>"` meaning `Ctrl+<letter>`; collisions with core keys (`Ctrl+C/U/D/P`) fail fast at config time. Help modal and footer are generated from the live keymap + actions — never hardcoded.
- Detail jobs: one token, owned by the reducer; `jobs.ts` loses its private counter (fixes the permanent desync that wedges the pane on "Loading detail…"). Abort signals are real: cursor movement aborts the in-flight `render()`. The 100 ms schedule debounce drops to 30 ms; the loading indicator stays at 150 ms; previous content remains visible until replacement.
- Markdown render cache keyed by `(contentHash, width)`; scroll clamps against the wrapped line count the renderer actually displays.
- Suspend (`$EDITOR`) sets a `suspended` flag checked by the scheduler; toast timers and late loads render after resume, never over the editor. `exit()` awaits pending effects. Actions get a `running` flag — re-trigger is a no-op with a toast.
- Cursor is identity-based across `rowsLoaded` (follow the row id, fall back to clamped index).
- `DetailCtx.width/height` report the drawable body rect.

### Edge cases

- Terminal < 60×8: single-pane fallback message (kept), rendered through the same pipeline.
- Filter query containing only whitespace = no filter. Filter survives refresh; cursor follows identity.
- Paste containing newlines: newlines stripped, rest appended to filter.
- Resize mid-modal, mid-suspend, and mid-load: scheduler re-lays out on next frame; suspend records size and re-measures on resume.
- Rows arriving after exit / after a newer request: dropped by request token (kept from current code).
- `NO_COLOR` / dumb terminals: style bits map to nothing; layout identical.

### Config

- `POE_CODE_TUI_TRACE=<path>` (off by default) — JSONL input/frame trace; replaces `TwoPaneExplorerConfig.trace` and agent-stash's per-key file appends.
- No other new env vars or config options. `ExplorerConfig` changes are listed in level 4.

## 4. Interfaces and test plan

### Module-boundary types (toolcraft-design exports)

```ts
// terminal driver
export interface TerminalInputEvent =
  | { type: "key"; name: string; ch?: string; ctrl: boolean; alt: boolean; shift: boolean }
  | { type: "paste"; text: string }
  | { type: "wheel"; direction: "up" | "down"; x: number; y: number };
export interface TerminalDriver {
  start(): void;                      // raw mode, alt screen, paste + wheel on
  stop(): void;                       // full restore; idempotent, signal-safe
  onEvent(fn: (e: TerminalInputEvent) => void): () => void;
  onResize(fn: (size: Size) => void): () => void;
  getSize(): Size;
  writeFrame(ansi: string): void;     // one synchronized-update write
}

// screen
export class Screen {                  // double buffer + diff + run coalescing
  resize(size: Size): void;
  cell(x: number, y: number, ch: string, style?: PackedStyle): void;
  text(x: number, y: number, text: string, style?: PackedStyle): void; // width-aware
  flush(): string;                     // diff vs front buffer, swap, return ANSI
}

// explorer
export interface PaneConfig<R> =
  | { id: string; kind: "list"; title: string; rows: () => Promise<ExplorerRow[]>;
      emptyHint?: string; multiSelect?: boolean }
  | { id: string; kind: "detail"; title: string;
      render: (row: ExplorerRow | undefined, ctx: DetailCtx) => Promise<string> };
export interface ExplorerAction<R> {
  id: string; label: string;
  accelerator?: string;                // single letter -> Ctrl+<letter>
  destructive?: boolean;               // forces confirm modal
  visible?: (row: ExplorerRow) => boolean;
  handler: (ctx: ActionContext<R>) => void | Promise<void>;
}
export interface ExplorerConfig<R> {
  title: string;
  panes: PaneConfig<R>[];              // 1..3
  actions: ExplorerAction<R>[];
  refresh?: () => void | Promise<void>;
}
export function runExplorer<R = void>(config: ExplorerConfig<R>): Promise<R | null>;
```

`ActionContext` keeps today's shape (`row`, `rows`, `refresh`, `suspendAnd`, `toast`, `exit`) plus `activePane`/`inactivePane` for list+list consumers. Deleted exports: `runTwoPaneExplorer`, `TwoPaneExplorerConfig`, `TwoPaneAction`, `TwoPaneRow` (agent-stash migrates in the same change).

### Tests (all memfs/in-memory, no timers left running, sub-second each)

- **Input parser unit tests**: property test — any valid event byte stream split at every possible chunk boundary parses to the same event list as unsplit. Cases: CSI arrows, SS3 arrows, lone ESC (timer fake), bracketed paste with embedded partial-CSI lookalikes, SGR wheel, UTF-8 split across chunks.
- **Screen unit tests**: diff emits only changed cells; adjacent changes coalesce into one run; wide-char overwrite emits invalidated neighbors; SGR delta output for style runs; byte-budget assertion — cursor move on a 200×50 screen emits < 2 KB.
- **Reducer unit tests** (extend existing): no bare-letter action ever fires from a printable key; accelerator collision throws at config time; detail token single-ownership (the `reloadDetail` desync case is a named regression test); identity cursor across refresh; scrolloff window math; suspend guard drops frames.
- **Render snapshot tests** (on-disk snapshots, existing convention): frame text for list+detail, list+list, loading, empty, filtered, modal, palette, < 60-col fallback, 70-col collapse.
- **Consumer contract tests**: plan-browser/maestro-tui/agent-trace-viewer/agent-stash configs build against the new types; agent-stash two-list config renders.

### Real-world test (exact commands, in order)

1. `npm run build`
2. `node dist/bin.cjs plan` in a real terminal (or via terminal-pilot MCP): UI paints with spinner first frame, rows appear, no full-screen flash while moving the cursor.
3. Type `gaslight` — every character lands in the query, list narrows to 1, **no archive/delete/editor opens**.
4. `Backspace` ×8, type `read` — still only filtering (the old killer case: `e`,`a`,`d` were hotkeys).
5. `Enter` — action menu lists Edit/Save/Archive/Delete; `Esc` closes it. `Ctrl+E` suspends to `$EDITOR`; quit editor; screen restores intact.
6. `Tab` — preview border becomes heavy/accented; wheel + `↓` scroll it; indicator shows position; scroll to the true last line.
7. Resize the terminal to 70×20 — layout collapses to one pane with intact right border and footer; resize back — two panes restore.
8. Hold `↓` for 3 s over `ssh localhost` (or tmux) — no spurious exit, no `A` characters in the filter, cursor keeps a 3-row margin from the bottom edge.
9. `poe-code stash browse` (agent-stash) — two lists render on the shared core, spinner while gists load, `Tab` switches, actions run.
10. `npm run screenshot-poe-code -- plan` — visual check of borders, focus accent, footer.

QA doc: `docs/plans/qa/explorer-tui-overhaul-qa.md` describing steps 2–9 as an agent-executable markdown checklist using terminal-pilot.

### Must-work checklist

- [x] Typing any English word into the filter never triggers an action — step 3/4.
- [x] Torn escape sequences never quit the app or leak characters — step 8.
- [x] Cursor-move frame is diffed and atomic: < 2 KB write, no flicker — Screen byte-budget test + step 2.
- [x] Detail pane can never wedge on "Loading detail…" — named regression test + step 6.
- [x] `$EDITOR` round-trip leaves no stray frames on the editor screen — step 5.
- [x] Resize down/up keeps borders and footer intact — step 7.
- [x] agent-stash browse works on the unified core with `runTwoPaneExplorer` deleted — step 9 + `grep -r runTwoPaneExplorer packages/ src/` returns nothing outside git history.
- [x] All four consumers build and their explorer tests pass — `npm test`.

### Rollout / migration

Single release. Consumers migrate in the same commit series (extend-not-duplicate; no compat shim for the deleted two-pane API since all consumers are in-repo). `toolcraft` re-export files (`packages/toolcraft/src/design/run-two-pane-explorer.ts`) are removed; `toolcraft-design` README documents the new config and `POE_CODE_TUI_TRACE`. Mirror any dependency changes onto `toolcraft`/`toolcraft-openapi` per the bundled-deps rule.

## 5. Code plan

Build order keeps main green: each phase lands with its tests, old paths keep working until phase 4 flips consumers.

**Phase 1 — terminal driver** (new, parallel to old code)

- Create `packages/toolcraft-design/src/terminal/input.ts` — streaming parser state machine; `createInputParser(opts: { escTimeoutMs?: number }): { feed(chunk: Buffer): TerminalInputEvent[]; flush(): TerminalInputEvent[] }`.
- Create `src/terminal/output.ts` — `createFrameWriter(stream): { open(): void; close(): void; writeFrame(ansi: string): void }` with 2026 wrap + restore-on-signal.
- Create `src/terminal/driver.ts` — `createTerminalDriver(): TerminalDriver` composing both.
- Tests: `src/terminal/input.test.ts` (chunk-split property test), `output.test.ts` (restore idempotency, 2026 framing).

**Phase 2 — render core**

- Create `src/screen/screen.ts` — `Screen` class (double buffer, packed cells, diff with wide-char invalidation, run coalescing, SGR delta emit); `src/screen/style.ts` — `packStyle`/`styleToSgrDelta`.
- Change `src/dashboard/terminal-width.ts` — VS16 + whole-grapheme measurement; add `truncateToWidth(text, width): string` (ellipsis).
- Create `src/screen/ansi-text.ts` — `ansiToCells(text: string): Cell[]` for styled detail content.
- Tests: `screen.test.ts` (diff/runs/byte budget), width table cases, snapshot harness helper.

**Phase 3 — explorer core on the new layers**

- Change `src/explorer/state.ts`, `reducer.ts` — pane array, identity cursor, single detail token, scrolloff viewport (`visibleStart` with margin), wrapped-line scroll clamp, suspend flag, action `running` flag, config-time keymap validation (`assertNoBareLetterBindings`, `assertAcceleratorsFree`).
- Change `src/explorer/keymap.ts` — remove sequences and stateful `pendingSequence`; accelerators as `ctrl+<letter>`; `keymapToHelp(state): HelpSection[]`.
- Change `src/explorer/jobs.ts` — reducer-owned token, real AbortSignal plumbed to `render()`, 30 ms debounce.
- Change `src/explorer/runtime.ts` — frame scheduler (`setImmediate` coalescing), `Screen`/`TerminalDriver` wiring, delete `cloneBuffer`/`changesToAnsi`, action-menu modal on `Enter`, wheel event routing, `exit()` awaits `pendingEffects`.
- Change `src/explorer/render/{pane,list,detail,modal}.ts` — multi-pane layout + 80-col collapse, focus accent border, scroll indicator, spinner header, delete `listLineCache`, markdown cache `(contentHash, width)`, styled cells via `ansiToCells`, generated help/footer.
- New signatures:
  - `layoutPanes(size: Size, panes: PaneState[], focused: number): Rect[]`
  - `renderDetailCached(content: string, width: number): CachedLines`
- Tests: reducer/keymap/jobs unit tests + on-disk frame snapshots listed in level 4.

**Phase 4 — consumers + deletion**

- Change `packages/plan-browser/src/explorer-config.ts` — actions gain `accelerator` (`e`,`s`,`a`,`d` → Ctrl variants), `destructive: true` on archive/delete; panes array form.
- Change `packages/maestro-tui/src/explorer-config.ts`, `packages/agent-trace-viewer/src/run.ts` — same config-shape migration.
- Change `packages/agent-stash/src/browse.ts` — `buildBrowseTwoPaneConfig` → unified `ExplorerConfig` with two list panes; memoized `loadModel` used by the detail path too; per-key trace wiring removed in favor of `POE_CODE_TUI_TRACE`.
- Delete `src/explorer/two-pane.ts`, `src/run-two-pane-explorer.ts`, `packages/toolcraft/src/design/run-two-pane-explorer.ts`; update `src/index.ts` / `src/explorer/index.ts` exports.
- Change `packages/toolcraft-design/README.md` — new config, env var, keybinding table.
- Create `docs/plans/qa/explorer-tui-overhaul-qa.md` — terminal-pilot QA checklist.

**Phase 5 — polish + verification**

- `npm run generate:design-docs` (visual language changed: borders, focus accent, footer).
- Screenshot pass (`npm run screenshot-poe-code -- plan`), e2e judgement run (`npm run e2e:verbose`), QA doc execution, full must-work checklist.

## Checklist

Work top to bottom; each item lands with its tests and keeps main green.

### Phase 1 — terminal driver

- [x] `src/terminal/input.ts` — streaming parser: CSI + SS3, cross-chunk carry, lone-ESC timer, bracketed paste, SGR wheel
- [x] `src/terminal/input.test.ts` — chunk-split property test (every split point parses identically)
- [x] `src/terminal/output.ts` — frame writer: single write, `?2026` wrap, restore on exit/SIGINT/SIGTERM/uncaughtException
- [x] `src/terminal/output.test.ts` — restore idempotency, 2026 framing
- [x] `src/terminal/driver.ts` — `createTerminalDriver()` composing both

### Phase 2 — render core

- [x] `src/screen/style.ts` — packed style bits, `packStyle`/`styleToSgrDelta`
- [x] `src/screen/screen.ts` — double buffer + swap, diff with wide-char invalidation, run coalescing, SGR delta emit
- [x] `src/screen/screen.test.ts` — diff-only output, run coalescing, wide-char overwrite, < 2 KB cursor-move budget at 200×50
- [x] `src/dashboard/terminal-width.ts` — VS16 + whole-grapheme measurement, `truncateToWidth` with ellipsis
- [x] `src/screen/ansi-text.ts` — `ansiToCells` so detail panes keep color

### Phase 3 — explorer core

- [x] `state.ts`/`reducer.ts` — pane array, identity cursor, single detail token, scrolloff viewport, wrapped-line scroll clamp, suspend flag, action `running` flag
- [x] Config-time validation — reject bare-letter bindings, reject accelerator collisions with `Ctrl+C/U/D/P`
- [x] `keymap.ts` — remove sequences + `pendingSequence`; `Ctrl+<letter>` accelerators; `keymapToHelp`
- [x] `jobs.ts` — reducer-owned token, real AbortSignal, 30 ms debounce; named regression test for the `reloadDetail` desync
- [x] `runtime.ts` — setImmediate frame scheduler, Screen/driver wiring, delete `cloneBuffer`/`changesToAnsi`, Enter action menu, wheel routing, `exit()` awaits effects
- [x] `render/*` — multi-pane layout + 80-col collapse, focus accent border, scroll indicator, spinner header, delete `listLineCache`, markdown cache, generated help/footer
- [x] Frame snapshot tests — list+detail, list+list, loading, empty, filtered, modal, palette, <60-col fallback, 70-col collapse

### Phase 4 — consumers + deletion

- [x] `plan-browser` — panes array, accelerators (`e/s/a` → Ctrl; delete stays menu-only because Ctrl+D is reserved), `destructive` on archive/delete
- [x] `maestro-tui` + `agent-trace-viewer` — same config migration
- [x] `agent-stash` — unified config with two list panes, memoized `loadModel` on the detail path, trace wiring → `POE_CODE_TUI_TRACE`
- [x] Delete `two-pane.ts`, `run-two-pane-explorer.ts`, toolcraft re-export; `grep -r runTwoPaneExplorer` clean
- [x] `toolcraft-design` README — new config, env var, keybinding table
- [x] `docs/plans/qa/explorer-tui-overhaul-qa.md` — terminal-pilot QA checklist

### Phase 5 — verification

- [x] `npm test` — all four consumers green
- [x] `npm run generate:design-docs`
- [x] `npm run screenshot-poe-code -- plan` — borders, focus accent, footer
- [ ] Real-world test steps 2–9 from level 4 (typing never triggers actions, torn ESC never quits, editor round-trip clean, resize intact, stash browse on unified core)
- [ ] Must-work checklist from level 4 fully checked
- [ ] `npm run e2e:verbose` judgement run — attempted; repository preflight requires `POE_API_KEY`, which is unavailable in this environment
