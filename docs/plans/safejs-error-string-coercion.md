# SafeJS branded-error String coercion

## Scope and contract disposition

Author lane in `/Users/kjopek/Workspace/poe-code-safejs-error-coercion-author`,
freshly cloned and pulled main at `e6b70989225781249f2cf395b927186894fad7c2`.
No commit, push, README/master-ledger/SKILL edits, live skill synchronization,
original archive reads, or security campaign. Independent validation follows
the frozen author candidate; author TDD does not replace it.

Immutable starting evidence is the independent README draft manifest
`2a8e48a70e491ec12e6a5affa49719de127cfa26d30bd0325b522a5b01e46870`, specifically
`findings/error-coercion-observation.json`, SHA-256
`5b296c7e1ee5cb098ed1e37824e5442a543b7c9e0907e1dac010244555847c0b`.
Its original source and observations are retained unchanged. That review used
14 bounded snippets and 28 native/source observations; it did not establish a
runtime defect disposition or claim an accepted limitation.

The existing README lists `String` value coercion at line 153 and callable and
constructable error factories at line 158. Neither entry excludes their direct
composition. The reproduced `String(new TypeError(...))` mismatch is therefore
a supported-operation composition defect, not authorization for general object
coercion, guest prototype hooks, new error classes, or a wider String feature.

Error factories construct plain sandbox records in `createSubsetErrorValue` and
record their semantic identity in the existing `sandboxErrorTypes` WeakMap.
The String global currently calls native `String` on that plain record, which
sees Object's native conversion rather than Error's conversion. No error brand
is consulted. That explains the preserved `[object Object]` result without
changing the thrown value, catch behavior, or diagnostic channels.

The intended production edit is limited to the String factory in
`packages/safejs/src/interp/globals/object-array.ts`, with an import of the
existing error-brand metadata. This shared file is reported to the coordinator
before editing. No `values.ts`, `methods/string.ts`, interpreter coercion,
snapshot format, or prototype implementation changes are planned. Nash's
localeCompare and Boyle's Float32Array work must be integrated in their own
ordered lanes with actual preimage checks.

## Separately observed ordinary-object difference

The initial author test run records 24 failures. Twenty-three concern the scoped
branded-error conversion; the remaining broad parity control exposed another
pre-existing difference: native `String({})` is `[object Object]`, whereas SafeJS
rejects with `TypeError: Cannot convert object to primitive value`. Guest object
literals use null-prototype records, and native String cannot convert those
without a primitive-conversion method. This is not claimed to be an accepted
limitation or fixed by this candidate. It is reported separately to the root.

The original 24-failure log is preserved. The control is split before any
production edit into primitive/array parity, unbranded error-shaped-record
preservation, and an explicit assertion of the still-unresolved guest-object
failure. This makes the scope visible rather than weakening or normalizing the
original TypeError fixture. No generic object-coercion feature is added here.

## Author validation procedure

1. Preserve the exact observed source and hard expected native object in a new
   regression test, without normalizing the mismatch.
2. Before production edits, run the test against freshly pulled main and retain
   RED. Cover all six documented error factories, call/new construction, empty
   messages, current primitive name/message fields, and a caught intrinsic error.
3. Preserve unbranded ordinary-object and primitive coercion. Use existing
   in-memory copy/replay/snapshot machinery to verify the persisted error brand;
   introduce no filesystem or external-I/O unit-test behavior.
4. Apply only a branded-error conversion branch in the String factory, retaining
   the existing allocation budget. Rerun the exact regression to GREEN.
5. Run relevant existing globals, errors, snapshots, and SafeJS suites, source
   and new-test type checks, configured formatting, lint, and strict whitespace.
   Retain every observed gate failure with its disposition instead of hiding it.
6. Freeze exact production preimage/postimage, test/plan additions, minimal patch,
   commands, and RED/GREEN evidence for a different agent's independent review.

## Final author disposition

The user now explicitly authorizes JavaScript compatibility wherever it can
preserve sandbox safety. No earlier unsupported label is used as an authorization
barrier. This candidate stays focused on the observed built-in Error/String
composition; generic object conversion and guest-defined conversion hooks remain
separate compatibility work, not accepted limitations.

The production delta is one file, ten added lines and one removed line: consult
the existing error brand and call the native Error string intrinsic only for a
branded value without an own `toString`. Keep the original String fallback for
every other value. No prototype, brand inference from fields, guest coercion hook,
new callable method, snapshot format, or budget bypass is introduced. An own
`toString` guard prevents this focused fix from silently bypassing an existing
shadowed property or pretending to execute a guest-defined conversion function.

- Original author RED: 24 failed, including the separately reported ordinary
  object difference. Scoped RED before production edits: 23 failed / three
  preservation controls passed. Initial scoped GREEN: 26 passed.
- Additional own-`toString` controls first fail against the initial candidate:
  four failed / 26 passed. The guard then produces final GREEN: **30 passed**.
  Those controls preserve the fallback only; they do not claim native custom-hook
  compatibility. The original fixture and its four observation fields remain
  exact, with no normalization of the error string.
- Fresh native/source observation returns `TypeError: example failure` in both
  executions. The sandbox's null-prototype returned record and native record's
  Object prototype are explicitly recorded as different; full prototype parity
  is not inferred from equality of the original four data fields.
- Relevant existing tests: 680 passed before the guard; the final full SafeJS
  suite covers the guarded source and passes **8,594 tests, 39 skipped, 214 files
  passed, one skipped**. The first package run had one setup failure because the
  fresh dependency installation had no built workspace exports. Its eight bundle
  resolution errors remain captured. Building the declared workspaces resolves
  that environment prerequisite without a source workaround or exclusion.
- Final unchanged-default root: **25,971 passed, 41 skipped; 1,005 files passed,
  three skipped**. No timeout, worker, or exclusion override is used.
- Configured root build, root and SafeJS source types, strict new-test-root types,
  root ESLint, all 17 package rules, configured formatting, and `git diff --check`
  pass. Initial new-test typing diagnostics and formatting failure are retained;
  discriminant guards and a checked three-field constructed-error type resolve
  all six new diagnostics. No new test diagnostics remain and no type gate is
  being qualified as a pass despite failure.
- The initial forced dependency build passes 67/67 tasks with zero cache hits.
  That precedes the own-property guard; it is dependency-readiness evidence, not
  a claimed final-source forced build. The subsequent configured root build and
  all final execution/type gates use the guarded final source.

Exact shared-file identities for ordered integration:

- `packages/safejs/src/interp/globals/object-array.ts` preimage:
  `b5d296fb4f0267cae87b13724f3e2894f07cebc50616f3686720b4303ebd190c`.
- Its final postimage:
  `4bf66fa629da1ee5b171bb8b5c5815f1d5672c90be02eaffba5850c6d7b1ed5c`.
- The other two publication paths are this plan and
  `packages/safejs/src/interp/globals/error-string-coercion.test.ts`, both absent
  at the pinned base. No changes are made to `values.ts`, `methods/string.ts`,
  README, master ledger, SKILL files, or another clone.

Freeze exact preimages/postimages, original immutable evidence, all failed and
successful author receipts, and the minimal patch. The candidate is ready for
a different agent's independent validation, not self-approved publication.
No commit or push occurs in this lane. The ordinary-object mismatch and custom
guest-hook compatibility are explicitly open follow-up work under the user's
broader authorization; this candidate does not close the overall compatibility
goal or classify those behaviors as acceptable.
