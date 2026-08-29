# Independent shadowed-array checkpoint review

## Scope

August 29, 2026. Direct delegated independent reviewer. Validate the frozen
two-file follow-up on main `64a1d91b5de0049b390efa7156be2fb41ef7a0d0` plus the
exact twelve-file queued OBJ002 prerequisite. NUM001 is already upstream.
Do not change production, inherited assertions, other clones, Git, README, or
home files. No original audit payload is needed. Run only bounded benign
functional controls with no guest I/O or LLM requests.

## Validation procedure

1. Verify the supplied author manifest, every captured artifact, the twelve
   prerequisite postimages, five exact base preimages, and absent new identities.
2. Review descriptor-based graph traversal and both array representations.
   Check actual own method shadows, sparse presence, metadata, aliases, cycles,
   and retained source-function metadata rather than only successful dumping.
3. Run unchanged owned tests against exact base preimages using an in-memory
   module transform; do not edit production. Rerun against the queued fix.
4. Compare the exact previously captured benign sources with native anchors,
   completed dump, restore, and replay. Retain full outputs and expected RED.
5. Run focused, package/full, build-before-types, configured and explicit test
   types, lint, and strict publication whitespace/format gates. Keep command
   caches clone-local and preserve historical cache/format qualifications.
6. Freeze only the two-file supplement plus this report. Keep twelve OBJ002
   prerequisites and current-main identities separate. Record AR/PPR ordering
   without staging them; later actual composite publisher gates are required.

## Decision

**READY for the three-file supplement, conditional on the exact queued OBJ002
prerequisite.** Independent validation confirms that OBJ002 already eliminates the
finding without another production change. This is not publication/release closure
and does not certify AR/PPR or any future actual-main composite. Repository-wide
formatting remains qualified below, not globally green.

## Frozen identities and prerequisite ordering

Author manifest SHA-256:
`a715568967f07e80f2e79e3a1ab6951b823430ce080b8f1f7c61e42e269dc6ec`.
All 89 captured artifacts, both author working files, and all twelve prerequisite
working files independently match their recorded bytes and SHA-256. The captured
approved OBJ002 manifest is also independently verified as
`e64ac49153e4e0d951ee8439cd2c1ffd4090bf0b3d085ec559eee5db44f9b120`.
The original finding manifest is the exact frozen
`b0180aa4b983af140d713e51a17360aec6dc501f9928cb9fd1be9832b9dcffcf`.
Only copies in this closed clone are read; no original audit payload or other
clone is read or written.

All five existing prerequisite preimages match both pinned main and the approved
post-NUM preimages:

- `packages/safejs/src/graph-depth.ts`: 3383 bytes;
  `36b5f0e3a978f73583d086fd3df38303ce7694947c1c55028b9bfb3831391346`.
- `packages/safejs/src/snapshot/serialize.ts`: 16258 bytes;
  `34c74ba5f75a9ad8a29f1adc034820c37e2b3778b258660d24de6c54a520f7b6`.
- `packages/safejs/src/snapshot/dump-format.ts`: 8149 bytes;
  `c9b10ad6c160a5b20cf52c87e22cc5220de0025fdff002c88e55e6f6ba55ae31`.
- `packages/safejs/src/snapshot/restore.ts`: 27010 bytes;
  `e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a`.
- `packages/safejs/src/snapshot/validation.ts`: 29337 bytes;
  `a33dba04490252763a870059a095cb1b27efce6ec913a6735676d4509f90b1c2`.

Seven prerequisite identities are absent at pinned main. The twelve OBJ002 files
are six production files, three tests, and three plans. The sixth production path,
`packages/safejs/src/snapshot/arrays.ts`, is new. NUM001 ancestor
`32caeaddbac72bccea1cb3fd0a07fb293a1bee71` is verified by Git ancestry and is
not a new publication prerequisite delta.

Only these three supplemental paths belong to this review's publication delta:

- `packages/safejs/src/snapshot/shadowed-array-methods.test.ts`
- `docs/plans/safejs-shadowed-array-method-serialization.md`
- `docs/plans/safejs-validate-shadowed-array-checkpoint.md`

All three are absent at pinned main and absent from the twelve-file OBJ002
prerequisite. No new production code is necessary or supplied. If coordinated into
one publication, OBJ002 twelve plus supplement three is fifteen unique paths.

## Independent failure and coverage review

The exact minimal benign source remains
`const values = [1]; values.map = 0; return 1;`. Main runs it successfully
but its completed dump throws `TypeError: value.map is not a function`.
A read-only Vite module loader supplies the five exact main preimages in memory;
it verifies all five modules loaded. No working production file is reverted.
The unchanged 23-test file independently produces **22 failures and one passing
dense control**. Removing the loader and using the exact queued OBJ002 files gives
**23 passing tests**; together with all three prerequisite tests, **67 pass**.
The test and prerequisite assertions are unchanged throughout.

The production mechanism is already in OBJ002:

- `graph-depth.ts` reads enumerable data descriptors rather than calling an
  array's shadowable `map` member. Sparse holes are not visited as entries.
- Both serializers use the shared array helper. Dense plain arrays retain the
  legacy items form; holes or named properties select length plus own entries.
- Named map/forEach/entries/values/keys/slice shadows remain actual own entries;
  zero, null, and present undefined are neither invoked nor discarded.
- Restoration allocates length and registers heap identity before restoring
  entries. This preserves sparse presence, named metadata/raw, aliases, and cycles.
- Source-function metadata and binding support are not changed. Existing NUM/OBJ
  cross-fix tests still verify arity and bind after both serialization formats.

