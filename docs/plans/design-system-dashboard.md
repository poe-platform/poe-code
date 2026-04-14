# Design System: Dashboard Component (Split-Pane TUI)

## Goal

Add a full-screen, keyboard-driven dashboard component to `@poe-code/design-system` — a split-pane TUI with a rolling output log on the left, a stats panel on the right, and a keyboard control bar at the bottom.

This is rolled from scratch (no blessed/ink) — a minimal retained-mode TUI engine built on ANSI escape codes, fitting naturally into the existing design system tokens, themes, and output format conventions.

## Architecture

```
packages/design-system/src/dashboard/
  ├── terminal.ts         # raw mode, alt screen, cursor, resize, keypress parsing
  ├── buffer.ts           # 2D cell buffer (char + style per cell)
  ├── renderer.ts         # diff old/new buffer frames → write only changed cells
  ├── layout.ts           # Rect type, horizontal/vertical split calculator
  ├── components/
  │   ├── output-pane.ts  # scrollable rolling log (left pane)
  │   ├── stats-pane.ts   # key-value stats display (right pane)
  │   ├── footer.ts       # keyboard hint bar
  │   └── border.ts       # box-drawing border renderer using existing symbols
  ├── keymap.ts           # key → semantic command mapping
  ├── store.ts            # single app state + typed actions
  ├── dashboard.ts        # public API: createDashboard(opts) → Dashboard
  ├── types.ts            # shared types (OutputItem, DashboardStats, Command, etc.)
  └── dashboard.test.ts   # tests (memfs where needed, no real terminal)
```

## Design Decisions

### Visual Layout

```
┌─ Agent Output ────────────────────────┬─ Stats ──────────────┐
│                                       │                      │
│  ◇ Reading files...                   │  Status    Running   │
│  │ Found 12 matches                   │  Iteration 14       │
│  ◆ Completed file search              │  Elapsed   00:01:32  │
│  │                                    │                      │
│  ◇ Generating patch...                │  Tokens In   12,430  │
│  │ Modifying src/index.ts             │  Tokens Out   5,982  │
│  │ Modifying src/utils.ts             │  Total       18,412  │
│  │                                    │                      │
│                                       │  Current:            │
│                                       │  generating patch    │
│                                       │                      │
├───────────────────────────────────────┴──────────────────────┤
│ q Quit  e Edit  p Pause  r Retry  ↑↓ Scroll                 │
└──────────────────────────────────────────────────────────────┘
```

- Left pane: ~75% width, scrollable output log
- Right pane: ~25% width, fixed stats
- Footer: 1 line, keyboard hints
- Borders: use existing box-drawing chars (`┌`, `─`, `┐`, `│`, `└`, `┘`, `┤`, `├`, `┬`, `┴`)
- Colors: use existing `dark`/`light` theme palettes from `tokens/colors.ts`

### Rendering Strategy

Retained-mode with diffed repaint:
1. State changes → recompute layout → render into virtual cell buffer
2. Diff against previous frame → write only changed cells to stdout
3. Minimizes flicker, same approach as terminal-pilot's TerminalBuffer

### State Model

```ts
type DashboardState = {
  output: OutputItem[]
  outputScroll: number
  autoFollow: boolean
  stats: DashboardStats
  paused: boolean
  activeDialog: DialogState
}

type OutputItem = {
  kind: 'info' | 'success' | 'error' | 'tool' | 'status'
  text: string
  ts: number
}

type DashboardStats = {
  status: 'idle' | 'running' | 'paused' | 'done' | 'error'
  iterations: number
  tokensIn: number
  tokensOut: number
  elapsedMs: number
  currentAction?: string
}
```

### Public API

```ts
interface DashboardOptions {
  title?: string
  statsTitle?: string
  keymap?: Partial<Record<Command, string>>
  rightPaneWidth?: number  // default 25 (columns)
}

interface Dashboard {
  start(): void
  stop(): void
  appendOutput(item: OutputItem): void
  updateStats(stats: Partial<DashboardStats>): void
  onCommand(handler: (cmd: Command) => void): void
  destroy(): void
}

function createDashboard(opts?: DashboardOptions): Dashboard
```

### Key Bindings

Default keymap (overridable):
- `q` → quit
- `e` → edit (emits command, consumer decides behavior — inline modal vs $EDITOR)
- `p` → pause/resume
- `r` → retry
- `↑`/`k` → scroll up
- `↓`/`j` → scroll down
- `Page Up` → page up
- `Page Down` → page down
- `Home`/`g` → scroll to top
- `End`/`G` → scroll to bottom (re-enables auto-follow)

### Integration with Existing Design System

- Import theme via `getTheme()` from `internal/theme-detect.ts`
- Use `brand`, `dark.accent`, `dark.muted`, `dark.success`, `dark.error` for styling cells
- Use existing box-drawing characters from `symbols.ts`
- Respect `OutputFormat` — if not terminal, fall back gracefully (no alt screen, just log)
- Export from main `index.ts` as `dashboard` namespace

### Testing Strategy

- **Cell buffer**: unit test put/get/clear/diff operations
- **Layout**: unit test split calculations for various terminal sizes
- **Output pane**: test line wrapping, scroll position, auto-follow behavior
- **Stats pane**: test rendering key-value pairs into a rect
- **Footer**: test keybar rendering
- **Keymap**: test key-to-command resolution
- **Store**: test state transitions (append output, update stats, scroll)
- No real terminal — all rendering tests operate on the virtual buffer
- Use memfs where filesystem access is needed

### What This Does NOT Include

- Built-in text editor (use `$EDITOR` externally)
- Mouse support
- Plugin system
- Multiple tabs
- File system operations

These can be added later as separate components.
