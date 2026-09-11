# Optional release integration candidate

This is an unfinished integration candidate on `main` in
`/tmp/poe-optional-integration-aHlAip`. Nothing in this candidate has been pushed
or published, and the merge must not be committed as release-ready while
validation failures remain.

## Inputs and delivery boundary

- Original committed work: `57f68f67e3f7f92f9a1cb78bb58cd47b407cf2c3`.
- Remote main merged into that history: `4af337d98df423642869a313eefa74e09a87c53e`.
- Common ancestor: `25b940bd7293e3725cbb25f6ae3f776c0147feb4`.
- Later original fixture corrections `47c64b1f8` and `99a789109` are applied to
  the candidate, with current-main readonly capabilities retained.
- Later corrections `01a83cf9e`, `e3e237b2a`, `fb12831c7` and `f7c6d40f0`
  are adapted to the merged archive, descriptor, fixture and CI contracts.
- The SafeJS execution-lifetime correction from `edb7ce8c2` is applied. Its
  separate release belongs to the root delivery clone, not this candidate.
- Native array-key reproduction correction `525ee05e9` authenticates the
  caller-supplied Bash binary/version without requiring the historical machine's
  binary digest. Captured evidence remains unchanged.
- Native jobs reproduction correction `ceacf3910` applies the same supplied
  binary/version authentication while retaining historical capture hashes.
- Root delivered SafeJS main `edb7ce8c2`; after this initial merge commit, both
  that delivered ancestry and original main `ceacf3910` must be merged before
  delivery so the original checkout can fast-forward without losing commits.

The source checkout and root SafeJS delivery clone remain untouched by this
integration. Both histories remain available. All source conflict markers are
resolved; resolutions are staged by explicit path. This is not validation.

## Packaging milestone

The four focused packaging suites pass: **221 tests** covering optional build,
optional lifecycle, safe-library packaging and standalone metadata. Log:
`/tmp/poe-optional-integration-package-milestone.log`.

The tests first exposed two actual incompatibilities:

- The optional builder recognized only flat export conditions. Current main
  uses nested declaration conditions. The builder now selects the Node import
  and declaration/default paths while retaining the existing peer-boundary and
  runtime-identity checks.
- A directory-wide `commands/yq` exclusion removed current main's restricted
  YAML/TOML implementation. Exclusions now name only the eight Mike adapter
  source families and their emitted runtime/declaration/map files:
  `arguments`, `evaluate`, `expression`, `inplace`, `mike`, `native-encoder`,
  `native-work`, `nodes`. The restricted `index`, `accounting`, `encoder`,
  `errors`, `parser`, `toml`, and shared structured query implementation remain
  in the default build/package.

The fixture graph now represents nested export conditions and uses `yq/mike`
for the optional YAML fixture; it no longer mislabels the default `yq/index`
module as optional. Assertion coverage and rejection cases remain enabled.

Current main's `cmp.ts`, `shuf.ts`, and `truncate.ts` are separate implementations
from the optional `cmp/`, `shuf/`, and `truncate/` directories. Their names
overlap in the registry, but their implementations and APIs are not silently
collapsed. Optional `dd/`, `install/`, and `yes/` directories are also retained.
Registering an overlapping optional command must keep normal duplicate rejection
unless the caller explicitly requests `replace: true`.

Installed optional runtime fixtures now use the independently maintained exact
current-main inventory and explicit variant replacement for the three collisions.
They retain duplicate-rejection checks and optional factory-exclusion checks.
Browser fixtures use current-main conditional exports, with no obsolete browser
subpath compatibility alias. Installed runtime has not passed on this candidate.
No README content has been added.

## SafeFS milestone

The delegated SafeFS reconciliation preserves both canonical descriptors and
current-main retained handles, bounded memory accounting and cleanup. The
selected workspace build and typecheck pass. Its post-build full run passed
4,176 tests in 108 files; two cross-package files could not transform at that
stage. A later focused run passed 294 tests after the final device capability
correction. Logs:

- `/tmp/poe-safefs-merged-validation.log`
- `/tmp/poe-safefs-final-focused.log`
- `/tmp/poe-safefs-device-final.log`

