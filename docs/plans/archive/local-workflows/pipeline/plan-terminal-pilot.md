---
kind: pipeline
version: 1
tasks:
  - id: package-scaffold
    title: Scaffold terminal-pilot package
    prompt: |
      Create `packages/terminal-pilot/` with package.json, tsconfig.json, README.md.

      package.json:
        - name: `@poe-code/terminal-pilot`
        - exports: `"."` → `dist/index.js` and `"./mcp"` → `dist/mcp-server.js`
        - bin: `terminal-pilot-mcp` → `dist/mcp-server.js`
        - dependencies: `node-pty` (1.x), `headless-terminal`
        - devDependencies: reference workspace packages as needed

      Register the package in the root turbo.json and tsconfig references.
      Ensure `bun install` resolves cleanly.

      Do NOT implement any source files yet — just the package skeleton.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: keys
    title: Key name to escape sequence mapping
    prompt: |
      Create `packages/terminal-pilot/src/keys.ts` with a `TerminalKey` type
      and a `keyToSequence(key: TerminalKey): string` function.

      Supported keys and their escape sequences:
        Enter → \r, Tab → \t, Escape → \x1b, Backspace → \x7f,
        Delete → \x1b[3~, ArrowUp → \x1b[A, ArrowDown → \x1b[B,
        ArrowRight → \x1b[C, ArrowLeft → \x1b[D,
        Home → \x1b[H, End → \x1b[F, PageUp → \x1b[5~, PageDown → \x1b[6~,
        Space → " ",
        Control+c → \x03, Control+d → \x04, Control+z → \x1a,
        Control+<letter> → char code (letter code - 64).
        Alt+<key> → \x1b + key.

      TerminalKey type:
      ```ts
      type TerminalKey =
        | "Enter" | "Tab" | "Escape" | "Backspace" | "Delete"
        | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
        | "Home" | "End" | "PageUp" | "PageDown"
        | "Space"
        | `Control+${string}`
        | `Alt+${string}`
      ```

      Throw on unknown key names. Pure function, no side effects.
      Write comprehensive unit tests in `keys.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: ansi
    title: ANSI stripping utility
    prompt: |
      Create `packages/terminal-pilot/src/ansi.ts` with a `stripAnsi(input: string): string`
      function that removes all ANSI escape sequences from a string.

      Must handle: SGR (colors/styles), cursor movement, erase sequences,
      OSC sequences, CSI sequences. Use a robust regex or state machine.

      Pure function, no dependencies. Write unit tests in `ansi.test.ts`
      covering colors, cursor codes, OSC titles, nested sequences, and
      passthrough of plain text.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-screen
    title: TerminalScreen snapshot model
    prompt: |
      Create `packages/terminal-pilot/src/terminal-screen.ts`.

      TerminalScreen is a read-only snapshot of the visible terminal state.
      It is constructed from a headless-terminal instance's state.

      Interface:
      ```ts
      class TerminalScreen {
        readonly lines: string[]       // visible lines, ANSI-stripped
        readonly rawLines: string[]    // visible lines with ANSI
        readonly cursor: { row: number; col: number }
        readonly size: { rows: number; cols: number }
        readonly text: string          // lines joined with \n

        contains(substring: string): boolean
        line(index: number): string    // supports negative indexing
      }
      ```

      Constructor takes `{ lines: string[], rawLines: string[], cursor, size }`.
      `lines` should be ANSI-stripped (use the `stripAnsi` from `./ansi.ts`).
      `text` is a getter that joins `lines` with newline.
      `line(n)` supports negative indexing (line(-1) = last line).
      `contains(s)` checks `text.includes(s)`.

      Write unit tests in `terminal-screen.test.ts` with mocked input data
      (no real PTY needed).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: test-cli-fixture
    title: Create test CLI fixture for integration tests
    prompt: |
      Create `packages/terminal-pilot/src/testing/test-cli.ts` — a minimal
      interactive CLI program used as a test fixture.

      The program should:
      1. Print "What is your name? " and wait for input
      2. Read a line from stdin
      3. Print "Hello, <name>!" and exit with code 0

      Use Node's `readline` module. This file is executed directly as a
      script (not imported), so add a shebang and make it self-contained.

      Also create a second fixture `packages/terminal-pilot/src/testing/menu-cli.ts`
      that shows a simple arrow-key menu:
      1. Print "Select an option:"
      2. Show 3 options with `>` indicating current selection
      3. Respond to ArrowUp/ArrowDown to move selection
      4. On Enter, print "You selected: <option>" and exit

      These are test-only files, not exported from the package.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-session
    title: TerminalSession with PTY process
    prompt: |
      Create `packages/terminal-pilot/src/terminal-session.ts`.

      TerminalSession wraps a single PTY process (via `node-pty`) and a
      `headless-terminal` instance for screen state.

      Constructor receives `{ id, command, args, cwd, env, cols, rows, observe }`.
      On creation, spawn the PTY process via `node-pty`.

      Pipe PTY output (`pty.onData`) into:
      1. An append-only raw buffer string (for history)
      2. The headless-terminal instance (for screen state)
      3. If `observe: true`, mirror to `process.stderr`

      Public API:
      ```ts
      class TerminalSession {
        readonly id: string
        readonly pid: number
        exitCode: number | null

        async type(text: string): Promise<void>      // write chars one by one with small delay
        async fill(text: string): Promise<void>       // write entire string at once
        async press(key: TerminalKey): Promise<void>  // map key name to sequence, write
        async send(raw: string): Promise<void>        // write raw string to PTY
        async signal(sig: string): Promise<void>      // pty.kill(sig)

        async waitFor(pattern: string | RegExp, opts?: { timeout?: number }): Promise<string>
        async waitForQuiet(ms: number): Promise<void>

        async screen(): Promise<TerminalScreen>
        async history(opts?: { last?: number }): Promise<string[]>
        async resize(cols: number, rows: number): Promise<void>

        async close(): Promise<number>                // SIGTERM, wait for exit, return code
        on(event: "exit", cb: (code: number) => void): void
      }
      ```

      `waitFor` polls the raw buffer every 100ms for the pattern. Throws on timeout
      (default 10s). Returns the matched text.

      `waitForQuiet` resolves when no new data arrives for the given duration.

      `history` strips ANSI from raw buffer, splits by newline, optionally
      returns last N lines.

      Write integration tests in `terminal-session.test.ts` using the
      test-cli.ts fixture from the testing/ directory. Test: spawn, type,
      press, waitFor, screen, history, close, exitCode, timeout error.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot
    title: TerminalPilot multi-session manager
    prompt: |
      Create `packages/terminal-pilot/src/terminal-pilot.ts`.

      TerminalPilot manages multiple TerminalSession instances.

      ```ts
      class TerminalPilot {
        static async launch(): Promise<TerminalPilot>

        async newSession(opts: NewSessionOptions): Promise<TerminalSession>
        getSession(id: string): TerminalSession   // throws if not found
        sessions(): TerminalSession[]
        async close(): Promise<void>               // close all sessions
      }

      interface NewSessionOptions {
        command: string
        args?: string[]
        cwd?: string
        env?: Record<string, string>
        cols?: number   // default: 120
        rows?: number   // default: 40
        observe?: boolean  // default: false
      }
      ```

      Sessions are stored in a `Map<string, TerminalSession>`. Session IDs are
      generated with `crypto.randomUUID()`. `close()` calls `session.close()`
      on all active sessions and clears the map.

      Write integration tests in `terminal-pilot.test.ts`: create multiple
      sessions, list them, get by ID, close all, verify cleanup.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: sdk-exports
    title: Public SDK barrel export
    prompt: |
      Create `packages/terminal-pilot/src/index.ts` as the public entry point.

      Export:
      - `TerminalPilot` from `./terminal-pilot.js`
      - `TerminalSession` from `./terminal-session.js`
      - `TerminalScreen` from `./terminal-screen.js`
      - `TerminalKey` type from `./keys.js`
      - `NewSessionOptions`, `WaitForOptions`, `HistoryOptions` types

      Verify the exports compile and are accessible from a consumer perspective.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: mcp-tools
    title: MCP tool definitions over the SDK
    prompt: |
      Create `packages/terminal-pilot/src/mcp-tools.ts`.

      Define MCP tool handlers that wrap TerminalPilot. Each tool takes a
      TerminalPilot instance and returns a tool registration object compatible
      with `@poe-code/tiny-stdio-mcp-server`.

      Tools to implement:

      1. `terminal_create_session` — input: { command, args?, cwd?, cols?, rows?, observe? }
         → calls agent.newSession(), returns { sessionId, pid }

      2. `terminal_type` — input: { sessionId, text }
         → calls session.fill(text)

      3. `terminal_press_key` — input: { sessionId, key }
         → calls session.press(key)

      4. `terminal_send_signal` — input: { sessionId, signal }
         → calls session.signal(signal)

      5. `terminal_wait_for` — input: { sessionId, pattern, timeout? }
         → calls session.waitFor(new RegExp(pattern)), returns { matched: true, output }

      6. `terminal_read_screen` — input: { sessionId }
         → calls session.screen(), returns { lines, cursor, size }

      7. `terminal_read_history` — input: { sessionId, last? }
         → calls session.history({ last }), returns { lines }

      8. `terminal_resize` — input: { sessionId, cols, rows }
         → calls session.resize(cols, rows)

      9. `terminal_close_session` — input: { sessionId }
         → calls session.close(), returns { exitCode }

      10. `terminal_list_sessions` — input: {}
          → calls agent.sessions(), returns { sessions: [{ id, command, pid }] }

      Define JSON schemas for each tool's input. Write tests in `mcp-tools.test.ts`
      that mock the TerminalPilot and verify tool handlers call the right methods
      with the right arguments.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: mcp-server
    title: MCP stdio server entry point
    prompt: |
      Create `packages/terminal-pilot/src/mcp-server.ts`.

      This is the MCP server entry point (also the bin script).

      1. Create a TerminalPilot instance via `TerminalPilot.launch()`
      2. Create an MCP server via `createServer` from `@poe-code/tiny-stdio-mcp-server`
         with name "terminal-pilot" and version from package.json
      3. Register all tools from `./mcp-tools.ts`
      4. Call `server.listen()` to start the stdio transport
      5. On process exit, call `agent.close()` for cleanup

      Add `#!/usr/bin/env node` shebang at the top.

      Write tests in `mcp-server.test.ts` verifying:
      - Server creates successfully
      - All 10 tools are registered
      - Server lifecycle (start/stop)
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: readme
    title: Write package README
    prompt: |
      Write `packages/terminal-pilot/README.md` documenting:

      1. What terminal-pilot is (Playwright-like SDK + MCP server for CLI automation)
      2. SDK API reference with code examples for TerminalPilot, TerminalSession, TerminalScreen
      3. MCP server usage: how to run the server, all 10 tools with input/output schemas
      4. Environment variables (if any)
      5. Testing: how to use the test fixtures
      6. Example: testing a poe-code configure flow end-to-end

      Keep it concise and practical. Reference the plan at docs/plans/terminal-pilot.md
      for design rationale.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# terminal pilot

Archived local pipeline plan converted from YAML during docs cleanup.
