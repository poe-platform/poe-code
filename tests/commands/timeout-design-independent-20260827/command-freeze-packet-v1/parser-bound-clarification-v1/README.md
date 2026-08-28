# `timeout` duration-parser bound clarification v1

Status: Proposed additive pre-freeze clarification, 2026-08-28. Root routing to
Raman follows DU29. Stage 2 acceptance, Raman's independent freeze, and an
explicit implementation release remain prerequisites.

Implemented Through: Not applicable. This folder contains documentation and
data only; the timeout implementation remains held.

Purpose: Make the accepted duration parser's numeric, work, allocation, and
host-admission bounds exact without changing its grammar, diagnostics, public
API, help/version bytes, duration range, or cooperative cancellation claims.

## 1. Authority and unchanged boundary

This clarification is additive to accepted packet commit
`257bf6d7fe51b03c224fbca7e91519e692bfadd3` (tree
`b09ad20a5134d488dbf3f492cd9f4b516a429bf1`). It binds that packet's six files
and hashes in `identity.json`; those bytes MUST remain unchanged. Controlling
prior policy commits `8036a6c29873c6251d05d73c4b9eec99cf946af9` and
`7b812873c884a432951e981bfa908d7ca7407494` remain unchanged. The fixed baseline
is `12e196af8d8b0866339747150b02ca00b9764a09`.

The exact accepted grammar remains
`(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[smhd]?`. The millisecond multiplier `M` is
exactly 1000, 60000, 3600000, or 86400000. Mathematical zero disables the
deadline; every positive value is ceiled once; results above
`9007199254740991` are `duration-overflow`/125. There is no 24-hour cap, duration
token cap, new public option, `TimeoutLimits` object, Budget counter, capability
field, fallback Shell, host probe, or opaque-host preemption promise.

The accepted absent-property-only invoker fallback remains exact: a present
`context.invoke` whose value is `undefined` is unavailable/125 and never falls
back. Accepted help/version output and API bytes are untouched.

## 2. Authenticated Stage 2 constraints

The inspected API basis is the still-unaccepted commit
`fd1daa123298568546d9ea4e95f8c81dde9c52ff` (tree
`639d21ae58647bb3a33026549f3bb8b0e9595549`). Actual Stage 2 findings override
this clarification if review finds a conflict.

- `Shell.#execute` rejects shell source above configured `maxSourceBytes` before
  parsing and charges it through `Budget.source` (`src/shell/shell.ts:194-206`,
  blob `0b96a82f4ec29da4dbdd447806cca6a2f514311a`). The default is 1 MiB, but
  `resolveLimits` accepts any configured nonnegative safe integer
  (`src/shell/runtime.ts:28-56`, blob
  `bf41b4a97de4c20a0206abfd7b235cefd0aee1db`). This is a source-input byte
  limit, not a universal argv-length limit.
- Shell word expansion bounds each produced word's bytes with configured
  `maxExpansionBytes`, and the word list with `maxExpansionFields`
  (`Runtime.word`, `src/shell/runtime.ts:2491-2561`; `Runtime.words`, lines
  2298-2305, same blob). A source literal, parameter/environment expansion, or
  quoted literal routed through this path therefore reaches the command handler
  only after those configured expansion checks. Environment values are merely
  type/NUL-validated at root construction (`src/shell/shell.ts:237-242`); the
  later expanded word, not all ambient environment storage, receives the
  expansion-byte check.
- `Runtime.invoke` validates only string/array shape, NUL absence, and depth
  before converting literal argv to quoted words (`src/shell/runtime.ts:1973-2015`).
  The quoted words subsequently pass through the expansion checks. The literal
  strings and argument array already exist before that admission; the invoke
  entry itself has no token-length counter.
- `CommandContext.args` and `CommandInvoker` expose strings but no Budget or
  argv-length limit (`src/contracts/command.ts:4-35`, blob
  `9c5f2d150df8681f2688fe6aee7ed2d5dfcd22b8`). `ShellLimits` has source,
  expansion, output, command, loop, depth, and pipe fields, but no argv-length
  field (`src/shell/types.ts:18-45`, blob
  `763d2ee0ad2b15c7ed7af31e7c6171f739c98486`). A direct/custom host can call a
  command with a longer already-created string and bypass Shell limits.