New descriptor/ledger tests validate admission before side effects, scoped
descriptor work/cancellation, and live-byte accounting across retained and
canonical handles. `ioBlockSize` and `preferredIoBlockSize` remain distinct
metadata with compatible bridge handling. Neither legacy `maxBytes` nor the
retained allocation ledger is dropped.

## Remaining integration work

The parser now carries shared budgets, source values and captured extension
syntax. Input supports canonical descriptors and retained handles without
inventing unsupported seek capabilities. Runtime resolves associative arrays,
brace expansion and current-main cleanup alongside optional extensions, raw
values and descriptor ownership. These combined paths still require runtime
validation; source compilation is not semantic compatibility evidence.

Default null-device wrapping remains. DeviceFileSystem forwards canonical open
for ordinary backing paths, preserves descriptor identity, and refuses it for
virtual null paths with truthful capabilities; retained stream APIs remain.

The first normal full build passed, including all maintained workspace tasks,
playground site and root bundle suffix. The playground adapter now admits the
exact assigned root-state AST form while rejecting binding drift; six adapter
tests and its TypeScript check pass. Log:
`/tmp/poe-optional-integration-full-build.log`.

Subsequent runtime corrections require refreshed artifacts and full validation.
The second normal full build passed and is recorded in
`/tmp/poe-optional-integration-full-build-2.log`.

The first maintained full `npm test` ran with the authenticated GNU Bash
5.2.37 oracle in `/tmp/poe-optional-integration-full-test.log`. Its shared phase
completed with 937 passed files, two failed files, and two skipped files;
23,333 tests passed, two failed, and two skipped. The two failures were the
packed browser `cmp` regression and ownership expectation described below.
The runner correctly stopped before subsequent workspace phases.
The optional workspace ownership expectation also omitted current main's
`requiresNativePool: false` field; the exact expectation now includes it and
all 35 ownership tests pass.
This run was failure discovery, not a completed release gate. The third normal
full build passed: `/tmp/poe-optional-integration-full-build-3.log`.

The second maintained run passed all shared tasks: 939 files and 23,335 tests,
with two files/tests explicitly skipped. Bash runner then stopped at two stale
metadata assertions: blanket optional yq exclusion and exclusion-list order.
The fixture now checks the independent eight optional yq stems and four emitted
suffixes, retains the shared restricted yq directory, and compares exact source
exclusion membership independent of order. All 493 runner controls pass.
The third full run is `/tmp/poe-optional-integration-full-test-3.log`. It passed
the shared and runner phases, then exposed four stale Bash expectations:
optional cmp/shuf workflows assumed absent core defaults; device enumeration
omitted the automatic null device; and command-name diagnostics expected the
generic octal escape instead of native Bash's ANSI-C `\\E` rendering. The
reconciled fixtures retain exact outputs and duplicate-registration rejection.
Ten cmp/shuf tests pass with five explicit native-prerequisite skips; all 71
device/diagnostic controls pass. The full run remains active for discovery.

The maintained Bash source/test/consumer typecheck, root type lint, workflow
lint, and package lint have passed. Guarded ESLint reported zero errors and one
unused import warning; the import was removed, pending final lint qualification.
Packed standalone SafeFS consumers pass on Node and Bun. Packed optional
no-YAML consumers and strict types pass. These checks are separate from the
remaining full optional runtime and core smoke qualification.

The optional install writer regression was reproduced by existing source tests
and corrected by choosing streaming output using admitted destination
capabilities. Its 130 focused tests pass, with two explicit external-profile
skips. A subsequent installed failure used stale emitted output predating this
fix; the optional lifecycle must rebuild before final tarball qualification.

Packed core smoke and the maintained browser fixture exposed a merge regression
for `cmp -i1:2 </cmp-long - -`: the canonical descriptor-backed input has no seek
operation, and core cmp's nonseekable shared-input fast path returns equality.
The correction preserves the no-seek fast path for opaque/stream input while
allowing admitted regular files with unequal skips to use existing bounded
sequential reads. All 315 cmp tests pass, including frozen GNU native snapshots
and new canonical/retained controls for pathname replacement, exact diagnostics,
shared consumed position, and absent canonical seek. The frozen expected EOF
and duplicate-close diagnostics remain unchanged. Emitted browser and installed
fixtures still require a fresh build before qualification.