Seven unchanged benign sources are extracted from approved captures and the
frozen test, with native anchors executed before the current runtime comparisons.
They are the dense control, exact minimal finding, four original captured shadows,
and the test's sparse source-method/metadata composition. All seven current values
and all seven completed-replay values equal their complete native data: **14
comparisons**. Full sources, native values, current/replay values, completed dumps,
and retained heap graphs are saved, not only success counters. The six shadow
cases explicitly retain an own map entry in the completed snapshot; the composite
also asserts exact keys, length, undefined presence, metadata/raw aliases,
self-cycle, array alias, and serialized `calls: 0`.

The frozen test has sixteen direct graph roundtrips: eight primitive method-name
shadows through each of interpreter and public dump formats. Native structured
clone shape and explicit assertions check exact keys, presence, detached arrays,
length, metadata, aliases, and cycles. An additional bounded independent control
puts a source closure in the named map property and restores both formats. It
checks actual own closure retention, native/default/rest arity 1, bound arity 0,
no invocation, holes, raw metadata, and all aliases. Both complete encoded graphs
are captured. No extra test file is needed; the author's proper-package regression
file remains the only new test publishable.

Completed public dumps represent ordinary source functions with their existing
replay marker; unchanged-source replay reconstructs execution. The direct
interpreter-format control separately exercises AST-backed restored closures.
This review does not claim opaque host-callable reconstruction from a marker.

## Executed commands and retained qualifications

Every command receipt is under
`out/safejs-remediation/shadowed-array-independent-validation/commands` and
records argv, cwd, selected environment, timestamps, status, full stdout and stderr.
Commands run with TERM unset, clone-local npm/XDG caches, snapshot playback with
cache misses as errors, and skill synchronization disabled.

- Focused four-file Vitest gate: **67 passed**, no skips.
- Unfiltered SafeJS gate: **6,518 passed / 39 skipped**, 173 passing files and one
  skipped file.
- Forced configured full gate:
  `env -u TERM node_modules/.bin/turbo run test:unit --concurrency=1 --force`
  with the recorded clone-local cache/playback environment: **23,903 passed /
  41 skipped**, 963 passing files and three skipped files. One uncached successful
  task, 3m25.095s. No extra file/name exclusions; this is the configured full unit
  suite, not a selected gate or E2E certification.
- Forced `npm run build`: **67 successful tasks, zero cached**, followed by
  root code generation, types, wrappers, and bundle. No build overlaps runtime
  gates or typechecks.
- Package `tsc -p packages/safejs/tsconfig.json --noEmit` and root
  `npm run lint:types`: pass after build.
- Package-configured TypeScript program plus all four exact test roots: zero
  diagnostics. Strict explicit ES2022/NodeNext four-test-root command: pass.
- Configured ESLint, workflow lint, and all seventeen package-lint rules: pass.
- All fifteen prerequisite/supplement paths pass Prettier; final report and
  publication whitespace are checked again immediately before freeze.
- Repository format remains exit 1 with **1,434 warnings**, exactly the same
  ordered warning paths as the author capture. None is a prerequisite, supplement,
  or tracked changed path. No unrelated file is formatted or this failure waived.

The first independent native-object deepStrictEqual diagnostic rejected the
intentional null-prototype SandboxObject versus native Object.prototype; this
failed receipt is retained. `interpreter.ts` explicitly creates null-prototype
object literals. The corrected data comparison recursively checks exact ordered
keys, array/object kind, lengths, every value, and strict scalar identity without
coercion, sorting, omissions, or tolerance. Only host/sandbox prototype identity is
not compared. No package assertion changed. The corrected full-data run passes.

The tool recorder initially lacked a global process binding, then a persistent
kernel timeout interrupted collection of one background build. That build is not
credited. Its own process was allowed to terminate before the fully recorded
forced-build rerun. Both observations are retained. Historical author initial
npm installation/build commands may have written ambient home cache/logs; no
zero-home-cache-write claim is made and no home cleanup attempted.

## Scope disposition and downstream coordination

This was a real benign defect on main, not an intentional documented own-map
restriction. The independent results now show the already queued OBJ002 fix covers
it; the previous pending-repair handoff is retained unchanged as history. No new
production fix or duplicate author investigation is required. Original-47
membership remains unconfirmed, with no additional root-cause count or ledger ID
invented. CTX/Anscombe's matching qualification should be updated only with this
specific coverage and eventual publication evidence, not silently removed.

The captured AR/PPR overlap evidence is recorded without staging either candidate:
OBJ002 versus AR has no production-path overlap; OBJ002 versus PPR shares exactly
`packages/safejs/src/snapshot/dump-format.ts`. PPR's ordered preimage equals
OBJ002's postimage
`ab30f29e1cab5761e189b5cc114c463a3d7b221fe72ad1a91cda754e6d2cc1af`.
AR and PPR share `packages/safejs/src/run.ts`, where PPR's ordered preimage equals
AR's captured postimage
`124d7f1f4ae72650ae0387e28f7f7adcd05f1027dfa3d3c833764babf8ce7662`.
OBJ002's `snapshot/restore.ts` and PPR's top-level `restore.ts` are distinct.
The captured provisional PPR broad-red status is not certified or relabeled here.

Supported scope is enumerable own data, tested shadows, source replay, sparse
presence/length, named metadata/raw, and aliases/cycles. No new guarantee is made
for symbols, nonenumerables, accessor or descriptor-flag preservation, opaque host
functions, old-reader compatibility, or an AR/PPR/full-queue combination.
Future publisher actual-main preimage checks and a fresh full composite gate remain
mandatory. Finding coverage in this frozen candidate is not a claim of release or
publication closure.
