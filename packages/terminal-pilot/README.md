# terminal-pilot

`terminal-pilot` is a Playwright-like SDK for automating interactive CLI apps through a real pseudoterminal (PTY).

Use it when plain stdio is not enough: menus, prompts, arrow-key navigation, confirmations, and terminal redraws such as `poe-code configure`.

For design history, see [terminal-pilot](../../docs/plans/archive/terminal-pilot.md).

For the MCP server, see [terminal-pilot-mcp](../terminal-pilot-mcp).

## CLI

The `terminal-pilot` package ships a CLI binary. After installing globally or via npx, all SDK commands and the skill installer are available from the command line.

### Install globally

```sh
npm install -g terminal-pilot
```

Or run directly with npx:

```sh
npx terminal-pilot <command> [options]
```

### Skill installation

The CLI can install a Claude Code skill that teaches the agent how to use terminal-pilot's MCP tools. Supported agents: `claude-code`, `codex`, `opencode`.

**Install the skill (local project, default):**

```sh
terminal-pilot install claude-code
```

**Install the skill globally (user home):**

```sh
terminal-pilot install claude-code --global
```

**Uninstall the skill:**

```sh
terminal-pilot uninstall claude-code
```

By default, `install` targets the current project (`--local`). Use `--global` to install in the user's home directory. You cannot pass both `--local` and `--global`.

## What it includes

- **SDK:** `TerminalPilot` → `TerminalSession` → `TerminalScreen`
- **Real PTY execution:** works with interactive CLIs that expect a terminal
- **Headless by default:** optional `observe: true` mirrors PTY output for debugging

## Entry points

```ts
import { TerminalPilot } from "terminal-pilot";
```

## SDK API

### `TerminalPilot`

Creates and tracks active terminal sessions.

```ts
import { TerminalPilot } from "terminal-pilot";

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
  getSession(id: string): TerminalSession; // throws if not in map; works for exited sessions until deleteSession
  deleteSession(id: string): void; // explicit removal from session map
  sessions(): TerminalSession[]; // running sessions only (exitCode === null)
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

  type(text: string): Promise<void>; // character-by-character with delay
  fill(text: string): Promise<void>; // bulk write (\n → \r)
  press(key: TerminalKey): Promise<void>;
  send(raw: string): Promise<void>; // raw bytes / escape sequences
  signal(signal: string): Promise<void>;
  waitFor(
    pattern: string | RegExp,
    options?: { timeout?: number; scope?: "history" | "screen" }
  ): Promise<string>;
  waitForExit(options?: { timeout?: number }): Promise<number>; // throws on timeout
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

## Environment Variables

There are **no terminal-pilot-specific environment variables**.

Runtime environment is controlled per session via `newSession({ env })`. There are no package-level config files or config options beyond the per-session options.

## Configuration Options

Configure sessions with `newSession({ command, args, cwd, env, cols, rows, observe })`. CLI skill installation is controlled by `install`/`uninstall` flags: target agent plus optional `--local` or `--global`.

## Testing

Interactive fixtures live under `packages/terminal-pilot/src/testing/`:

- `test-cli.ts` - prompt + text entry fixture
- `menu-cli.ts` - arrow-key menu fixture
- `fixtures.test.ts` - examples of driving both fixtures

Run the fixture tests only:

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

`waitFor(...)` searches captured output history by default. Use
`waitFor(pattern, { scope: "screen" })` when command echoes or previous output could match before
the expected interactive screen is visible.

When launching an interactive program through `npm run`, npm can buffer printable raw keys such as
`q` until `Enter` is pressed. Prefer launching the underlying executable directly for raw-key tests.
If the npm wrapper is part of the behavior under test, use `Control+c` for teardown and treat
printable-key delivery as npm-wrapper behavior rather than application behavior.

Example fixture-based test:

```ts
import path from "node:path";
import { TerminalPilot } from "terminal-pilot";

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
import { TerminalPilot } from "terminal-pilot";

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
