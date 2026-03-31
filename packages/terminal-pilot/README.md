# @poe-code/terminal-pilot

`terminal-pilot` is a Playwright-like SDK and MCP server for automating interactive CLI apps through a real pseudoterminal (PTY).

Use it when plain stdio is not enough: menus, prompts, arrow-key navigation, confirmations, and terminal redraws such as `poe-code configure`.

For design rationale and scope, see `docs/plans/terminal-pilot.md`.

## What it includes

- **SDK:** `TerminalPilot` → `TerminalSession` → `TerminalScreen`
- **MCP server:** 10 tools for AI-driven CLI automation
- **Real PTY execution:** works with interactive CLIs that expect a terminal
- **Headless by default:** optional `observe: true` mirrors PTY output for debugging

## Entry points

```ts
import { TerminalPilot } from "@poe-code/terminal-pilot";
```

```ts
import { createTerminalPilotMcpServer, main } from "@poe-code/terminal-pilot/mcp";
```

CLI bin:

```sh
terminal-pilot-mcp
```

Development entry point in this repo:

```sh
npx tsx packages/terminal-pilot/src/mcp-server.ts
```

## SDK API

### `TerminalPilot`

Creates and tracks active terminal sessions.

```ts
import { TerminalPilot } from "@poe-code/terminal-pilot";

const pilot = await TerminalPilot.launch();

const session = await pilot.newSession({
  command: "poe-code",
  args: ["configure"],
  cwd: process.cwd(),
  env: process.env,
  cols: 120,
  rows: 40,
  observe: false
});

console.log(session.id, session.pid);
console.log(pilot.sessions().map(({ id, pid }) => ({ id, pid })));

await pilot.close();
```

```ts
type NewSessionOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number; // default: 120
  rows?: number; // default: 40
  observe?: boolean; // default: false
};

class TerminalPilot {
  static launch(): Promise<TerminalPilot>;
  newSession(options: NewSessionOptions): Promise<TerminalSession>;
  getSession(id: string): TerminalSession; // throws if missing
  sessions(): TerminalSession[]; // active sessions only
  close(): Promise<void>;
}
```

### `TerminalSession`

Represents one PTY-backed CLI process.

```ts
await session.waitFor(/Pick an agent to configure:/);
await session.press("ArrowDown");
await session.press("Enter");

await session.waitFor(/Waiting for authorization|default model|configured/i);

const screen = await session.screen();
const history = await session.history({ last: 20 });

console.log(screen.text);
console.log(history.join("\n"));

await session.resize(100, 30);
await session.signal("SIGINT");
await session.close();
```

```ts
type WaitForOptions = {
  timeout?: number; // default: 10000
};

type HistoryOptions = {
  last?: number;
};

type TerminalKey =
  | "Enter"
  | "Tab"
  | "Escape"
  | "Backspace"
  | "Delete"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Space"
  | `Control+${string}`
  | `Alt+${string}`;

class TerminalSession {
  readonly id: string;
  readonly command: string;
  readonly pid: number;
  exitCode: number | null;

  type(text: string): Promise<void>; // character-by-character
  fill(text: string): Promise<void>; // bulk write
  press(key: TerminalKey): Promise<void>;
  send(raw: string): Promise<void>; // raw bytes / escape sequences
  signal(signal: string): Promise<void>;
  waitFor(pattern: string | RegExp, options?: WaitForOptions): Promise<string>;
  waitForQuiet(ms: number): Promise<void>;
  screen(): Promise<TerminalScreen>;
  history(options?: HistoryOptions): Promise<string[]>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<number>;
  on(event: "exit", cb: (code: number) => void): void;
}
```

Common key names:

- Navigation: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`
- Editing: `Enter`, `Tab`, `Backspace`, `Delete`, `Space`
- Control/meta: `Control+c`, `Control+d`, `Alt+x`

### `TerminalScreen`

Normalized visible terminal state.

```ts
const screen = await session.screen();

screen.lines; // ANSI-stripped visible lines
screen.rawLines; // raw visible lines
screen.cursor; // { row, col }
screen.size; // { rows, cols }
screen.text; // lines joined with \n
screen.contains("Configured");
screen.line(0);
screen.line(-1);
```

```ts
class TerminalScreen {
  readonly lines: readonly string[];
  readonly rawLines: readonly string[];
  readonly cursor: { row: number; col: number };
  readonly size: { rows: number; cols: number };

  get text(): string;
  contains(substring: string): boolean;
  line(index: number): string; // negative indexes supported
}
```

## MCP server

The MCP server holds one in-memory `TerminalPilot` instance and exposes terminal automation over stdio.

### Run it

Development:

```sh
npx tsx packages/terminal-pilot/src/mcp-server.ts
```

Built / installed package:

```sh
terminal-pilot-mcp
```

Programmatic:

```ts
import { main } from "@poe-code/terminal-pilot/mcp";

await main();
```

### Connect to an MCP client

Install the package globally from a local build:

```sh
cd packages/terminal-pilot
npm pack --pack-destination /tmp && npm install -g /tmp/poe-code-terminal-pilot-*.tgz && rm /tmp/poe-code-terminal-pilot-*.tgz
```

This makes the `terminal-pilot-mcp` bin available globally.

**Claude Code** (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "terminal-pilot": {
      "command": "terminal-pilot-mcp"
    }
  }
}
```

