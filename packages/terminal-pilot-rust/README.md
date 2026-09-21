# terminal-pilot-rust

Interpret interactive terminal output through an independent Rust display engine,
with portable Unicode state and no npm runtime dependencies.

| Capability | API |
| --- | --- |
| Track persistent cursor, styles, scrolling and alternate screens | `TerminalBuffer` |
| Read frozen text and styled screen snapshots | `TerminalScreen` |
| Encode named, Control and Alt keys | `keyToSequence` |
| Remove CSI, OSC and terminal string controls | `stripAnsi` |

```typescript
import { TerminalBuffer } from 'terminal-pilot-rust';

const terminal = new TerminalBuffer(80, 24);
terminal.write('\x1b[32mPassed\x1b[0m\r\nReady');
console.log(terminal.renderLine(0));
console.log(terminal.displayBuffer.cursorY);
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

This private additive rewrite currently provides display/screen/key primitives.
Public PTY sessions, `TerminalSession`, `TerminalPilot`, CLI/commands, MCP integration
and Python bindings are unfinished. Existing imports remain unchanged. Nominal
TypeScript classes with private SDK fields require a public structural contract
when exchanging implementations. General Unicode width parity and cross-platform
acceptance remain under review.
