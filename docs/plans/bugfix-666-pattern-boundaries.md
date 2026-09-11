# Bugfix 666: parameter-pattern boundary search

## September 8: root delivery qualification

Combined evidence: `/tmp/kamilio-655-666-gate.2t9R06`. Complete maintained
SafeBash unit route passes: 282 runner assertions and **22,153 passing unit
cases, 63 skips, zero failures/cancellations**. Selected workspace build,
exclusive guarded root lint and 166 playground tests/build also pass.
The full suite ran on `2efcacf01`; root's rebase onto upstream `b49a48946`
preserves identical SafeBash/SafeFS Git trees, followed by another successful
selected build and root lint on `29b645404`.

Built public Node exports match native Bash for an 8,192-character global
no-match replacement. Actual browser preview succeeds at 2,048 characters;
8,192 characters are refused under its existing 64 KiB expansion profile.
No limit was increased, and that larger browser refusal is not a pass.
Screenshot `/tmp/kamilio-655-666-browser-qualified.png` was inspected; browser
and preview were closed. The shared jq plan records the test-only historical
evidence corrections, original failures and exact validation qualifications.
Push and release verification remain separate from these local gates.

## Authority and status

September 8, 2026: preparation remained limited to this plan and `/tmp` during
root's gates and Bacon's runtime ownership. Prior delivery reports were the nl
follow-up at `7b2d16401` and 653/654/664 at `9b791fa88`.

Root subsequently reported 667 pushed/closed at
`424b257db33a1e8d03f5ce8dcadcc41ed67eb630` and explicitly granted canonical
ownership of `src/shell/pattern.ts`, the parameter-pattern caller/import in
`src/shell/runtime.ts`, `tests/shell/pattern-boundaries.test.ts`, and this plan.
The prepared hunks were reconciled with current source and applied without
altering 667's operand-depth/substitution guards. No whole-file replacement.
Root owns integration, inventory, Git/build/lint/full gates; Rawls owns the
disjoint structured-command work. Temporary tests are not inventory membership.

## Fresh bounded evidence

The temporary file `/tmp/kamilio-666-20260908T063247Z.test.ts` imports current
repository Shell/Runtime/MemoryFileSystem modules by absolute path. Its 29 tests
produce **8 assertion failures, 21 passes, zero skips/cancellations** before any
product patch. Subjects contain only 8, 16 or 32 ASCII zeroes; all no-match
outputs/statuses are correct. Instrumentation counts source `codePointAt` calls
only while `Runtime.parameterPattern` is active, not elapsed time or heap use.

| Operation | Source code-point reads at n=8 / 16 / 32 |
| --- | --- |
| `#*1` | 95 / 319 / 1151 |
| `##*1` | 87 / 303 / 1119 |
| `%*1` | 87 / 303 / 1119 |
| `%%*1` | 95 / 319 / 1151 |
| `/#*1/X` | 88 / 304 / 1120 |
| `/%*1/X` | 95 / 319 / 1151 |
| `/*1/X` | 291 / 1799 / 12559 |
| `//*1/X` | 291 / 1799 / 12559 |
| `%1*` (fail-fast control) | 15 / 31 / 63 |

These counters include retry/offset and initial source scans, so they differ
from the earlier matcher-loop-only counts (44/152/560 and 156/952/6512).
The control remains linear in matcher work; do not relabel it quadratic just
because the caller also charges candidate lengths. Each RED asserts a bounded
linear input-read envelope for a fixed two-token pattern, not a wall-time bound.
Twenty passing controls cover trim preferences, anchors, global replacement,
unquoted `&`, character classes, Unicode boundaries and empty-pattern behavior.

Current `parameterPattern` already debits `length + 1` before every candidate
call. The defect is repeated search, not absence of that debit. Its budget is
`min(MAX_SAFE_INTEGER, maxExpansionBytes * 4 + 1024)`. With the current default
`16 * 1024 * 1024`, that is **67,109,888** units, not 67,108,888. Keep this formula
and the allocation limits unchanged; do not add an unrelated ceiling or double
charge the obsolete candidate scans. No OOM, heap ratio or latency claim follows
from these witnesses.

## Algorithm: one reusable endpoint table

Keep the current tokenizer, escapes, character-class predicates and standalone
`compilePattern`/`matchesPattern` API unchanged. Add a separate internal exported
compiler `compilePatternBoundaries(pattern, work)` for parameter operations.
Like the existing compiler, it parses once and holds tokens in the caller's
scratch scope. Its returned asynchronous query takes the source string and
shortest-end / end-anchored flags and computes endpoints once.

For each valid UTF-16/code-point boundary `start`, retain the shortest or longest
accepted exclusive end, or -1 for no match. End-anchored mode only admits the
source's final boundary. A backward dynamic program computes this without
enumerating candidate substrings or reversing/materializing source code points.