### Tools

`void` means the tool returns no payload.

| Tool | Input | Output |
| --- | --- | --- |
| `terminal_create_session` | `{ command: string, args?: string[], cwd?: string, cols?: number, rows?: number, observe?: boolean }` | `{ sessionId: string, pid: number }` |
| `terminal_type` | `{ sessionId: string, text: string }` | `void` |
| `terminal_press_key` | `{ sessionId: string, key: TerminalKey }` | `void` |
| `terminal_send_signal` | `{ sessionId: string, signal: string }` | `void` |
| `terminal_wait_for` | `{ sessionId: string, pattern: string, timeout?: number }` | `{ matched: true, output: string }` |
| `terminal_read_screen` | `{ sessionId: string }` | `{ lines: string[], cursor: { row: number, col: number }, size: { rows: number, cols: number } }` |
| `terminal_read_history` | `{ sessionId: string, last?: number }` | `{ lines: string[] }` |
| `terminal_resize` | `{ sessionId: string, cols: number, rows: number }` | `void` |
| `terminal_close_session` | `{ sessionId: string }` | `{ exitCode: number }` |
| `terminal_list_sessions` | `{}` | `{ sessions: Array<{ id: string, command: string, pid: number }> }` |

Practical notes:

- `terminal_wait_for.pattern` is compiled as a JavaScript `RegExp` on the server.
- `terminal_type` maps to `session.fill(...)` for bulk text entry.
- `terminal_read_screen` returns the **current visible screen**, not scrollback.
- `terminal_read_history` returns ANSI-stripped output since session start.
- `terminal_list_sessions` returns **active** sessions only.
- `observe: true` mirrors PTY output to `stderr`, which is useful when debugging MCP-driven runs.

Minimal MCP flow:

```json
{"tool":"terminal_create_session","arguments":{"command":"poe-code","args":["configure"]}}
{"tool":"terminal_wait_for","arguments":{"sessionId":"<id>","pattern":"Pick an agent to configure:"}}
{"tool":"terminal_press_key","arguments":{"sessionId":"<id>","key":"Enter"}}
{"tool":"terminal_read_screen","arguments":{"sessionId":"<id>"}}
{"tool":"terminal_close_session","arguments":{"sessionId":"<id>"}}
```

## Environment variables

There are **no terminal-pilot-specific environment variables**.

Runtime environment is controlled per session:

- SDK: `newSession({ env })`
- MCP server: spawned commands inherit the MCP server process environment unless you override it in your command wrapper

There are also **no package-level config files or config options** beyond the per-session options above.

## Testing

Interactive fixtures live under `packages/terminal-pilot/src/testing/`:

- `test-cli.ts` - prompt + text entry fixture
- `menu-cli.ts` - arrow-key menu fixture
- `fixtures.test.ts` - examples of driving both fixtures

Run just the fixture tests:

```sh
npx vitest run packages/terminal-pilot/src/testing/fixtures.test.ts
```

Run the whole package test suite:

```sh
npx vitest run packages/terminal-pilot/src
```

Typical fixture workflow:

1. Spawn the fixture in a `TerminalSession`
2. `waitFor(...)` the prompt
3. `type(...)`, `fill(...)`, `press(...)`, or `signal(...)`
4. Assert with `screen()` or `history()`
5. `close()` the session

Example fixture-based test:

```ts
import path from "node:path";
import { TerminalPilot } from "@poe-code/terminal-pilot";

const pilot = await TerminalPilot.launch();
const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const fixturePath = path.join(process.cwd(), "packages/terminal-pilot/src/testing/menu-cli.ts");

try {
  const session = await pilot.newSession({
    command: tsxPath,
    args: [fixturePath]
  });

  await session.waitFor("Select an option:");
  await session.press("ArrowDown");
  await session.press("ArrowDown");
  await session.press("Enter");

  await session.waitFor("You selected: Option 3");
} finally {
  await pilot.close();
}
```

## Example: test `poe-code configure`

Use a temporary home directory so you do not touch your real config while testing the interactive flow.

```ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TerminalPilot } from "@poe-code/terminal-pilot";

const tmpHome = mkdtempSync(path.join(os.tmpdir(), "poe-configure-test-"));
const pilot = await TerminalPilot.launch();

try {
  const session = await pilot.newSession({
    command: "npm",
    args: ["run", "dev", "--silent", "--", "configure"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tmpHome,
      XDG_CONFIG_HOME: path.join(tmpHome, ".config"),
      XDG_DATA_HOME: path.join(tmpHome, ".local", "share")
    },
    cols: 120,
    rows: 40
  });

  await session.waitFor(/Pick an agent to configure:/);
  await session.press("ArrowDown"); // choose Codex, Kimi, etc.
  await session.press("Enter");

  await session.waitFor(/Waiting for authorization|default model|configured/i, {
    timeout: 15000
  });

  const screen = await session.screen();
  const history = await session.history({ last: 40 });

  console.log(screen.text);
  console.log(history.join("\n"));

  await session.signal("SIGINT");
  await session.close();
} finally {
  await pilot.close();
  rmSync(tmpHome, { recursive: true, force: true });
}
```

That gives you a real end-to-end test of the interactive `configure` handoff. If the selected provider requires OAuth or API-key input, keep the temp environment and continue the flow with additional `type(...)`, `press(...)`, and `waitFor(...)` calls.
