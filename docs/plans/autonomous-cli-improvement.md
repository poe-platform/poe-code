---
agent:
  - claude-code
  - codex
iterations: 50
status:
  state: in_progress
  iteration: 1
---

Run autonomously, improve the design of cli commands, start with spawn and expand. And then also double-check other commands. Systematically test and improve all commands.

## Todo

Maintain todo lists in {{ current_file }}

- [x] improve spawn `npm run dev -- spawn claude "what files are here?"` - check kimi, opencode, claude, codex
  - [x] weird extra bullet after Claude Code spawn completed.
    - Removed redundant `logger.info("spawn completed.")` fallback from `src/cli/commands/spawn.ts`
    - The ACP stream's `✓ tokens:` line already signals completion
  - [x] no space before tokens, looks too crammed
    - Added blank line separator before `✓ tokens:` in `packages/design-system/src/acp/components.ts`
- [x] check wrap — looks clean, no issues
- [x] check github workflow commands — uses cmdkit design system, consistent
- [x] enforce sentence-style command descriptions across visible CLI commands
  - added `src/cli/ui/help-format.test.ts` audit to require sentence-style punctuation for visible commands
  - normalized visible descriptions in `generate`, `mcp`, and `skill`
- [x] remove snake_case from visible command names while preserving compatibility
  - renamed public command to `auth api-key`
  - preserved the legacy `auth api_key` spelling as a hidden compatibility command so help output stays clean

## Verification

- `npm run test:unit -- src/cli/commands/root-command.test.ts src/cli/ui/help-format.test.ts src/cli/commands/auth-command.test.ts src/cli/commands/generate-command.test.ts src/cli/commands/mcp-command.test.ts src/cli/commands/skill-command.test.ts`
- `npm run lint:types`
- `npm run test:unit`
- `terminal-pilot` in-process CLI REPL screenshots captured to:
  - `/tmp/poe-auth-help.png`
  - `/tmp/poe-generate-help.png`
  - `/tmp/poe-mcp-help.png`
  - `/tmp/poe-skill-help.png`
- note: top-level `mcp --help` naturally overflows the viewport because it appends the tool catalog, so the screenshot lands at the bottom of the scrollback even though text verification passed

## Constraints

- Commit your changes
- Treat {{ current_file }} as working document
- For spawn. You must not diverge from the ACP spec, no custom fields, no hacks
- If you find bugs, fix them
- If you find failing tests, fix them
- Fix the issues in the design language at the root cause, no hacks.

## Use terminal-pilot for testing and screenshots (npm run screenshot)

Use the `npx tsx packages/terminal-pilot/src/cli.ts` CLI when you need to automate or inspect interactive
CLI applications through a real PTY session.

## Commands

- `npx tsx packages/terminal-pilot/src/cli.ts screenshot -s <session-name> -o output.png`
- `npx tsx packages/terminal-pilot/src/cli.ts  create-session` - start a PTY-backed command
- `npx tsx packages/terminal-pilot/src/cli.ts  fill` - paste text into a session
- `npx tsx packages/terminal-pilot/src/cli.ts  type` - type character-by-character for TUIs and readline
- `npx tsx packages/terminal-pilot/src/cli.ts  press-key` - send named keys such as `Enter` or `ArrowDown`
- `npx tsx packages/terminal-pilot/src/cli.ts  wait-for` - wait for terminal output to match a pattern
- `npx tsx packages/terminal-pilot/src/cli.ts  wait-for-exit` - block until a session exits
- `npx tsx packages/terminal-pilot/src/cli.ts  read-screen` - inspect the current visible terminal screen
- `npx tsx packages/terminal-pilot/src/cli.ts  read-history` - read scrollback output
- `npx tsx packages/terminal-pilot/src/cli.ts  list-sessions` - list active sessions
- `npx tsx packages/terminal-pilot/src/cli.ts  close-session` - close a session and return its exit code

## Examples

```bash
npx tsx packages/terminal-pilot/src/cli.ts  --help
npx tsx packages/terminal-pilot/src/cli.ts  create-session --help
npx tsx packages/terminal-pilot/src/cli.ts  read-screen --help
```

Use JSON output when another tool or script needs to read the result:

```bash
npx tsx packages/terminal-pilot/src/cli.ts  list-sessions --output json
npx tsx packages/terminal-pilot/src/cli.ts  read-screen --session s1 --output json
```

## Tips

- Use `fill` for pasted text and multi-line input.
- Use `type` when the app reacts to individual keystrokes.
- Use `press-key` for Enter, Tab, arrow keys, Escape, and control-key chords.
- Use `wait-for --literal` for exact string matching.
- Default terminal size is 120x40.
