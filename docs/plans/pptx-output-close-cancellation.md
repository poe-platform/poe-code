# pptx output close cancellation

Scope: one byte-transport correction in `packages/pptx`, not execution of the
whole pipeline. Owned files are this plan, `packages/pptx/src/bytes.ts` and
`packages/pptx/src/bytes.test.ts`. Root and package policies were inspected;
no safe-bash code is changed, so its scoped worker delegation is not invoked.

## Reproduction and change

The format specification section 8, shared CLI sections 6–8 and shared SDK
I/O contract require cancellation and transport errors to remain observable.
`writeBinary` previously checked cancellation after writes but returned success
when cancellation arrived during a close that subsequently resolved.

Add original memfs cases first: empty/nonempty output crossed with resolving/
rejecting deferred close. The two resolving-close cases failed before the fix;
the rejecting-close cases already preserved cancellation precedence. Add an
independent stdout-prefix failure case asserting delivered bytes, input ownership,
unchanged virtual files, bounded public errors and no close after a failed write.
The fix checks cancellation after close settles. It does not interrupt an
uncooperative host or undo bytes already delivered to a stream.

## Agent verification procedure and evidence

1. Run the byte tests before editing implementation: 2 failed, 24 passed.
2. Apply the cancellation check and run the maintained pptx workspace unit route:
   all 415 cases pass across 12 files.
3. Run workspace lint, including source and test type checks. The first run
   rejected a test-only ES2024 Promise helper under the existing ES2022 target;
   replace it with ordinary deferred Promises without changing compiler settings.
4. Build the selected workspace closure with
   `npm run build:workspaces -- --workspace=pptx`.
5. Exercise built public imports `pptx/bytes` and `pptx` with a recording sink:
   cancel during async close, assert the exported error type, cancellation code,
   publication phase, exact delivered bytes and unchanged input. Passed.
6. Rerun workspace lint/tests after the test compatibility correction; check
   scoped formatting and staged whitespace, inspect the exact staged diff, then
   commit only the three owned paths on main. Do not push or release.

No CLI route exposes this helper yet; paired command, exit-status and screenshot
evidence remains pending adapter implementation. No visual CLI behavior changes.
No claim of staging validation, conditional file publication, stale-write
protection, force/in-place semantics or multi-file atomicity is made by this
transport correction. Those remain required future operation/adapter work.

## Accounting and provenance

Consulted both upstream audits, both upstream inventories, the case ledger,
language/security mappings and corpus manifest. Verified every one of the 2,700
unit and 973 expanded BDD inventory pointers, source identities and locations
against the existing ledger, and all 2,407 API inventory identities against its
API obligations. No source case identity mentions cancellation or stdout; these
five original cases supplement the sandbox transport contract rather than
claiming reference-case parity. Existing ledger dispositions remain unchanged;
no inherited or underscore-prefixed public API is excluded.

J06/J08 capability and error mappings apply: always-async byte output through an
explicit sink, bounded neutral errors, cancellation taking precedence when the
signal is aborted. No new public signature or documentation-drift resolution is
needed. Historical research audit status is not a claim that current codecs have
no implementation, nor proof that the full presentation model exists.

The corpus manifest was read as metadata only. No fixture was downloaded,
modified, shipped or cleaned up. Tests use tiny original bytes and memfs with
literal independent expected values. No reference implementation or assets were
copied; existing standalone legal notices remain untouched. No README edits,
runtime host I/O, native process fallback or product networking was introduced.
