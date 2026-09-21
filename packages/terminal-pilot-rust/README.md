# terminal-pilot-rust

Interpret interactive terminal output through an independent Rust display engine,
with portable Unicode state and no npm runtime dependencies.

| Capability | API |
| --- | --- |
| Track persistent cursor, styles, scrolling and alternate screens | `TerminalBuffer` |
| Read frozen text and styled screen snapshots | `TerminalScreen` |
| Encode named, Control and Alt keys | `keyToSequence` |
| Remove CSI, OSC and terminal string controls | `stripAnsi` |
| Automate a real PTY with input, waits, history, snapshots and signals | `TerminalSession` |
| Track independent sessions and shut them down with retryable escalation | `TerminalPilot` |

```typescript
import { TerminalBuffer } from 'terminal-pilot-rust';

const terminal = new TerminalBuffer(80, 24);
terminal.write('\x1b[32mPassed\x1b[0m\r\nReady');
console.log(terminal.renderLine(0));
console.log(terminal.displayBuffer.cursorY);
```

```typescript
import { TerminalPilot } from 'terminal-pilot-rust';

const pilot = await TerminalPilot.launch();
try {
  const session = await pilot.newSession({ command: '/bin/sh' });
  await session.fill('echo ready\n');
  console.log(await session.waitFor('ready', { scope: 'screen' }));
  console.log((await session.screen()).text);
} finally {
  await pilot.close();
}
```

Rust retains UTF-16 cells, styles, cursor and tab state, terminal parser chunks,
split surrogates, graphemes, wide-cell erase, saved cursors, scrolling regions,
origin/insert/wrap modes and DEC character sets. Unicode 17 property data supports
joined emoji, regional flags and Indic conjunct widths. An own POSIX PTY transport supports macOS/Linux controlling terminals, bounded
input queues, resize/signals and asynchronous finalizer reaping. Node supplies public cell
views and frozen snapshot metadata through one bundled napi-rs addon.

Dimensions are bounded to 1–1000 rows/columns. CSI parameters, grapheme text and
repeat work have explicit budgets. Public display views are snapshots; mutating
a returned cell array does not mutate the Rust engine.

Session lifecycle, carriage-return/backspace history rewrites, screen snapshots,
input admission, wait validation and close escalation belong to Rust. Node owns
UTF-8 decoding, subscriptions, timers, environment and process effects. ECMAScript
`RegExp` waits use Node's pattern engine; literal matching runs in Rust. Captured
history is retained for the session lifetime, including after exit, and can grow
with output. Closed sessions release the PTY descriptor immediately. Sessions
currently support macOS and Linux; Linux execution remains unverified.

This private additive rewrite's CLI/commands, MCP integration
and Python bindings are unfinished. Existing imports remain unchanged. Nominal
TypeScript classes with private SDK fields require a public structural contract
when exchanging implementations. General Unicode width parity and cross-platform
acceptance remain under review.
