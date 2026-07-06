---
kind: archived-pipeline-plan
version: 1
source: plan-design-system-dashboard.yaml
task_count: 13
---

# Design System Dashboard

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  plan_doc: "{{file 'docs/plans/design-system-dashboard.md'}}"

tasks:
  # ── Phase 1: TUI Engine Foundation ─────────────────────────────────

  - id: types
    title: Define shared types
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/types.ts` with all shared types:

      ```ts
      export type OutputItemKind = 'info' | 'success' | 'error' | 'tool' | 'status'

      export type OutputItem = {
        kind: OutputItemKind
        text: string
        ts: number
      }

      export type DashboardStats = {
        status: 'idle' | 'running' | 'paused' | 'done' | 'error'
        iterations: number
        tokensIn: number
        tokensOut: number
        elapsedMs: number
        currentAction?: string
      }

      export type Command =
        | 'quit'
        | 'edit'
        | 'pause'
        | 'retry'
        | 'scrollUp'
        | 'scrollDown'
        | 'pageUp'
        | 'pageDown'
        | 'scrollToTop'
        | 'scrollToBottom'

      export type DialogState =
        | { kind: 'none' }
        | { kind: 'edit'; initialValue: string }

      export type DashboardState = {
        output: OutputItem[]
        outputScroll: number
        autoFollow: boolean
        stats: DashboardStats
        paused: boolean
        activeDialog: DialogState
      }

      export type CellStyle = {
        fg?: string      // hex or chalk color name
        bg?: string
        bold?: boolean
        dim?: boolean
      }

      export type Cell = {
        ch: string
        style: CellStyle
      }

      export type Rect = {
        x: number
        y: number
        width: number
        height: number
      }
      ```

      No tests needed for pure type definitions.

      Reference: {{plan_doc}}

  - id: buffer
    title: Implement cell buffer with diffed rendering
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/buffer.ts`:

      A 2D grid of `Cell` objects (from `./types.ts`). This is the virtual screen
      that components render into before flushing to the real terminal.

      **ScreenBuffer class:**
      - `constructor(width: number, height: number)` — initialize with empty cells
      - `put(x: number, y: number, text: string, style?: CellStyle): void` — write text starting at (x,y), clipping to bounds
      - `get(x: number, y: number): Cell` — return cell at position
      - `clear(style?: CellStyle): void` — fill buffer with spaces
      - `clearRect(rect: Rect, style?: CellStyle): void` — clear a specific region
      - `resize(width: number, height: number): void` — resize the buffer, preserving what fits
      - `putInRect(rect: Rect, row: number, text: string, style?: CellStyle): void` — write text into a row within a rect, clipping to rect bounds
      - `width` / `height` readonly getters

      **diff function:**
      `diff(prev: ScreenBuffer, next: ScreenBuffer): Array<{ x: number; y: number; cell: Cell }>`
      Returns only cells that changed between frames. Compare by `ch`, `fg`, `bg`, `bold`, `dim`.

      **cellToAnsi helper:**
      `cellToAnsi(cell: Cell): string`
      Convert a Cell's style to ANSI escape sequence + character. Use chalk for color
      application since the design system already depends on it.

      Write tests in `packages/design-system/src/dashboard/dashboard.test.ts`:
      - `put` writes characters at correct positions
      - `put` clips text that exceeds buffer width
      - `put` ignores writes outside buffer bounds
      - `get` returns empty cell for unwritten positions
      - `clear` resets all cells
      - `clearRect` only clears the specified region
      - `resize` preserves existing content that fits
      - `putInRect` clips to rect boundaries
      - `diff` returns empty array for identical buffers
      - `diff` returns changed cells only
      - `diff` handles buffers of different sizes

      Reference: {{plan_doc}}

  - id: layout
    title: Implement layout calculator
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/layout.ts`:

      Layout functions that compute `Rect` regions for the dashboard:

      **`computeDashboardLayout(opts: LayoutOptions): DashboardLayout`**

      ```ts
      type LayoutOptions = {
        totalWidth: number
        totalHeight: number
        rightPaneWidth?: number   // default 25 columns
        footerHeight?: number     // default 1
        borderWidth?: number      // default 1
      }

      type DashboardLayout = {
        outerBorder: Rect       // the full screen border
        leftPane: Rect          // content area for output (inside border)
        rightPane: Rect         // content area for stats (inside border)
        divider: { x: number; top: number; bottom: number }  // vertical divider column
        footer: Rect            // content area for key hints (inside border)
        footerDivider: { y: number; left: number; right: number }  // horizontal divider row
      }
      ```

      The layout should account for:
      - 1-cell border on all sides
      - Vertical divider between left and right panes
      - Horizontal divider above footer
      - Right pane width is fixed (default 25), left pane gets the rest
      - Footer is at the bottom, spanning full width

      Add tests to `dashboard.test.ts`:
      - Standard 80x24 terminal produces correct rects
      - Custom right pane width is respected
      - Minimum width handling (if terminal too narrow, left pane gets at least 20 cols)
      - Height calculations are correct (header row + content + divider + footer + bottom border)

      Reference: {{plan_doc}}

  - id: terminal
    title: Implement terminal driver
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/terminal.ts`:

      Low-level terminal control. Wraps stdin/stdout for raw mode and escape sequences.

      **`createTerminalDriver(opts?: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream })`**

      Returns:
      ```ts
      type TerminalDriver = {
        enterRawMode(): void
        exitRawMode(): void
        enterAltScreen(): void
        exitAltScreen(): void
        hideCursor(): void
        showCursor(): void
        moveTo(x: number, y: number): void
        write(text: string): void
        flush(changes: Array<{ x: number; y: number; cell: Cell }>): void
        getSize(): { cols: number; rows: number }
        onResize(handler: () => void): () => void
        onKeypress(handler: (key: KeypressEvent) => void): () => void
        destroy(): void
      }

      type KeypressEvent = {
        name?: string      // 'up', 'down', 'pageup', 'pagedown', etc.
        ch?: string        // single character for letter keys
        ctrl: boolean
        meta: boolean
        shift: boolean
      }
      ```

      Implementation notes:
      - Use `process.stdin.setRawMode(true)` for raw mode
      - Use `readline.emitKeypressEvents(stdin)` for keypress parsing
      - Alt screen: write `\x1b[?1049h` to enter, `\x1b[?1049l` to exit
      - Hide cursor: `\x1b[?25l`, show: `\x1b[?25h`
      - Move: `\x1b[{row};{col}H` (1-based)
      - `flush` should batch writes using the diff output, moving cursor and writing each changed cell
      - `onResize` listens to stdout `resize` event
      - `destroy` restores raw mode, alt screen, cursor, removes listeners

      Use `cellToAnsi` from `buffer.ts` for flush.

      Tests: test `KeypressEvent` parsing logic if extracted to a pure function.
      The terminal driver itself is inherently side-effectful so test via integration.
      Do not mock stdin/stdout — instead extract the keypress parsing into a testable
      pure function `parseKeypress(data: Buffer): KeypressEvent | undefined` and test that.

      Reference: {{plan_doc}}

  # ── Phase 2: Components ────────────────────────────────────────────

  - id: border
    title: Implement border renderer
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/components/border.ts`:

      Renders the outer border frame and internal dividers into the buffer.

      **`renderBorder(buffer: ScreenBuffer, layout: DashboardLayout, opts: BorderOptions): void`**

      ```ts
      type BorderOptions = {
        leftTitle?: string
        rightTitle?: string
        style: CellStyle        // border color from theme
      }
      ```

      Draw:
      - Outer border using `┌─┐│└─┘`
      - Vertical divider using `│` between left and right panes
      - Horizontal divider using `─` above footer
      - Junction characters: `┬` where vertical meets top, `┴` where vertical meets bottom,
        `├` where horizontal meets left, `┤` where horizontal meets right,
        `┼` where horizontal and vertical cross
      - Titles rendered inline in the top border: `┌─ Left Title ──┬─ Right Title ─┐`

      Add tests to `dashboard.test.ts`:
      - Border characters are placed at correct positions
      - Titles are rendered in the top border
      - Junction characters are correct at intersections
      - Long titles are truncated to fit

      Reference: {{plan_doc}}

  - id: output-pane
    title: Implement scrollable output pane
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/components/output-pane.ts`:

      Renders the left pane — a scrollable rolling log of `OutputItem` entries.

      **`renderOutputPane(buffer: ScreenBuffer, rect: Rect, state: OutputPaneState): void`**

      ```ts
      type OutputPaneState = {
        items: OutputItem[]
        scrollOffset: number
        autoFollow: boolean
      }
      ```

      Behavior:
      - Each `OutputItem` is rendered with a symbol prefix based on `kind`:
        - `info`: `◇` (theme resolvedSymbol color)
        - `success`: `◆` (theme success color)
        - `error`: `■` (theme error color)
        - `tool`: `│` (theme muted) — continuation/detail line
        - `status`: `●` (theme info color)
      - Text is word-wrapped to fit the rect width (minus 3 for symbol + spaces)
      - Continuation lines (from wrapping) are indented with `│` prefix
      - Scroll offset determines which visual line is at the top
      - If `autoFollow` is true, scrollOffset is ignored and we show the last N lines

      **`computeVisualLines(items: OutputItem[], width: number): VisualLine[]`**
      Pure function that converts items to wrapped visual lines. This is the main
      testable unit.

      ```ts
      type VisualLine = {
        text: string
        style: CellStyle
        prefix: string    // the symbol or continuation bar
        prefixStyle: CellStyle
      }
      ```

      **Scroll helpers:**
      - `scrollUp(state: OutputPaneState, lines: number): OutputPaneState`
      - `scrollDown(state: OutputPaneState, lines: number, totalVisualLines: number): OutputPaneState`
      - `scrollToTop(state: OutputPaneState): OutputPaneState`
      - `scrollToBottom(state: OutputPaneState, totalVisualLines: number, paneHeight: number): OutputPaneState`

      `scrollToBottom` should also set `autoFollow: true`.
      Any manual scroll should set `autoFollow: false`.

      Add tests to `dashboard.test.ts`:
      - `computeVisualLines` wraps long text correctly
      - `computeVisualLines` assigns correct prefix/style per item kind
      - Scroll up/down clamps to valid range
      - Scroll to bottom enables auto-follow
      - Manual scroll disables auto-follow
      - `renderOutputPane` renders correct lines in the rect (verify buffer cells)

      Reference: {{plan_doc}}

  - id: stats-pane
    title: Implement stats pane
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/components/stats-pane.ts`:

      Renders the right pane — a fixed key-value display of `DashboardStats`.

      **`renderStatsPane(buffer: ScreenBuffer, rect: Rect, stats: DashboardStats): void`**

      Layout within the rect:
      ```
      Status      Running       ← status color depends on value
      Iteration   14
      Elapsed     00:01:32

      Tokens In   12,430
      Tokens Out   5,982
      Total       18,412

      Current:
        generating patch
      ```

      - Labels are left-aligned, values are right-aligned within the rect
      - `status` value gets colored: running=info, paused=warning, error=error, done=success, idle=muted
      - Numbers are formatted with commas (e.g., `12,430`)
      - `elapsedMs` is formatted as `HH:MM:SS`
      - `currentAction` is rendered below a "Current:" label, dimmed
      - If `currentAction` is undefined, don't render the Current section
      - Use theme colors from `getTheme()`

      **Pure formatting helpers (testable):**
      - `formatElapsed(ms: number): string` → `"00:01:32"`
      - `formatNumber(n: number): string` → `"12,430"`
      - `statsToLines(stats: DashboardStats, width: number): VisualLine[]`

      Add tests to `dashboard.test.ts`:
      - `formatElapsed` formats correctly for various durations
      - `formatNumber` adds commas
      - `statsToLines` produces correct label/value pairs
      - Status colors are correct per status value
      - Current action is included only when present

      Reference: {{plan_doc}}

  - id: footer
    title: Implement footer keyboard hints bar
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/components/footer.ts`:

      Renders the bottom bar with keyboard shortcut hints.

      **`renderFooter(buffer: ScreenBuffer, rect: Rect, hints: FooterHint[]): void`**

      ```ts
      type FooterHint = {
        key: string       // e.g., "q", "e", "↑↓"
        label: string     // e.g., "Quit", "Edit", "Scroll"
      }
      ```

      - Key is rendered in accent color (bold)
      - Label is rendered in default color
      - Hints are separated by 2 spaces
      - If hints overflow the rect width, truncate with "..."
      - Center the hints within the footer rect

      **`defaultHints(): FooterHint[]`**
      Returns the standard set:
      ```ts
      [
        { key: 'q', label: 'Quit' },
        { key: 'e', label: 'Edit' },
        { key: 'p', label: 'Pause' },
        { key: 'r', label: 'Retry' },
        { key: '↑↓', label: 'Scroll' },
      ]
      ```

      Add tests to `dashboard.test.ts`:
      - Hints render with correct spacing
      - Overflow truncation works
      - Keys get accent styling

      Reference: {{plan_doc}}

  # ── Phase 3: Keymap + State Store ──────────────────────────────────

  - id: keymap
    title: Implement keymap
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/keymap.ts`:

      Maps raw keypress events to semantic `Command` values.

      **`createKeymap(overrides?: Partial<Record<Command, string[]>>): (event: KeypressEvent) => Command | undefined`**

      Default mappings:
      - `quit`: `q`, `Ctrl+C`
      - `edit`: `e`
      - `pause`: `p`
      - `retry`: `r`
      - `scrollUp`: `up`, `k`
      - `scrollDown`: `down`, `j`
      - `pageUp`: `pageup`
      - `pageDown`: `pagedown`
      - `scrollToTop`: `home`, `g`
      - `scrollToBottom`: `end`, `G` (shift+g)

      The function returns a resolver: given a KeypressEvent, return the matching Command or undefined.

      Add tests to `dashboard.test.ts`:
      - Default keys resolve to correct commands
      - Ctrl+C resolves to quit
      - Unknown keys return undefined
      - Overrides replace default bindings

      Reference: {{plan_doc}}

  - id: store
    title: Implement state store
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/store.ts`:

      Centralized state management for the dashboard.

      **`createStore(): DashboardStore`**

      ```ts
      type DashboardStore = {
        getState(): DashboardState
        appendOutput(item: OutputItem): void
        updateStats(partial: Partial<DashboardStats>): void
        dispatch(command: Command, paneHeight: number): void
        onChange(handler: () => void): () => void
      }
      ```

      - `appendOutput` adds to `output` array. If `autoFollow`, adjusts scroll to follow.
      - `updateStats` merges partial stats into current stats.
      - `dispatch` handles scroll commands (scrollUp, scrollDown, pageUp, pageDown,
        scrollToTop, scrollToBottom) using the scroll helpers from output-pane.
        For other commands (quit, edit, pause, retry), it does NOT handle them —
        those are passed through to the consumer's `onCommand` handler.
      - `onChange` registers a listener called after any state mutation.

      Initial state:
      ```ts
      {
        output: [],
        outputScroll: 0,
        autoFollow: true,
        stats: {
          status: 'idle',
          iterations: 0,
          tokensIn: 0,
          tokensOut: 0,
          elapsedMs: 0,
        },
        paused: false,
        activeDialog: { kind: 'none' },
      }
      ```

      Add tests to `dashboard.test.ts`:
      - `appendOutput` adds items
      - `appendOutput` with autoFollow adjusts scroll
      - `updateStats` merges partial updates
      - `dispatch` scrollUp/scrollDown changes scroll offset
      - `onChange` fires after mutations
      - Initial state is correct

      Reference: {{plan_doc}}

  # ── Phase 4: Dashboard Orchestrator ────────────────────────────────

  - id: dashboard
    title: Implement main dashboard orchestrator and public API
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/dashboard.ts`:

      The main entry point that wires everything together.

      **`createDashboard(opts?: DashboardOptions): Dashboard`**

      ```ts
      type DashboardOptions = {
        title?: string              // left pane title, default "Output"
        statsTitle?: string         // right pane title, default "Stats"
        keymap?: Partial<Record<Command, string[]>>
        rightPaneWidth?: number     // default 25
        hints?: FooterHint[]        // custom footer hints
        stdin?: NodeJS.ReadStream
        stdout?: NodeJS.WriteStream
      }

      type Dashboard = {
        start(): void
        stop(): void
        appendOutput(item: OutputItem): void
        updateStats(stats: Partial<DashboardStats>): void
        onCommand(handler: (cmd: Command) => void): void
        destroy(): void
      }
      ```

      **`start()`:**
      1. Create terminal driver (enter raw mode, alt screen, hide cursor)
      2. Create store
      3. Compute layout from terminal size
      4. Create initial buffer, render border + components
      5. Flush to terminal
      6. Listen for keypresses → resolve via keymap → dispatch to store or emit to onCommand
      7. Listen for resize → recompute layout, resize buffer, re-render

      **Render loop:**
      - Store onChange → render all components into new buffer → diff with prev → flush changes
      - Keep reference to previous buffer for diffing

      **`stop()`:**
      - Restore terminal (exit raw mode, alt screen, show cursor)
      - Stop listening for events

      **`destroy()`:**
      - Call stop() + clean up all listeners and references

      **Non-terminal fallback:**
      If `resolveOutputFormat()` is not `"terminal"`, do NOT enter alt screen or raw mode.
      Instead, `appendOutput` just writes to stdout as plain text using the design system
      logger. `updateStats` is a no-op. This ensures the dashboard degrades gracefully in
      CI/piped output.

      Add tests to `dashboard.test.ts`:
      - `createDashboard` returns object with expected methods
      - Non-terminal format falls back gracefully
      - `onCommand` handler is called for non-scroll commands

      Reference: {{plan_doc}}

  # ── Phase 5: Export + Integration ──────────────────────────────────

  - id: export
    title: Export dashboard from design-system package
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/index.ts` barrel:

      ```ts
      export { createDashboard } from './dashboard.js'
      export type { Dashboard, DashboardOptions } from './dashboard.js'
      export type {
        OutputItem,
        OutputItemKind,
        DashboardStats,
        Command,
        DashboardState,
      } from './types.js'
      export { defaultHints } from './components/footer.js'
      export type { FooterHint } from './components/footer.js'
      ```

      Add to `packages/design-system/src/index.ts`:

      ```ts
      // Dashboard
      export * as dashboard from './dashboard/index.js'
      export { createDashboard } from './dashboard/index.js'
      export type { Dashboard, DashboardOptions } from './dashboard/index.js'
      ```

      Run `npm run generate:design-docs` to update design language docs if the script
      picks up new exports.

      Verify the build works: `npm run build` in the design-system package.

      Reference: {{plan_doc}}

  - id: demo
    title: Create demo script for visual testing
    status:
      implement: done
      test: done
      commit: done
    prompt: |
      Create `packages/design-system/src/dashboard/demo.ts`:

      A runnable demo that simulates an agent session using the dashboard.

      ```ts
      const dashboard = createDashboard({ title: 'Agent Output', statsTitle: 'Stats' })
      dashboard.onCommand((cmd) => {
        if (cmd === 'quit') {
          dashboard.destroy()
          process.exit(0)
        }
      })
      dashboard.start()
      ```

      Then simulate activity:
      - Every 500ms, append a random output item (cycling through kinds)
      - Every 1s, update stats with incrementing values
      - After 30s, set status to 'done'

      Add an npm script to root package.json:
      ```json
      "demo:dashboard": "tsx packages/design-system/src/dashboard/demo.ts"
      ```

      Use `npm run demo:dashboard` for visual validation.
      Take a screenshot with `npm run screenshot-poe-code` if applicable.

      Reference: {{plan_doc}}
````