Let `D(start, token)` be the selected accepted end from that source boundary and
token suffix. At the terminal token, `D = start`, except end-anchored queries
permit only `start == source.length`. A consuming token uses the next source
boundary and next token if its existing predicate accepts. A star chooses the
requested minimum/maximum between skipping itself and consuming one code point
while remaining on the star. Unavailable branches have value -1.

Process source boundaries right-to-left using `previousCodePointOffset`, and
tokens right-to-left. One numeric row suffices: save the old right-hand cell in
a scalar before overwriting it, so both diagonal and same-token dependencies
remain available. Save row zero into the endpoint table after each boundary.
Surrogate-interior slots stay -1 and are never candidates. Existing raw text
offsets feed the unchanged replacement `&` slices, without transcoding.

For p tokens, n code points and u UTF-16 units, charged transitions and array
initialization are O((n+1)(p+1)+u),
with O(p+u) numeric storage. Global replacement queries the same table after
each match instead of rescanning the suffix. Boundary selection advances
monotonically, so its aggregate work is O(n), excluding existing output copying.
This fixes the repeated-boundary factor; it is not a claim that every parameter
operation, pattern compilation or output builder is globally linear.

## Admission, work, cancellation and lifetime

- Reserve the row and endpoint storage before typed-array construction, from
  `work.allocation` (the existing parameter scratch scope). Use Float64Array
  slots for exact offsets without introducing a new signed-32-bit ceiling.
  Charge each array's fixed header plus eight bytes per slot. Only two new
  reservations are needed; no per-cell records or closures.
- Precharge array initialization, then charge every visited source boundary,
  token transition and endpoint lookup through existing `stringCheckpoint`.
  Maintain its cooperative yield policy and exact abort reason, including falsey
  reasons. No native pattern-matching fallback, wall-clock deadline or budget
  increase; existing single-code-point class predicates remain unchanged.
- Release row storage in `finally`; release an incomplete endpoint table on
  failure/cancellation. A successful table remains in the existing scratch
  scope through output building and is released by `parameterPattern`'s current
  `finally`. Tokens retain the existing compiled-pattern scope ownership.
- Retain the existing initial `scanString` admission before replacement operand
  expansion. Compile before replacement expansion as today, but compute the
  endpoint table only when matching currently starts, after replacement operands
  for replacement operations. Do not move matching failures ahead of operand
  side effects or evaluate replacement operands twice.
- The table's derived admission can reject when its real modeled storage does
  not fit the existing cap. Do not waive admission or claim unchanged allocation
  thresholds; test bounded success/failure explicitly after the writer grant.

## Exact runtime selection

- `#`: shortest endpoint at start zero. `##`: longest endpoint at start zero.
  A missing endpoint returns the original text without slicing it.
- `%`: end-anchored table, choose the largest matching start. `%%`: same table,
  choose the smallest matching start. Empty-match preferences remain intact.
- `/` and `//`: choose the first start at/after the current position with an
  endpoint; that endpoint is already longest. Build the table only once.
- `/#`: only start zero is eligible. `/%`: use the end-anchored table and choose
  the earliest matching start. Empty anchored patterns still insert at edges.
- Preserve current empty unanchored-pattern no-op, empty global-match one-code-
  point advancement, stopping at the final endpoint, quoted/unquoted `&`, tilde
  handling, replacement admission, output status and no-match identity return.
- Keep tokenizer and projection/locale behavior unchanged. Unicode controls
  demonstrate current code-point behavior, not new locale/invalid-byte parity.
  Existing byte and locale suites remain required adjacent validation at grant.

## Bounded tests after writer grant

Promote the temporary public-route tests into a dedicated canonical shell test
using relative `.js` imports. Add endpoint-table equivalence tests against the
existing `compilePattern` on small strings/patterns: escaped stars/brackets,
empty and repeated stars, classes, surrogate pairs/unpaired surrogates, shortest
and longest choices, and end anchoring. This reference deliberately enumerates
tiny candidates only in tests, not in production.

Add deterministic probes for preallocation refusal before either typed array,
row/table cleanup after success/failure/falsey cancellation, exact lowered-work
boundaries, and cancellation at an existing cooperative checkpoint. Check that
the table is constructed once for a global replacement with several matches.
Do not add default-limit stress or OOM tests. Focused maintained parameter/string,
pattern-admission, byte-value and adjacent shell tests only; root owns broad gates.

## Temporary runner

Use Node 22.22.0 from `/tmp/kamilio-toolchain.path`, `TSX_DISABLE_CACHE=1`, unset
`NO_COLOR`, and `TMPDIR=$(cat /tmp/kamilio-569-575-validation.path)/tmp`.
The maintained `packages/safe-bash/scripts/test-reporting.mjs` runs with
`--import tsx --experimental-test-isolation=none --test-concurrency=1` and the
temporary test path. Because `/tmp` is outside the repository ESM package, a
`node:module.registerHooks` loader transpiles only that exact temporary test URL
as ESM in memory. All product imports come from unchanged current source via
tsx; no source shadowing or candidate execution contributes to fresh RED.

