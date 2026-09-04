# #574 shell string operation materialization

## Scope and baseline

- Authorized September 4, 2026, against delivered `070c762bde2bda8dd46da28d23d14873fc1326f2`.
- Confirmed issue author `kamilio` and current body with `gh`.
- Length, Unicode substring and parameter pattern operations still materialize
  whole code-point arrays; pattern matching also reconstructs each candidate.
- Existing pattern work limits and scalar retained-value accounting remain real
  safeguards. No OOM, memory multiplier, CPU timing or Worker survival claim.
- Preserve #565/#566, byte-locale semantics, parser ownership and existing seals.

## TDD and implementation

1. RED: tiny public-shell instrumentation for scalar/indexed length, substring,
   replacement and removal; deterministic mid-scan cancellation; range matching.
2. Replace whole-value arrays with constant-storage code-point scans and UTF-16
   boundaries. Preserve BigInt arithmetic, captured values and evaluation order.
3. Match source ranges without candidate strings/arrays. Preserve leftmost-longest
   search, anchors, star retry, zero-width progress and replacement quoting.
4. Admit remaining operation scratch through value scopes, independent of indexed
   ownership; debit bounded work and checkpoint scans. Preserve output admission.
5. GREEN: new focused tests plus existing substring/parameter compatibility
   cohorts; focused no-emit types. Root owns registry, build and broad gates.

## Ownership and delivery

- Product: `packages/safe-bash/src/shell/runtime.ts`, `pattern.ts`, and a narrow
  Unicode operation helper only if needed.
- New tests: `packages/safe-bash/tests/shell/string-operations.test.ts`.
- Root must register that test path; no registry, README, parser, seal or capture
  edits, commits, pushes or releases in this assignment.
- Record RED/GREEN, exact final hashes and limitations before freezing.

## Completed implementation and focused evidence

- Length uses constant-storage code-point counting. Unicode substring scans
  UTF-16 boundaries after the original offset evaluation and before/after length
  evaluation as required by the captured-value and skip-length contracts.
- Pattern matching takes optional UTF-16 source boundaries without changing
  existing whole-string callers. Candidate arrays/strings are gone; replacement
  and removal retain candidate ordering. No-match replacement returns its source.
- Remaining pattern, arithmetic, byte-locale and output scratch is admitted in
  operation-owned value scopes with finally cleanup, for scalars and indexed
  values. No synthetic indexed-array owner. Work checkpoints cover Unicode scans,
  matching and replacement assembly. Byte-locale slicing/decoding semantics stay.
- Initial RED: all 18 allocation/range/cancellation regressions failed on the
  delivered implementation. Initial GREEN: 18/18 after implementation.
- Additional RED: the tilde-construction admission test failed, then passed after
  admission moved before suffix construction. A separate no-match source-slicing
  test failed, then passed after returning the original source directly.
- Final new-file GREEN: 38/38. Final focused combined GREEN: 163/163 across
  `string-operations.test.ts`, `substring.test.ts`, `substring-positional.test.ts`,
  `expanded-gaps-parameter.test.ts`, and `substring-bounds.test.ts`.
- Separately selected tiny #565/#566 regressions: 14/14. Selection prefixes:
  `parse limit overrides`, `newline units`, `admitted syntax`,
  `individually affordable`, `IFS scratch releases`, `IFS non-ASCII` in
  `parse-admission-runtime.test.ts`, `security-audit.test.ts`, `byte-values.test.ts`.
  Generated/stress cases outside that selection were not executed.
- Focused TypeScript program: the three owned source files and new test as roots,
  their imports, package compiler options, `noEmit: true`, `incremental: false`;
  zero diagnostics. An initial test mock omitted `ValueAllocation.assertOpen`;
  its interface was corrected before the successful check.
- Owned diff whitespace check passed. No build, full gate, lint/release clearance,
  README, parser, registry, seal/capture edits, Git mutations or delivery claim.
- Node 22.22.0; supplied toolchain/private TMPDIR pathfiles; TSX cache disabled;
  NO_COLOR unset; child Git-local variables cleared. No OOM/crash/stress probes,
  large generated inputs, memory/CPU measurements or Worker-survival claims.
- Frozen for sequential #569 runtime ownership. No #569 runtime guard implemented;
  word/valueWord/partValue signatures and #565/#566 splitting/admission code remain
  unchanged. Root owns registering the new test, remaining gates and Git/release.

### Frozen SHA-256

| File (under `packages/safe-bash/`) | SHA-256 |
| --- | --- |
| `src/shell/runtime.ts` | `729be35bd7dde86349280b82d56ca56c2881276fe868f0fd32bce3683f1c728f` |
| `src/shell/pattern.ts` | `76b6222e81221f9c04c7db5772d0332dbbceaafe5eadda1d1c94ada076293cf4` |
| `src/shell/string-operations.ts` | `8132b94610d81641c62f411d593bd5d4da3f4bf819d2ad128bd50249e5437a36` |
| `tests/shell/string-operations.test.ts` | `9a86963ead981c503f856b188912b0a2e444ded02f7b6b61ca7b56c085d0b032` |
