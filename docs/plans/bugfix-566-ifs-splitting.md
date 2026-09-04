# Issue 566: bounded IFS word assembly

## Scope and baseline

- Base: `fdb29a1e6b3e3a4bedb1ac1d084af417ab16c907`.
- Preserve issue 565's parser budget and explicit parser-test allowance unchanged.
- Own only `packages/safe-bash/src/shell/runtime.ts` within IFS/word assembly,
  `packages/safe-bash/tests/shell/security-audit.test.ts`, relevant additions to
  `core.cases.ts` and `byte-values.test.ts`, and this plan.
- No Git mutations, registry/README changes, builds, broad gates, or issue 567 edits.

## Validated defects and RED tests

The read-only baseline produced 4096 appends for one 4096-character scalar,
129 temporary fields with a field cap of 4, and full scalar scanning before
cancellation observation. Scalars have existing retained-value limits; the gap
is temporary splitting/assembly, not an absence of all scalar accounting.

Add bounded in-memory regressions before production changes for contiguous runs,
pre-allocation field admission, actual event-loop yields for delimiter-free runs,
false/null cancellation identity, byte/non-ASCII-IFS checkpoints, and scalar
scratch admission and release. Do not reinterpret characters as commands.

## Implementation design

- Use one scanner for scalar and array-member IFS splitting, with a 4096-unit
  scan quantum shared across each Runtime's words/members and existing
  CPU/abort/yield machinery. Text counts UTF-16 units without bisecting a code
  point (at most one-unit overshoot); the raw-byte path counts bytes.
- Preserve code-point boundaries and the existing byte-preserving ASCII-IFS path.
- Check field capacity before creating additional field records.
- Assemble runs rather than characters; remove the redundant field text chain.
- Use a lazy word-local ValueArena scope for scalar temporary storage; account
  for newly allocated slices, fragment/field metadata and assembled payloads,
  rather than charging borrowed retained strings again or inventing array owners.
- Release temporary accounting in finally on success, limit error, or cancellation.

Whole borrowed strings are reused without payload reservations. Sliced text is
admitted at two bytes per UTF-16 unit before slicing; multi-fragment text output
is separately admitted before concatenation. Pattern storage stays lazy for
escaped patterns and multi-fragment byte fields, with scratch storage admitted
before allocation. Metadata uses the existing
32-byte entry and ValueScope enrollment conventions, not a measured JavaScript
heap-size claim. Word-part records, fields, fragment references and result entries
are covered. Byte fragments do not receive duplicate scratch and IO-scope
metadata reservations. Existing byte-value allocations/ownership remain with
their IO scope; existing array owners remain responsible for array words.

The field cap still counts temporary fields, including a trailing absent boundary,
as before; the change is admission before allocation, not a new field-count
definition. The existing non-ASCII-IFS byte-to-text fallback is unchanged; this
patch does not establish new lossless-byte semantics for that fallback.

## Validation and handoff

Run focused canonical tests using the supplied Node 22 toolchain, disabled TSX
cache, private TMPDIR, and cleared Git-local child environment. Run package-local
no-emit TypeScript checks with explicit owned roots, not archive discovery or a
build. Separate existing source diagnostics from newly introduced diagnostics.

Record RED/GREEN logs and final owned hashes in private scratch and report them
to root. These checks do not establish timing/RSS/OOM bounds, Worker deployment
behavior, a full gate, remote delivery, issue closure, or a release.

## Results (September 4, 2026)

- Initial `red.log`: six product regressions and two test-harness failures because
  Node's mock.method rejects Array.prototype as its target. Retained unchanged.
- `red-corrected.log`: all eight original regressions fail against unchanged
  production code, including 4096 appends, 129 fields with cap 4, missing false/null
  cancellation, absent checkpoints and absent scratch accounting/admission.
- Field observation now measures actual array extent rather than assuming the
  initial field was created outside push; the admission assertion is exactly 4.
- `ifs-boundary-first.log`: 21 passes, one additional RED. Thirty-two short array
  members scanned all 16384 characters before queued cancellation. Sharing the
  scanner quantum per Runtime fixes this rather than resetting at each member.
- `focused-third.log`: 197 tests pass across eight exact canonical in-memory
  files: security-audit.test.ts, core.cases.ts, byte-values.test.ts,
  value-state.test.ts, ansi-words.cases.ts, case.cases.ts, glob-budget.cases.ts,
  and fatal-expansion.cases.ts. No tests are skipped or counted as unavailable.
- Explicit-root package-local no-emit checks pass before and after the patch.
  Roots are src/shell/runtime.ts and the three owned test files, using the package
  strict compiler options and its local Node types. This is not the full-source
  gate and does not claim to fix the 24 source diagnostics reported by root.
- Preserve all existing tests, especially issue 565's explicit ParseBudget
  allowance. No parser-ledger/plumbing changes, no commits/push/closure/release.

Private logs are under
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/ifs-566.Es8Rml`.
The initial handoff records `green-final.log`, `types-final.log`, an exact owned-file
hash manifest and a bounded diff. Root owns full validation and delivery.

## Root review repair (September 4, 2026)

Root verified an unintended byte-pattern semantic delta in the first patch:
`case 'é' in $'\xc3'$'\xa9') say yes;; *) say no;; esac` produced `no` in the
built pre-566 Shell but `yes` in the patched source. The reverse subject/pattern
control produced `yes` in both. The lazy fallback used the decoded concatenated
byte value instead of concatenating each fragment's decoded pattern text.

Added five tests to the existing `tests/shell/byte-values.test.ts` before the
repair. `byte-pattern-red.log` records two failures (the reported case and its
replacement-character counterpart) and three passing controls (merged-byte
subject, quoted glob escaping, and preservation of a raw byte argument value).
The source regression is reproduced locally; the built-before comparison is
root-provided evidence and was not rebuilt or rerun here.

The repair adds four lines within word assembly: for a byte-containing field
with multiple fragments and no existing escaped pattern, admit pattern-entry
metadata and materialize the per-fragment projections. The existing pattern-join
payload admission remains in place. Pure-string and single-fragment borrowed
paths remain lazy; the assembled raw byte value and output admission are not
changed. No unrelated byte-pattern semantics are corrected, and no other 566
algorithm or 565 parser plumbing is undone.

- `green-byte-pattern-final.log`: all previous 197 tests plus five new byte-pattern
  tests pass, for 202 passed, zero failed/skipped/cancelled/TODO.
- `types-byte-pattern-final.log`: the same package-local Node 22 explicit-root
  no-emit typecheck passes with no diagnostics (exit 0).
- `owned-byte-pattern-sha256.txt`: refreshed hashes for the same five owned files;
  previous manifests and RED/GREEN logs remain unchanged as historical evidence.
- This repair changes only runtime.ts, byte-values.test.ts, and this plan;
  security-audit.test.ts and core.cases.ts retain their previous frozen hashes.

No builds, root gates, Git mutations, commits, pushes, closure, or releases were
performed. Full-source validation, delivery, and release remain root-owned.