## Prepared handoff

The unapplied candidate is `/tmp/kamilio-666-20260908T063247Z.patch`.
SHA-256: `d0c2023d196b250d408d94ad284f60bc7de3a124530c6af318732a67cf53cf16`.
It contains only:

- `packages/safe-bash/src/shell/pattern.ts` (two hunks)
- `packages/safe-bash/src/shell/runtime.ts` (three parameter-caller/import hunks)
- `packages/safe-bash/tests/shell/pattern-boundaries.test.ts` (new)

All five hunks match the current source at review time. In-memory patch
application and TypeScript parsing report zero syntax diagnostics for all three
candidate files, without writing or executing candidate product code. The
source hashes checked during review are:

- pattern: `b100d625561154d95ec37bf07e9766330975d11f969f8b9a38270e928c1ee6a1`
- runtime: `54ce446a1dd78abdffe6ac0e115a890639d77f882730bc8c6e880738bee0c278`

The fresh temporary current-source suite was rerun after resumption: again
29 cases, 8 assertion failures and 21 passes, with the exact same bounded
counters. The candidate test addition contains those 29 cases plus six
unexecuted post-grant controls (35 cases total): tiny reference-matcher
equivalence, joint 511/512-byte admission, exact 22/23-unit query work, two
cancellation identities with live buffers, and single-table global replacement.
These expected boundaries are derived from the candidate's accounting, not
claimed passing observations.

Review confirms that the in-place row retains the old diagonal before replacing
each cell, terminal acceptance distinguishes suffix anchoring, and -1 is never
treated as a matching endpoint. Selection reuses one table, retains replacement
operand evaluation order, and preserves the existing zero-width advancement.
Row/result failure cleanup bypasses cancellation checks through current
reservation release methods; successful table ownership stays with scratch.

Those were pre-grant syntax results, not candidate behavior or byte/locale
parity evidence. Canonical execution after the explicit grant is recorded below.

## Canonical execution and freeze

After reconciling the current runtime (667 shifted the parameter method by 21
lines but did not conflict with these hunks), the saved patch applied through
`apply_patch` to exactly the two product files and dedicated test. The prior
fresh RED remains 8 failures / 21 passing controls. No budgets were raised.

The canonical dedicated test is **35/35 GREEN**, including the previously
unexecuted reference, preadmission, exact-work, cancellation and reuse controls.
Measured source reads at 8/16/32 bytes are now:

| Operation | Source code-point reads |
| --- | --- |
| `#*1`, `%%*1`, `/%*1/X`, `/*1/X`, `//*1/X` | 23 / 47 / 95 |
| `##*1`, `%*1`, `%1*` | 15 / 31 / 63 |
| `/#*1/X` | 16 / 32 / 64 |

In particular, unanchored first/global replacement changes from
291/1799/12559 to 23/47/95 reads. The fail-fast `%1*` control remains unchanged.
The tiny joint-storage test observes refusal at 511 bytes before either numeric
array is constructed, success at 512, row release leaving 424 live bytes, and
scope cleanup to zero. Query work accepts exactly 23 units and rejects 22.
Cancellation with live buffers preserves the exact falsey/object reason.

Maintained focused/adjacent command from `packages/safe-bash`:

```sh
node scripts/test-reporting.mjs --import tsx --experimental-test-isolation=none --test-concurrency=1 tests/shell/pattern-boundaries.test.ts tests/shell/pattern-admission.test.ts tests/shell/string-operations.test.ts tests/shell/expanded-gaps-parameter.test.ts tests/shell/parameter-depth.test.ts tests/shell/runtime-parameter-depth.test.ts tests/shell/byte-values.test.ts tests/shell/substring.test.ts tests/shell/substring-positional.test.ts tests/shell/substring-bounds.test.ts
```

Final result: **345/345 assertions across ten selected files**, zero failures,
skips, cancellations or todos. The first sandboxed run passed 344 assertions
but could not spawn the existing substring-bounds child (`EPERM`); rerunning the
same selection with execution approval passed all 345 without changing tests.
Node 22.22.0, assigned `TMPDIR`, `TSX_DISABLE_CACHE=1`, and unset `NO_COLOR`.

All four granted files are frozen and no test processes remain. Root must admit
the new exact test path to its maintained inventory and perform integration
gates. This leaf performed no Git operation, build, lint or full-suite run.
Focused GREEN is not remote-main delivery, release success, an OOM guarantee,
or new byte/locale behavior beyond the tested existing semantics.
