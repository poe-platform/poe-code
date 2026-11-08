# CPython regex audit

The target is released csvkit 2.2.0 with source archive SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.
The authenticated CPython 3.14.2 executable has SHA-256
3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae and
Unicode 16.0.0. The dependency/locale/driver profile is reference-profile.json.

python-regex-reference.json records 77 native standard-library compile/search
observations: 31 supported patterns and 46 explicit feature/diagnostic blockers.
These are finite primitive observations, not command stderr or suite acceptance.
Reference-only Python research is separate from native-free canonical tests.
The first attempted capture had a research-script syntax error and produced no
artifact; the corrected authenticated capture produced the recorded artifact.

## Engine selection

Inspected safe-bash's commands/regex-execution/bounded-provider.ts, provider
protocol, BRE/ERE matcher paths and existing text-programs/regex.ts. These
engines provide their own dialects and contracts, including worker/resource
accounting and asynchronous checkpoints. They do not establish Python syntax,
Unicode semantics, backtracking priority or diagnostics. No shared engine was
substituted and no existing contracts or sealed fixtures were changed.

Inspected safe-python's session.ts and runtime/runtime-module-import.ts and
searched its implementation for a re module/regex engine. Its explicit module
registry and codec modules do not supply a qualified Python regex matcher.
An injected Python interpreter is therefore not an available qualified shortcut.
The original TypeScript codepoint parser/evaluator remains in csvkit, used by
both argv and SDK execution. No native program or Python fallback is introduced.

## Dialect disposition

| Area | Supported finite scope | Blockers |
| --- | --- | --- |
| Syntax | Literals, alternatives, capture-unobserved groups, noncapturing groups, dot, simple sets/ranges | Named captures, comments, warning-producing sets, escaped range endpoints |
| Unicode classes | Frozen decimal digits and Python whitespace; ASCII word classes | Unicode alphanumeric word classification and word boundaries |
| Case | ASCII literal IGNORECASE | Unicode case equivalence and case-insensitive ranges |
| Flags | Consecutive leading a/i/m/s/u groups with cumulative flags | Scoped additions/removals, verbose mode; full conflict/error diagnostics |
| Anchors | ^/$ with multiline/final-LF behavior; absolute A/Z/z; ASCII b/B | Exhaustive interactions, Unicode boundaries |
| Captures | Grouping without observable capture state | Numbered/named backreferences, captures visible outside assertions, group-name validation |
| Lookaround | Capture-free positive/negative lookahead; fixed-width codepoint lookbehind | Capture/backreference lookbehind, variable-width diagnostic parity |
| Conditionals | None | Group participation, branch grammar and diagnostics |
| Quantifiers | */+/?/bounded intervals, omitted minimum and lazy membership; empty progress guard | Possessive/atomic semantics, full error parity |
| Escapes | Control escapes, escaped punctuation, x/u/U codepoint escapes | Octal, Unicode names, escaped class range endpoints, full invalid-escape errors |
| Invalid patterns | Explicit status-78 refusal | Exact PatternError/OverflowError text, positions and csvkit disposition |

CPython 3.14 changed empty-string B matching and added z; the evaluator retains
this frozen behavior. Astral characters consume one Python codepoint. Range
validation now compares codepoints instead of UTF-16 string ordering. Repetition
numbers at or above 4294967295 are refused, matching the frozen compilation
boundary without inventing OverflowError diagnostics. FutureWarning-producing
nested/intersection/union/symmetric-difference sets are refused until warning
provenance is qualified; silently losing stderr is not compatibility.

## Resource and lifecycle scope

Every parse atom and evaluation transition uses the existing invocation step
function, which preserves cancellation reasons. Hex parsing also steps. Matching
uses a cumulative maxRegexWork across subjects. Patterns are limited to 256
codepoints, parser nesting to 64, evaluator nesting/sequence depth to 256.
Those are host refusals and explicit divergences from CPython. Evaluation remains
synchronous within those bounds; cancellation cannot process a new event-loop
callback while a synchronous search is running. No claim of preemptive isolation
or total JS heap accounting is made. Existing retained-input, row/output,
backpressure and cooperative cleanup ownership contracts are unchanged.

Original tests went red before assertion/escape support, nesting admission,
warning refusal and range/overflow fixes. A separate agent reproduced the range
and overflow bugs and qualified 37 in-memory stress cases against the frozen
reference. Canonical observation tests count supported comparisons and blocker
assertions separately. Full suite compatibility remains unfinished.

## Verification outcomes

The maintained uncached domain test route completed 39 files: 1,817 passing
assertions, one skipped and six TODO cases. Refusal assertions are included in
that test total and are not compatibility passes. Domain ESLint, product and
test TypeScript checks passed. Selected maintained build closures passed for
@poe-code/csvkit and @poe-platform/safe-bash. Focused integration ESLint passed.
Actual node:test/tsx Shell csvgrep review/stress/user-edge tests passed 50/50 with no
skips or TODOs. Existing backpressure, cleanup and cumulative-work cases remain
covered; no shared regex engine, stream implementation or registry was modified.

A compiled public plugin Shell invocation produced exact status zero, empty
stderr and `value\nA\naa\n` for `(?i)(?i)^a{,2}$`. Its terminal-png screenshot was
viewed: command and output were readable without clipping. That generated image
was temporary evidence in out and was removed after inspection. Full repository
checks were not rerun for this focused domain extension; previously recorded
uncommitted-authority archive verification blockers remain unresolved. There
are no commits, pushes, releases or README additions from this work.
