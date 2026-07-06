---
kind: pipeline
version: 1
tasks:
  - id: cmdkit-array-support
    title: Add array-of-groups support to cmdkit runners
    prompt: >
      Update `runMCP` and `runCLI` in `@poe-code/cmdkit` to accept `Group | Group[]` so multiple
      definition sets can be composed into one server or CLI.


      Plan: docs/plans/terminal-pilot-cli.md (section "Mounting multiple definitions")


      1. In `packages/cmdkit/src/mcp.ts`:
         - Change `runMCP(root: Group, ...)` to `runMCP(roots: Group | Group[], ...)`
         - If array, enumerate tools from all groups
         - Update `createMCPServer` similarly
      2. In `packages/cmdkit/src/cli.ts`:
         - Change `runCLI(root: Group, ...)` to `runCLI(roots: Group | Group[], ...)`
         - If array, register all groups as top-level commands
      3. Update existing tests, add new tests for array input

      4. Also update any other packages in the monorepo that currently use the old
      `terminal-pilot-mcp` package — they should import from `terminal-pilot/mcp` after the
      migration is done

      5. Ensure `npm run build` and all existing cmdkit tests pass
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-commands
    title: Define terminal-pilot commands using cmdkit defineCommand
    prompt: >
      Rewrite terminal-pilot's functionality as cmdkit command definitions in
      `packages/terminal-pilot/src/commands/`.


      Plan: docs/plans/terminal-pilot-cli.md (sections "Composable definitions", "CLI Commands — MCP
      Mirror", "Session Naming")


      Create one file per command using `defineCommand` from `@poe-code/cmdkit`:

      - create-session.ts — scope: ["cli", "mcp", "sdk"], params: command (String), args (Optional
      Array), session (Optional String, short: "s"), cwd (Optional String), cols (Optional Number),
      rows (Optional Number), observe (Optional Boolean)

      - fill.ts — params: text (String), session (Optional String, short: "s")

      - type.ts — params: text (String), session (Optional String, short: "s")

      - press-key.ts — params: key (String), session (Optional String, short: "s")

      - send-signal.ts — params: signal (String), session (Optional String, short: "s")

      - wait-for.ts — params: pattern (String), session (Optional String, short: "s"), timeout
      (Optional Number, short: "t"), literal (Optional Boolean, short: "l")

      - wait-for-exit.ts — params: session (Optional String, short: "s"), timeout (Optional Number,
      short: "t")

      - read-screen.ts — params: session (Optional String, short: "s")

      - read-history.ts — params: session (Optional String, short: "s"), last (Optional Number,
      short: "n")

      - resize.ts — params: cols (Number), rows (Number), session (Optional String, short: "s")

      - close-session.ts — params: session (Optional String, short: "s")

      - get-session.ts — params: session (Optional String, short: "s")

      - list-sessions.ts — no session param needed

      - index.ts — defineGroup combining all commands as `terminalPilotGroup`


      Session naming rules:

      - `-s, --session <name>` on every command (except list-sessions)

      - Env var: `TERMINAL_PILOT_SESSION` fallback when `-s` not provided

      - If `-s` omitted and only one session exists, use it implicitly

      - If `-s` omitted and multiple sessions exist, error with list

      - On create-session, if `-s` omitted, auto-name as s1, s2, ...

      - UUID is internal — CLI maps name → sessionId


      Each handler calls the existing TerminalPilot/TerminalSession SDK methods. The TerminalPilot
      instance must be shared across commands (inject via handler context or module-level
      singleton).


      Export the group via `terminal-pilot/commands` subpath. Update package.json exports:

      ```json

      "./commands": { "types": "./dist/commands/index.d.ts", "import": "./dist/commands/index.js" }

      ```
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-cli-entry
    title: Add CLI entry point using runCLI
    prompt: >
      Create `packages/terminal-pilot/src/cli.ts` — the CLI binary entry point.


      Plan: docs/plans/terminal-pilot-cli.md (sections "Architecture", "Output Format")


      1. Import `runCLI` from `@poe-code/cmdkit/cli`

      2. Import `terminalPilotGroup` from `./commands/index.js`

      3. Call `runCLI(terminalPilotGroup)`

      4. Add shebang `#!/usr/bin/env node`

      5. Update `packages/terminal-pilot/package.json`:
         - Add `"bin": { "terminal-pilot": "dist/cli.js" }`
         - Add `"./cli"` to exports
         - Add deps: `@poe-code/cmdkit`, `@poe-code/cmdkit-schema`
      6. The CLI supports `--output json` (or `--json`) for JSON output — this is handled by
      cmdkit's output format system

      7. Verify the CLI works: `npx terminal-pilot --help`, `npx terminal-pilot create-session
      --help`
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-mcp-rewrite
    title: Rewrite terminal-pilot-mcp to use shared cmdkit definitions
    prompt: >
      Rewrite the `terminal-pilot-mcp` package to use the shared command definitions from
      `terminal-pilot/commands` instead of hand-written MCP tools.


      Plan: docs/plans/terminal-pilot-cli.md (section "Composable definitions")


      1. Replace `packages/terminal-pilot-mcp/src/mcp-tools.ts` and `mcp-server.ts` with a simple
      entry point:
         ```typescript
         import { runMCP } from "@poe-code/cmdkit/mcp";
         import { terminalPilotGroup } from "terminal-pilot/commands";
         runMCP(terminalPilotGroup, { name: "terminal-pilot", version: "0.0.1" });
         ```
      2. Update `packages/terminal-pilot-mcp/package.json`:
         - Replace `tiny-stdio-mcp-server` dep with `@poe-code/cmdkit`
         - Keep `terminal-pilot` dep
      3. The `bin` entry (`terminal-pilot-mcp`) stays the same

      4. Verify `npx terminal-pilot-mcp` still works — same MCP tools exposed, same behavior

      5. Delete the now-unused `mcp-tools.ts` and `mcp-server.ts` files
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshot-command
    title: Add screenshot command (CLI-only, session-based)
    prompt: >
      Add a `screenshot` command to terminal-pilot CLI that captures an existing session's screen as
      PNG.


      Plan: docs/plans/terminal-pilot-cli.md (section "Extra CLI commands")


      Create `packages/terminal-pilot/src/commands/screenshot.ts`:

      - scope: `["cli"]` — not exposed via MCP or SDK

      - params: session (Optional String, short: "s"), output (String, short: "o"), window (Optional
      Boolean, default true), padding (Optional Number, short: "p")

      - Handler: get session via name, call `session.screen()`, get `rawLines` (preserves ANSI
      colors), join with newlines, pass to `renderTerminalPng()` from `terminal-png`

      - Add `terminal-png` as a dependency in package.json


      Add to the group in `commands/index.ts`.


      Test: create a session running a colorful command, take screenshot, verify PNG is written and
      non-empty.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: skill-template
    title: Create terminal-pilot skill template
    prompt: >
      Create the terminal-pilot skill template for agent installation.


      Plan: docs/plans/terminal-pilot-cli.md (section "Skill: terminal-pilot")


      Create `packages/agent-skill-config/src/templates/terminal-pilot.md` with the YAML frontmatter
      and markdown content from the plan:

      - name: terminal-pilot

      - description: 'Terminal automation skill using poe-code terminal-pilot MCP'

      - Body: Quick start guide covering create session, interact (fill/type/press-key), observe
      (read-screen/read-history/wait-for/wait-for-exit), manage (list-sessions/close-session)

      - Include patterns: run command and read output, interactive TUI, send signals

      - Include tips about fill vs type, literal matching, default terminal size
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: qa-cli
    title: Run QA test suite using the CLI
    prompt: >
      Run the full QA test suite from `docs/development/qa-terminal-pilot-mcp.md` but using the
      `terminal-pilot` CLI instead of MCP tool calls.


      Translation rules (MCP → CLI):

      - `terminal_create_session { command: "X", args: ["Y"] }` → `terminal-pilot create-session X
      Y`

      - `terminal_fill { sessionId: S1, text: "Alice\n" }` → `terminal-pilot fill -s S1 "Alice\n"`

      - `terminal_type { sessionId: S2, text: "Bob" }` → `terminal-pilot type -s S2 "Bob"`

      - `terminal_press_key { sessionId: S2, key: "Enter" }` → `terminal-pilot press-key -s S2
      Enter`

      - `terminal_send_signal { sessionId: S8, signal: "SIGINT" }` → `terminal-pilot send-signal -s
      S8 SIGINT`

      - `terminal_wait_for { sessionId: S1, pattern: "Hello", timeout: 5000, literal: true }` →
      `terminal-pilot wait-for -s S1 -t 5000 -l "Hello"`

      - `terminal_wait_for_exit { sessionId: S6, timeout: 5000 }` → `terminal-pilot wait-for-exit -s
      S6 -t 5000`

      - `terminal_read_screen { sessionId: S1 }` → `terminal-pilot read-screen -s S1`

      - `terminal_read_history { sessionId: S1, last: 2 }` → `terminal-pilot read-history -s S1 -n
      2`

      - `terminal_resize { sessionId: S9, cols: 120, rows: 40 }` → `terminal-pilot resize -s S9 120
      40`

      - `terminal_close_session { sessionId: S1 }` → `terminal-pilot close-session -s S1`

      - `terminal_get_session { sessionId: S1 }` → `terminal-pilot get-session -s S1`

      - `terminal_list_sessions {}` → `terminal-pilot list-sessions`


      Use `--output json` on all commands so you can parse and assert on the structured output.


      Run every test case from the QA doc (sections 1–36) in the REPL mode so sessions persist. Use
      named sessions (`-s`) matching the QA doc names (S1, S2, ... BASH, PY, NODE, VIM, etc.).


      For each test case, verify the assertions described in the QA doc. If any assertion fails,
      report which test case failed and why, then continue with remaining tests.


      Skip tests 31–35 (poe-code and Claude Code integration tests) — those require external tools
      that may not be available.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: installer-command
    title: Add terminal-pilot install/uninstall commands
    prompt: >
      Add installer commands to the `terminal-pilot` CLI as defineCommand definitions.


      Plan: docs/plans/terminal-pilot-cli.md (section "Installer")


      Create `packages/terminal-pilot/src/commands/install.ts` and `uninstall.ts`:


      1. `terminal-pilot install [agent]`
         - scope: ["cli"] only
         - Options: `--local`, `--global`
         - Prompts for agent if not specified (unless --yes)
         - Calls `installSkill()` from `@poe-code/agent-skill-config` with the terminal-pilot skill template
         - Registers `terminal-pilot-mcp` as an MCP server in the agent's config via `@poe-code/agent-mcp-config`
           - command: `npx terminal-pilot-mcp` (or resolved binary path)
           - transport: stdio

      2. `terminal-pilot uninstall [agent]`
         - scope: ["cli"] only
         - Removes the skill folder
         - Removes the MCP server registration

      Add both to the `terminalPilotGroup` in `commands/index.ts`.


      These commands use `@poe-code/agent-skill-config` and `@poe-code/agent-mcp-config` which are
      internal unpublished packages. They must be **bundled** into the terminal-pilot build output
      (not listed as external deps). This is the pattern for published packages in this repo that
      need internal deps.


      Follow the same patterns as existing `poe-code pipeline install` and `poe-code experiment
      install` commands for the actual skill/MCP registration logic.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# terminal pilot cli

Archived local pipeline plan converted from YAML during docs cleanup.
