# Proposed dotglob-only shopt profile — awaiting root ratification

This is a complete bounded proposal, not an independent normative freeze or
implementation permission. Only `dotglob` is supported; it starts off. Native
Bash's many other options are not implemented merely because they appear in
reference output. `expand_aliases` is explicitly refused in every operand mode,
including unset/query; never a successful no-op. No alias engine is enabled.

## Grammar, output and status

`shopt [-pqsu ...] [--] [name ...]`; short flags can cluster or repeat in any
order. Scan only the leading options. `--` ends scanning and is removed; a lone
`-` is an operand. First nonoption ends scanning; subsequent `-s`, `--`, etc.
are names, not flags. Only exact case-sensitive `dotglob` is a valid name.
Empty strings, `Dotglob`, `+s`, unknown names and all other Bash option names
fail. No identifier normalization, abbreviation, prefix matching or option-value
syntax. No new shell syntax or parser behavior is necessary.

Parse leading flags before touching state. Unknown flag characters, `-o`, all
long options other than separator `--` (including `--help`/`--version`), and
unsupported modes return2 without mutation. Diagnostic body:
`shopt: TOKEN: unsupported option`; then exact usage line
`shopt: usage: shopt [-pqsu] [--] [dotglob ...]\n`.
If valid flags include both s and u, return1 without mutation regardless of
order/repetition/names: `shopt: cannot set and unset shell options simultaneously`.
Invalid flags take precedence over that conflict. No last-flag-wins behavior.

After parsing, dispatch as follows:

| Mode | stdout | return policy | state |
|---|---|---|---|
| Named -s / -u, with or without p/q | empty | 0 if all names valid, otherwise1 | set/unset valid operands left-to-right |
| Named list / -p | each valid operand's current line | 0 only if all names valid and enabled | unchanged |
| Named -q, including -pq/-qp | empty | same named-list policy | unchanged |
| No names, ordinary / -p | all supported options only | 0 even when dotglob off | unchanged |
| No names, -s / -u, optionally p | supported enabled/disabled options only | 0, including empty selection | unchanged |
| No names, any q without s/u conflict | empty | 0, including empty selection | unchanged |

Repeated flags are idempotent. q suppresses normal output, never errors; named
mutation wins over p/q, so `-uq dotglob` returns0 after disabling, not1.
For operands, preserve order and duplicates; do not sort or deduplicate. For
unqualified listing the sole supported name is trivially lexically sorted.
Ordinary line is exactly `dotglob` + thirteen ASCII spaces + TAB + `on`/`off`
+ LF (20-column name field). Reusable line is exactly `shopt -s dotglob\n` or
`shopt -u dotglob\n`. No colors, headings or native executable prefix on stdout.

Each invalid operand gets diagnostic body
`shopt: NAME: unsupported shell option name (only dotglob is supported)`.
Use existing Runtime.diagnostic source-name/line formatting; do not transplant
the native `dotglob-reference: line N:` prefix. Error status is1 even under q.
Continue past invalid operands, including `expand_aliases`; retain earlier and
later valid mutations. No rollback. Listing likewise retains valid lines around
errors. Await every stdout/stderr write; escaping sink/abort/limit failures stop
work under existing runtime precedence, not a fabricated usage/status success.

## Expansion and compatibility conflict

Consult the flag during command execution's existing pathname expansion, not
reading or parsing. Row24 observes same-read-unit off/on/off effect. GNU manual
Simple Command Expansion and Filename Expansion support this timing (bindings
G2/G3); shopt source/reference observations resolve flag precedence beyond the
manual synopsis. No claim that all existing expansion semantics match Bash.

On: admit leading-dot entries at each wildcard path segment before matching.
Keep compilePattern, provider iteration/admission order, existing final
`found.sort()`, unmatched retention, quoting and literal handling. Keep existing
maxExpansionFields/maxExpansionBytes/pattern-work controls and passed signal;
do not reset shared budgets or counters. Native C-locale fixture ordering does
not prove VFS provider order, Unicode order, cancellation or budget handling.

Declared Bash5.3 globskipdots profile requires wildcard candidates always exclude
`.` and `..`, on AND off; literal `.`/`..` components are unaffected. This is a
fixed policy, not a supported shopt option named globskipdots.

**Root decision required:** current Runtime.glob only tests leading dot plus
segment-leading dot. A custom VFS returning `.`/`..` can therefore admit them
for `.*`/`.?` when off, if subsequent stat succeeds. This is static source
analysis, not a new product test. Strictly preserving every off-state result
and always excluding these candidates cannot both hold for that provider.
Recommended proposal: explicitly approve this narrowly named compatibility
correction and retain every other off behavior; otherwise the feature remains
blocked pending a revised requirement. Do not silently reinterpret preservation.

## Future bindings and discoverability

Read-only source hashes are in BINDINGS-v1.json; mixed HEAD is not certified.
Expected edits after a separately granted runtime window: internal State boolean,
cloneState, processState, glob/builtin dispatch in `src/shell/runtime.ts`, plus
the State initializer in `src/shell/shell.ts:245`. There is no function literally
named privateState or initialState in these inspected files. Primitive state
copy must preserve cloning; explicit initializers must reset false.

Inspected functions, source, eval and brace groups share state. Subshells,
pipeline stages and command substitutions copy state; child changes do not
escape. Literal invoke already clones state and dispatches literal argv: inherit
the copied dotglob value, never glob/reparse argv, never change parent state.
New exec/interpreter processState starts false. No global ShellOptions API,
ambient BASHOPTS/SHELLOPTS coupling or default command-family registration.

Add shopt to existing shellBuiltinNames/implementedBuiltins discovery, not the
specialBuiltinNames list or parser reserved words. Existing type/command paths
should identify/dispatch a genuine shell builtin and retain function precedence
and command's function bypass. There is no standalone `builtin` handler in the
inspected inventory: adding one is out of scope. Existing virtual bash/sh
interpreter handling stays unchanged. Maintain exact builtin/discovery fixtures
in the eventual coherent candidate; do not inflate default registry counts.
Root must rebind after Raman LET review and Poincare stack coordination, assign
runtime ownership, approve this grammar/diagnostics/status/partial-effect policy,
resolve the off-state conflict and authorize independent future verification.

## Preserved alias follow-up

Alias engine remains DESIGN-only. Future separate comparison: opt-in read-unit
file profile versus entrypoint restriction, and deferred command-substitution
representation. `scriptFile` whole-input preflight stays DEFAULT. No parser-unit,
file-profile, command-substitution AST, argv-replacement or stub changes here.