- Output-byte accounting is sink accounting, not parser-work accounting
  (`Budget.sink`, `src/shell/runtime.ts:94-118`). Command/depth accounting limits
  dispatch count/nesting, not a token's code-unit length (`Budget.tick`, lines
  78-91; `Runtime.invoke`, lines 1973-1980).
- `CommandInvokeOptions.signal` is the existing optional native AbortSignal
  (`src/contracts/command.ts:4-19`). Stage 2 admits and delivers a child signal
  cooperatively (`src/shell/cancellation.ts:640-675`, blob
  `a0e68c7bfb2d541964194d38ef30a4a590bec1de`), while `interruptible` races an
  already-created promise (`src/shell/runtime.ts:121-133`). Neither mechanism
  preempts a synchronous JavaScript scan or arbitrary opaque host work. The
  command contract likewise says cancellation cannot terminate opaque work
  (`src/contracts/command.md:24-43`, blob
  `ef94adf238122441a66c2232fb3055aaee62d290`).
- The Stage 2 package declares no executable `bin` entry (root `package.json`,
  blob `161191ea9e8e56bbea0e74b48af54ee57b646015`). Accordingly, no separate CLI
  argv gate was authenticated; “CLI” admission here means the `Shell.exec`
  source/expansion path above.

Consequently, existing defaults provide finite bounds on the ordinary Shell
path but not a hard global maximum across configured Shell limits and trusted
standalone contexts.

## 3. Exact one-pass constant-state parser

Let `n` be the number of UTF-16 code units in the already-existing DURATION
string, including its optional suffix. For a grammar-valid token all code units
are ASCII, so `n` also equals its UTF-8 byte length. The parser MUST index the
original string. It MUST NOT copy a digit substring, build a digit array, parse
the token as Number, construct a BigInt from its digits, or construct `10^F`.

The parser MUST perform one reverse lexical traversal with constant scalar
state:

1. Inspect the last code unit for the optional unit and select `M`; a suffix
   probe that is not a unit remains part of the lexical traversal.
2. Until a decimal point is seen, update both (a) the exact reverse fractional
   multiplication state and (b) a checked reverse integer candidate. Candidate
   (b) is needed if the token contains no decimal point.
3. On the first decimal point, retain the fractional state, discard candidate
   (b), and start a fresh checked reverse integer accumulator for digits to the
   left. A second point or any non-ASCII-digit/non-point code unit marks syntax
   invalid, but traversal continues to the token boundary.
4. At the boundary, enforce the accepted digit shape: without a point, at least
   one digit is required; with a point, at least one digit must exist across its
   two sides, and an empty left side is allowed only when the right side is
   nonempty. Select the no-point candidate or the left-side accumulator.

Each code unit is traversed at most once, apart from the constant suffix probe;
the hard indexed-read bound is `n + 1`. Work is `O(n)`. The number of retained
numeric scalars, booleans, and indices is independent of `n`; auxiliary parser
storage is `O(1)` and contains no input-sized numeric intermediate.

### 3.1 Checked integer accumulator

For the selected `M`, let
`Q = floor(9007199254740991 / M)`. A reverse integer candidate holds a value
`I`, a decimal place `p`, a `place-too-large` flag, and an overflow flag.
Initially `I = 0` and `p = 1`.

For digit `d`, a zero at a place beyond `Q` remains harmless. A nonzero digit
overflows when the place is already beyond `Q` or when
`p > floor((Q - I) / d)`. Otherwise add `d*p` to `I`. Prepare the next place by
multiplying `p` by 10 only when `p <= floor(Q/10)`; otherwise set
`place-too-large`. After overflow, continue lexical validation without further
numeric growth.

Thus every materialized `I`, `p`, and accepted `d*p` is at most `Q`, and
`I*M <= 9007199254740991`. Arbitrarily many high-order zeroes neither allocate
nor cause false overflow.

### 3.2 Exact fractional multiplication

