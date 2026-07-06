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

| Option                | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `-o, --output <path>` | Custom output file path (default: `screenshots/<command>.png`) |
| `--no-header`         | Skip the `% command args` header line                          |
| `--poe-code`          | Run via `npm run dev` with TTY emulation                       |

### How It Works

1. Spawns the command as a child process with piped stdout/stderr
2. Captures all output chunks, sanitizing control characters
3. Kills the process on timeout (SIGTERM)
4. Renders the captured output to PNG with terminal window chrome

### Interactive / Full-Screen Commands

By default, the screenshot tool captures **piped stdout/stderr** output. For alternate-screen TUIs, set `POE_SCREENSHOT_PTY=1` to run the command in a PTY and freeze the current visible screen.

```bash
POE_SCREENSHOT_PTY=1 POE_SCREENSHOT_TIMEOUT_MS=3000 npm run screenshot-poe-code -- maestro tui --workflow ./WORKFLOW.md
```

To drive a TUI before capture, pass comma-separated key tokens through `POE_SCREENSHOT_KEYS`:

```bash
POE_SCREENSHOT_PTY=1 POE_SCREENSHOT_KEYS=down*2,shift-up npm run screenshot-poe-code -- maestro tui --workflow ./WORKFLOW.md
```

Supported key tokens include `up`, `down`, `left`, `right`, `shift-up`, `shift-down`, `tab`, `enter`, `escape`, `space`, `ctrl-p`, `ctrl-k`, `ctrl-f`, and `ctrl-b`. Single printable characters such as `f` are accepted directly. Use `POE_SCREENSHOT_KEY_DELAY_MS` and `POE_SCREENSHOT_KEY_INTERVAL_MS` when the command needs more time before accepting input.

### Timeout

The tool kills the spawned process after a timeout and saves whatever output was captured up to that point.

| Variable                         | Default                                   | Description                                                                     |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `POE_SCREENSHOT_TIMEOUT_MS`      | `60000` (60s)                             | Maximum time to wait for the command to exit                                    |
| `POE_SCREENSHOT_PTY`             | unset                                     | Set to `1` to capture the visible PTY screen instead of piped transcript output |
| `POE_SCREENSHOT_COLUMNS`         | `120` in PTY mode, `80` for TTY emulation | Terminal width for PTY or forced-TTY captures                                   |
| `POE_SCREENSHOT_ROWS`            | `40` in PTY mode, `24` for TTY emulation  | Terminal height for PTY or forced-TTY captures                                  |
| `POE_SCREENSHOT_KEYS`            | unset                                     | Comma-separated key tokens to send before capture                               |
| `POE_SCREENSHOT_KEY_DELAY_MS`    | `250`                                     | Delay before sending the first key                                              |
| `POE_SCREENSHOT_KEY_INTERVAL_MS` | `75`                                      | Delay between sent keys                                                         |

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
