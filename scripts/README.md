# Scripts

## Screenshot Tool

Captures terminal command output as PNG images using `terminal-png`.

### Usage

```bash
# Generic command
npm run screenshot -- <command> [args...]

# poe-code CLI (enables TTY emulation)
npm run screenshot-poe-code -- <command> [args...]
```

### Options

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Custom output file path (default: `screenshots/<command>.png`) |
| `--no-header` | Skip the `% command args` header line |
| `--poe-code` | Run via `npm run dev` with TTY emulation |

### How It Works

1. Spawns the command as a child process with piped stdout/stderr
2. Captures all output chunks, sanitizing control characters
3. Kills the process on timeout (SIGTERM)
4. Renders the captured output to PNG with terminal window chrome

### Interactive / Full-Screen Commands

The screenshot tool captures **piped stdout/stderr** output. Commands that use alternate screen mode (e.g. full-screen TUI dashboards) won't produce visible output because alt-screen writes aren't captured by pipes.

To screenshot interactive components, render a **static snapshot** to stdout instead of launching the interactive mode. The dashboard component does this via `renderDashboardSnapshot()` which builds a single ScreenBuffer frame and prints it as ANSI text.

See `packages/design-system/src/dashboard/snapshot.ts` for the pattern.

### Timeout

The tool kills the spawned process after a timeout and saves whatever output was captured up to that point.

| Variable | Default | Description |
|----------|---------|-------------|
| `POE_SCREENSHOT_TIMEOUT_MS` | `60000` (60s) | Maximum time to wait for the command to exit |

```bash
# Short timeout for fast commands
POE_SCREENSHOT_TIMEOUT_MS=5000 npm run screenshot -- my-command

# Longer timeout for slow builds
POE_SCREENSHOT_TIMEOUT_MS=120000 npm run screenshot-poe-code -- models list
```

When a timeout occurs the screenshot is still saved with partial output, and a warning is printed to stderr.

### Environment

The tool forces color output regardless of the user's terminal settings:

- `FORCE_COLOR=1`, `CLICOLOR_FORCE=1` - enable ANSI colors
- `NO_COLOR` - removed if present
- `TERM=xterm-256color` - set if missing
- `POE_NO_SPINNER=1` - disables animated spinners

When `--poe-code` is used, `force-tty.cjs` is injected via `NODE_OPTIONS --require` to emulate a TTY environment (sets `isTTY`, `columns=80`, `rows=24`).
