# Version4 author handoff — A10 remains HOLD

Source sealed before execution:
`b0ee7234b915ce1ac45aa6db6d087dc3430ea21f`.
Driver JSON SHA256:
`4624ffcbafa470f21c6d122adc3e75a1c20744f8b75d80839f4e69eebcf3d0a1`.
Product remains `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, expected
package `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
No product, fixture, native profile, cleanup manifest or prior evidence changed.

## Actual outcomes

Four predeclared bounded author groups pass. These include inert imports and
release refusal, exact shared phase wiring, two real tiny-project compiler
invocations detecting a duplicate build, and contained-link extraction under
the original sandbox policy shape. The target still cannot execute ps or write
outside its allowed directory. The trusted outer read-only observer validates
the owned requester and Git PID/group/birth, rejects foreign PID/handle claims,
and observes the actual Git child closed with no surviving group. No forced
termination occurred. This is author evidence awaiting Dirac, not independent
acceptance or four extra passes added to the old22 groups.

Exactly one actual review-entry attempt was launched. It exits1 before source
extraction/build/type phases: **zero candidate production builds, zero typing
phases executed**. The outer supervisor closes naturally, reports clean resource
settlement and zero signals/survivors, but the result remains REVIEW_ONLY_HOLD.
No second attempt or admission-policy change is hidden in this packet.

## Concrete blocking input

The existing `transport.mjs:18` rejects every backslash in a candidate path.
The exact frozen profile contains these two ordinary POSIX filenames:

- `tests/commands/filesystem-inspection-stress/tree/evidence/final-436bda3/harness/derived/native-fixtures/controls/back\slash`
- `tests/commands/filesystem-inspection-stress/tree/sealed/native-fixtures/controls/back\slash`

Both are mode100644, one byte, blob
`63d8dbd40c23542e740659a7168a0ce3138ea748`; neither is absolute and POSIX
normalization leaves each unchanged. This predicate is unchanged from2713.
The new entrypoint exposed a pre-existing profile/transport mismatch; it is
not a typecheck failure, native prerequisite loss or product build failure.

Minimal proposed follow-up: on the already pinned POSIX/macOS driver profile,
treat backslash as a literal filename byte. Retain NUL, absolute/dotdot/.git,
symlink-ancestor and escaping-target checks plus exact Git hash/mode/byte bounds.
Add exact two-file extraction and traversal/symlink negatives. Do not change
candidate inputs or use a broad filename rewrite. This policy correction and a
new bounded author attempt require an explicit successor; neither happened here.

## Review routing

- `build-types.mjs` and `phase-runner.mjs` are the actual shared implementation
  called by full `execute.mjs` and the new review-only entrypoint, not copied
  production-build logic or a counter stub. Actual candidate execution remains
  unproved until the concrete input refusal is resolved.
- `review-build-types.mjs` requires explicit `--review-build-types`; imports stay
  inert, the outer supervisor enforces deadlines and cleanup, and no review
  result can qualify as the full gate. The full `--run` release guard is intact.
- `process-observer.mjs` is a read-only IPC service bound to the owned target;
  `transport.mjs` waits for child registration before sending Git data. Its
  optional observer is not an automatic EPERM bypass or permission relaxation.
- `FREEZE.json`, `BASE-DRIVER.json` and `evidence/REPORT.json` preserve previous
  bindings, new source/control hashes and every raw outcome. Old19/3 and21/1
  results, optional transport failure and original A10 HOLD remain historical.
  No c109 pack was rebuilt, no full gate ran, and no combined release is claimed.