Packed core declaration checks and legacy `poe-code@14.0.4` filesystem-error
normalization pass. Eleven independently exported non-cmp command fixture groups
pass on both default and Node entries; these 22 groups do not substitute for the
complete core smoke fixture.

Fresh build-three tarballs passed complete core smoke on Node and Bun. Browser
packaging was attempted after `npm test` recompiled the core workspace; that
compilation overwrites the root-suffix portable browser bundle with TypeScript's
forwarding module. This is an invalid artifact ordering, not a browser manifest
change. Final qualification must run tests, then normal full build, then package
and install without concurrent compilation.

Fresh optional no-YAML Node/Bun and strict type qualification pass. Full runtime
then reproduced yq in-place staging cleanup after an output-limit cancellation.
The optional implementation now captures current-main retained cleanup authority
before staging and bounds it to one removal. All 128 focused yq controls pass,
preserving exact budget, event, inode, mode, and byte assertions.

The installed strip-provider cancellation contract likewise exposed normal
scoped removal after cancellation. Install now captures one-removal cleanup
authority before target mutation and removes a failed strip target for throwing,
nonzero, and abort-then-return outcomes. Ten maintained new controls verify both
buffered and streaming writes, source inode/mode/bytes, exact-once removal after
disposal, falsey abort identity, and successful retained targets. The full
preceding install selection passed 138 tests with two native-prerequisite skips.

Repository-wide `npm run lint` passed with zero ESLint warnings/errors, root and
consumer types, and workflow checks. The maintained Bash typecheck passed again
after the cleanup corrections. Late product/test edits also passed focused
ESLint; the final four fixture-only reconciliations have a separate lint run.

Focused runtime milestones (overlapping selections, not an aggregate gate):

- 1,176 arrays extension tests and 46 source-input tests pass serially.
- 277 parser/native-byte/deadline and 306 input/cleanup controls pass.
- 457 graduated-syntax controls preserve current-main default key support.
- 113 retained-output tests check exact host-error identity through
  `onInternalError`, generic public diagnostics, status preservation and cleanup.
- 104 command-input/IFS and 49 length/transform tests pass.
- 47 historical-type-model drift controls pass after an explicitly reviewed
  current caller binding; prior caller digest/provenance remains recorded.

Public inline Shell input follows current-main iterator-only admission until
bounded `stdinInput.read` activates cumulative accounting. The strict internal
`prepareBytesInput` helper remains independently bounded before snapshot copying.
The command contract documents this explicit reconciliation.

Raw IFS splitting retains raw FF rather than converting it to U+FFFD, with
independently observed GNU Bash5.2.37 C/POSIX versus UTF-8 delimiter behavior.
Duplicate delimiter storage remains bounded under the original 512-byte control.

Optional `mapfileExtension({ replace: true })` explicitly replaces current-core
`mapfile` and `readarray`; omission preserves duplicate-builtin rejection. Both
implementations remain. Current native fixture revisions append exact inverse
edit steps while preserving prior receipts and native records.

1. Refresh emitted core and optional output after the cmp fix, and complete
   installed optional runtime qualification.
2. Reconcile stale documentation statements about optional command/default
   membership, without implying that equivalent command names have equivalent
   APIs or semantics.
3. Run maintained build, source/tests/consumer typechecks, relevant lint,
   full repository test route, and actual packed/installed consumer fixtures.
   Canonical wrappers now exist from the first full build. Earlier missing-wrapper
   attempts were unexecuted coverage, not test passes.

The selected package-lint build and selected SafeJS workspace build completed.
They do not validate the merged shell or replace the required full gates.

Archive peer/dependency controls pass 16 focused tests while preserving the
approved pinned noble/pako dependencies. The bad-manifest bootstrap test passes
all four exact exclusion mutations before product-source reads. Optional YAML
is pinned to 2.9.0 with optional metadata, and historical peer profiles remain.

## External publication prerequisite

The optional public package still requires initial npm package creation and
trusted-publisher setup. Root verified that npm trusted-publisher configuration
requires the package to exist. This external prerequisite is independent of the
unfinished code integration above. Neither problem is resolved by dropping the
optional artifact from the release or by claiming the independent SafeJS
release shipped all local work.