For fractional digits `d_1...d_F`, process `d_F` through `d_1`. Start carry
`c = 0` and sticky `s = false`. For each digit, form `t = d*M + c`, replace `c`
with `floor(t/10)`, and set `s` if it was already set or `t mod 10` is nonzero.

The invariant after all fractional digits is
`c = floor(M * (0.d_1...d_F))`; `s` is true exactly when that product has a
nonzero discarded fractional remainder. Therefore the fractional contribution
after the accepted single ceil is `c + (s ? 1 : 0)`.

The invariant `0 <= c < M` gives
`0 <= t <= 10*M - 1 <= 863999999`. The fractional contribution is at most `M`.
All are safe integers. Before final addition, compare that contribution with
`9007199254740991 - I*M`; only a fitting sum is materialized.

The previously suggested forward lexical scan plus reverse fractional scan is
arithmetically sound by the same recurrence and has at most `n + F` digit
visits. The one-reverse-pass form above is selected because it also preserves
the accepted literal one-scan requirement; the parallel no-point integer
candidate removes the need to know in advance whether a point exists.

The accepted `D*M/10^F` rational calculation remains the semantic oracle. It is
not permission to allocate `D`, `10^F`, or their product.

## 4. Diagnostics and admission policy

Leading option handling and informational exits retain accepted precedence.
With no DURATION token, use `missing-duration`. Once a token is present, finish
its lexical validation even after numeric overflow is known. Invalid grammar
uses `invalid-duration`; only a grammar-valid overflowing value uses
`duration-overflow`. Only a valid, nonoverflowing duration proceeds to the
existing missing-COMMAND check. No diagnostic echoes the token.

No new fixed duration-token ceiling is adopted. The exact policy is:

- Shell source admission owns source bytes; expansion admission owns the
  produced token bytes. The timeout parser neither recharges nor resets either
  Budget counter.
- A caller constructing literal argv owns admission of those strings before
  calling `context.invoke`; Stage 2 later applies its quoted-word expansion
  checks but cannot retroactively bound construction work or memory.
- A trusted standalone/custom provider MUST supply a finite, already-created
  DURATION string and MUST pre-admit its length and synchronous `O(n)` parser
  work under the provider's own resource policy. It MUST provide the accepted
  context/invoker signal and cleanup behavior if it claims those guarantees.
  This is a trust precondition, not runtime enforcement or a new public limit.
- Abort delivery remains cooperative. The parser makes no promise to yield,
  poll between digits, or let a timer callback run during synchronous parsing.

No root decision is required for this parametric bound. If an independent
review instead requires one universal fixed latency/work ceiling, that is
incompatible with the accepted uncapped grammar across direct contexts. It
would require a separately root-approved internal token-length constant, a
specified over-limit diagnostic and precedence, and an explicit semantic
delta. This addendum neither recommends nor adopts that alternative.

## 5. Prospective design edges

These rows are review examples only. They are not executable fixtures, test
rows, native observations, or additions to the frozen 33+12 family.

| DURATION shape | Expected mathematical outcome |
|---|---|
| `0...0d`, with arbitrarily many zeroes | exactly 0 ms; no overflow |
| `0...01s`, with arbitrarily many leading zeroes | exactly 1000 ms |
| `.0...01s`, with the nonzero digit arbitrarily late | exactly 1 ms after one ceil |
| `.001s` | exactly 1 ms, with zero sticky remainder |
| `.999...9d`, with any finite positive run of nines | positive and at most 86400000 ms; exact carry/sticky decides |
| `9007199254740.991s` | exactly 9007199254740991 ms |
| `9007199254740.9911s` | `duration-overflow`/125 |
| an overflowing digit run followed by `x` | `invalid-duration`/125, because syntax wins |

## 6. Freeze conformance

Raman can freeze this clarification only if the accepted packet hashes remain
unchanged; the recurrence and bounds above survive counterexample review; no
input-sized integer, power of ten, or digit copy is required; diagnostic order
matches the accepted packet; and the absence of a universal direct-context cap
is recorded rather than disguised as a Shell Budget guarantee.

This task adds no source, code, scripts, tests, native execution, help/version
change, API change, evidence-family row, Stage 2 acceptance, or independent
acceptance claim.
