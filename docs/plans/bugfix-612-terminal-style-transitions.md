# Issue 612: preserve disabled attributes in terminal serialization

## Validated scope

The `kamilio` report reproduces against the workspace build from `848ca91a9`.
An actual PTY writes the supplied ANSI fixture; public `TerminalPilot` screen
capture and `renderTerminalPng` reproduce the cyan filled background after SGR
27. The emulator's second cell style is correct, but `renderLine()` emits a new
complete style without clearing attributes omitted from it. This is not an
application-output defect or a general color/font failure.

## Repair

Before changing a nonempty active style, emit SGR 0 and then the new complete
cell style. Initial styles, unchanged adjacent styles, default cells and final
line cleanup retain their existing behavior. Leave SGR parsing and
`serializeStyleState()` unchanged; its output describes a complete style, not
a delta. No README or unrelated source changes.

## TDD evidence

Evidence directory:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue612`.

- `red.log`: 13 new failures before production edits; five existing focused
  controls pass. The exact issue fixture lacks the required reset in raw output.
- `before-raw-lines.json` and visually inspected `before.png`: the real PTY
  captures the reported inverse leakage; RED/CYAN/plain controls remain correct.
- `green-package.log`: all seven terminal-pilot test files, 253 tests, pass.
  Coverage includes inverse, bold, dim, underline, italic, conceal,
  strikethrough, explicit default colors, indexed color and truecolor transitions.
  Cell styles are non-enumerable array properties, so tests compare them
  explicitly as well as cell contents and serialization idempotence.

The initial broader control also exposed a separate existing parser edge:
standalone `38;2;0;255;255` loses the zero red channel in `_parseCsiParams()`.
It reproduces in the unchanged baseline build without this repair. The initial
`green-core.log` failure is preserved; this issue does not claim to repair that
parser behavior. The scoped truecolor control uses a nonzero red channel.

## Delivery validation

Before delivery, run the normal full workspace build and `npm test`, root and
package lint, and full maintained Safe Bash typechecking. Capture and visually
inspect the same real-PTY fixture after rebuilding; `NORMAL CYAN` must be cyan
text on the default background. Preserve baseline artifacts and close every
owned PTY session. Push with normal hooks, verify remote-main SHA, close #612
immediately, then monitor actual terminal-pilot and root publication separately.
The seven-day author-filtered issue monitor remains active throughout.
