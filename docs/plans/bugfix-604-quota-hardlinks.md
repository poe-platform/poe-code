# Issue 604: namespace quota accounting through file aliases

## Scope and evidence

The existing census sums every non-directory namespace entry, including symlink
storage. Preserve that logical domain; do not redefine it as unique physical
storage, allocated blocks, or process memory. Content growth can affect several
hard-linked entries, whereas the current admission subtracts and replaces only
one entry. The issue's one-byte/two-link/100-byte write is a bounded reproduction.

## Implementation and validation

- Add in-memory regressions before changing production. Cover write, append,
  append flags, truncate, copy and incremental streams; preserve partial stream
  effects, symlink referents, exact boundaries and queue serialization.
- Census file aliases before content changes. Complete identity tuples in one
  scope or an explicit provider comparison can establish sameness/distinctness.
  Complete tuples in different scopes denote distinct backing universes;
  incomplete tuples and unrecognized tokens do not establish distinctness.
- Conservatively reserve positive growth for unresolved possible aliases;
  preserve the existing single-entry shrink credit rather than granting a
  credit for every read alias. Overlay copy-up can mutate only one such view.
  Do not treat physical link count as the
  number of entries visible through a composed namespace.
- Preserve provider contracts, cancellation, normal filesystem errors and the
  existing capability wrapper. Do not add native probes, dependencies, README
  edits, byte-limit raises, post-write-only checks, or rollback guesses.
- Run focused RED/GREEN tests, then maintained build/workspace tests and strict
  consumers after all shared-worktree workers freeze. Close only after verified
  remote-main delivery, then monitor publication separately.

This wrapper serializes its own admitted mutations, not external backend writers.
Conservative admission for unavailable identity can reject a write whose actual
namespace growth would fit. That is not a claim of exact identity or physical
storage accounting.

## September 4, 2026 validation

- Original new tests: 12 expected RED failures and two passing controls; the
  one-byte/two-hard-link reproduction specifically escaped admission before the
  production fix. Initial alias-aware production passed 28 combined quota tests.
- Contract review corrected an initial fixture that assigned different complete
  scopes to the same entry, which violates the publisher contract. The valid
  replacement omits an inode component. Distinct complete scopes are now tested
  through independent mounted stores without optional comparison support.
- Two additional RED controls exposed unnecessary dependence on optional
  comparison for complete identities and acceptance of invalid comparison
  literals. Both were repaired without changing identity contracts.
- Independent review and root independently found unsafe multiplied shrink
  credits for copy-up views attached below existing usage. A bounded overlay
  regression failed, then passed after preserving single-entry shrink credits.
- Independent review also found callback-returned null/undefined were being
  converted to unknown. Two RED controls now require EIO; absence of the callback
  remains supported. All 38 combined quota tests pass, including four falsey
  cancellation reasons, exact capacities, partial stream effects, and repeated
  mounts whose backing file has physical link count one.
- Owned source and new tests pass focused strict no-emit types. An additional
  check including unchanged `tests/quota.test.ts` reports its existing line-46
  literal-capability narrowing error. Its raw log is preserved; no unrelated
  assertion or source was changed and a clean all-test compiler run is not claimed.
- A separate existing missing-file creation gap through duplicate mounts was
  confirmed and documented, not folded into this existing-file growth fix.

Private logs under `/home/kjopek/kamilio-validation-569-575.RoFXyZ` preserve
`604-red.log`, `604-green.log`, `604-contract-red.log`,
`604-contract-red-corrected.log`, `604-contract-green.log`, `604-copy-up-red.log`,
`604-copy-up-green.log`, `604-nullish-red.log`, `604-nullish-green.log`,
`604-focused-types.log`, `604-owned-types.log`, and independent review captures.
No broad gate, build, push, or release has yet qualified this candidate.

Final package-scoped runtime validation passes all 1,144 SafeFS tests across 50
files (`604-safe-fs-cohort.log`). The changed source and new test pass the final
focused strict no-emit check (`604-final-owned-types.log`). Independent review
rechecks five bounded copy-up/nullish-comparison groups against unchanged source
SHA-256 `8564f7b3010a753ca3e6562a585de864907278198c7badd2985c0805ca9cbd82`;
both introduced findings are resolved, with exact sufficient-allowance controls
and zero writes on rejection (`604-independent-fixed-confirmation.log`).
