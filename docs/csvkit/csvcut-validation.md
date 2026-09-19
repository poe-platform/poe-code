# csvcut validation

The executable descriptor now contains the literal raw selection engine in
`packages/csvkit/src/commands/csvcut.ts`. Existing automatic command inventory
and safe-bash registration select this engine; CLI argv and SDK settings share
it. No product subprocess, Python fallback or ambient capability was added.

The released source archive was downloaded for inspection and its SHA-256
matched `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The existing frozen reference profile and captured raw observations remain the
reference authority. Generated headers are a Python tuple, so singleton header
errors require trailing-comma punctuation. A new failing regression reproduced
the missing comma before the implementation correction.

Coverage includes inherited flag applicability and collisions, exact frozen
stdout/stderr/status comparisons, repeated selection, duplicate/numeric headers,
unknown exclusions, open/reverse ranges, short/surplus rows, trailing empty
cells, physical skip-lines, multiline values, raw scalar text and CLI/SDK parity.
Independent safe-bash stress coverage checks empty/no-column input, names-only
validation ordering, selection-before-deletion, numbering and input cleanup.
Text decoding retains the frozen 8192-byte CPython read-ahead window; names-only
returns after the header record rather than after a single transport fragment.

Executed uncached checks:

- Maintained csvkit unit command: 1660 passed, 1 skipped, 6 todo.
- Maintained csvkit lint, source type check and test type check: passed.
- Selected safe-bash workspace build closure: passed, including csvkit.
- Focused actual shell integration/selector/stress tests: 99 passed.
- Integration inventory tests: 109 passed, including exact new stress-test path.
- Screenshot of injected shell names and numbered repeated selection: inspected.

## Explicit blockers

Shared raw input quoting modes 2, 4 and 5 remain unsupported. The frozen mode-2
observation is an explicit skipped differential, not a compatibility pass.
Verbose errors without frozen Python traceback frames and deployment identity
remain status-78 refusals. Existing codec and temporal todos remain unresolved
outside this command change. Native TTY, SIGPIPE and arbitrary injected driver
behavior were not measured here. This validation does not establish complete
fourteen-command csvkit parity. Package README creation awaits user permission
under the root instruction prohibiting additions. No Git delivery was performed.
