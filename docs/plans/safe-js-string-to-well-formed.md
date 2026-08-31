# String.prototype.toWellFormed

## Scope

Add the zero-argument companion to `isWellFormed`. Replace each lone UTF-16
surrogate with U+FFFD, preserve valid pairs and other code units, and preserve
UTF-16 length. Extra arguments are evaluated normally but ignored by the method.
Do not change existing method or borrowed-receiver semantics.

Owned paths:

- `packages/safe-js/src/interp/methods/string.ts`
- `packages/safe-js/src/interp/methods/string-to-well-formed.test.ts`
- `docs/plans/safe-js-string-to-well-formed.md`

README updates belong to Mendel; independent review belongs to a separate author.
The existing independent `isWellFormed` test explicitly asserting that
`toWellFormed` is absent needs its owner's update, not a change in this scope.

## Implementation and validation

1. Run the new in-memory tests before implementation to establish genuine RED.
2. Register zero-arity metadata and handle this method before argument rejection.
   Preflight the unchanged output length using `budget.allocateString(value)`.
   Scan UTF-16 once, copying disjoint spans and replacing only lone surrogates;
   output never exceeds input length. Validate the result with `allocateString`.
   Preserve existing intrinsic step/data accounting and public execution limits.
3. Run focused new and neighboring tests on installed Node 18 and Node 22;
   verify formatting and whitespace only for owned files. No install, full build,
   commit, push, home sync, generated audit artifacts, or subagents.

Primary semantics: ECMA-262, String.prototype.toWellFormed, consulted during the
read-only phase:
`https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.towellformed`.
Use interpreter-owned code-unit scanning, not native `toWellFormed`, regular
expressions, eval, or new host capabilities. Fixed fixtures remain authoritative
on Node 18; compare with the native method when available on Node 22.

## Results

- Fast-forward-only pull completed; publisher remains at
  `f9d1652b85a03d3d69c0a9b59374e8bc7abd091e`. Unrelated files preserved.
- RED before production edits: 41 failed, 3 passed in the new 44-test file on
  Node 22.22.2 (450 ms) and Node 18.18.2 (475 ms). Failures demonstrate absent
  method registration, repair behavior, metadata, and allocation checks; the
  three passing tests exercise existing public budget rejection.
- GREEN after implementation: all 44 new tests passed on Node 22.22.2 (445 ms)
  and Node 18.18.2 (502 ms).
- Focused regression run: 108 tests across the new file, `string.test.ts`,
  `string-is-well-formed.test.ts`, `number.test.ts`, and
  `run.string-coercion.test.ts` passed on Node 22.22.2 (933 ms) and Node 18.18.2
  (1.03 seconds).
- Existing independent `isWellFormed` suite: 12 passed, 1 failed on each runtime.
  The sole failure is the obsolete unsupported-method assertion at
  `string-is-well-formed.independent.test.ts:159` (expects `undefined`, receives
  `function`). Its owner must update it before integration; it was not edited,
  skipped, or weakened here. This run is regression checking, not independent
  review of the new feature.
- Owned TypeScript files pass ESLint; all three owned files pass Prettier checks;
  `git diff --check` passes. No full build, commit, or push was run.

## Subsequent build and CLI validation

- After root authorization, `TERM=xterm-256color SKIP_SYNC_SKILLS=1 npm run build`
  passed: 68 workspace tasks, both schema generators, root TypeScript, binary
  wrappers, and bundle. No production edits were needed.
- All 24 existing checks from `scripts/smoke-test.ts` passed on Node 22.22.2 with
  the same environment. To honor existing-dependencies-only and avoid global
  installation, invoked the unchanged check functions in memory against an
  offline `npm pack --ignore-scripts --offline` artifact, using existing
  dependencies and local executable links rather than the install/cleanup
  wrapper. This does not validate a fresh dependency installation.
- The initial raw-workspace smoke attempt hit missing executable permission and
  package-layout assertions. Staging the actual tarball and applying normal bin
  executable permissions resolved those setup failures without source changes.
- Actual `packages/safe-js/dist/cli.js` examples exited 0 with empty stderr on
  Node 18.18.2 and 22.22.2; complete stdout matched identical fixed expectations.
  Cases cover empty/ASCII strings, lone high/low surrogates, reversed pairs,
  mixed text, preserved pair code units, unchanged length, well-formedness,
  idempotence, and zero arity.
- Standard `npm run screenshot` succeeded. Visually inspected both
  `out/string-to-well-formed/node-22-standard.png` and the combined runtime
  capture `out/string-to-well-formed/examples.png`, rendered with the existing
  terminal-png CLI: readable output, visible replacement characters, no clipping.
- Removed only this task's temporary package, archive, smoke scripts, and bin
  links; retained small example/transcript/screenshot artifacts under
  `out/string-to-well-formed`. No install, home-skill sync, commit, or push.
- Lorentz owns the old unsupported assertion update and new independent tests;
  Mendel owns README updates. The earlier independent-suite failure record above
  predates those separately owned changes and is not a new review verdict.

## Publication coordination

- Root relayed independent approval: 1,497 tests across 18 files passed on each
  of Node 18 and Node 22. All 13 existing `isWellFormed` protections pass after
  updating only the obsolete companion-method absence assertion.
- README updates are reviewed. Root approved the exact six-file companion batch
  with normal hooks; push waits for the preceding release's successful workflows
  and matching npm publication metadata.
