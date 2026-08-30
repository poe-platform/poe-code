# Current qualified release profile

This is the mandatory qualified job, not a portable substitute or whole-package
release-readiness certificate. Run from the repository root with existing Node
22+ and installed project development tooling; no installation or download occurs:

```sh
npm run verify:release:qualified -- \
  --source-commit COMMITTED_CANDIDATE \
  --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7" \
  --archive-tar-from "$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar" \
  --peer-tarball /absolute/path/poe-code-13.0.0.tgz
```

`--check-only true` authenticates and stages native prerequisites without running
tests; it does not run peer closure admission and is not a release pass.
Missing/wrong/unset required native assets fail with exit78
before product tests. No ambient `GNU_TAR`, host reconstruction, download,
rebuild, global install or changed lock/runtime dependency substitutes for setup.
The separate diagnostic command `node scripts/verify-current-consumers.mjs
--source-commit COMMITTED_CANDIDATE --peer-tarball /absolute/path/poe-code-13.0.0.tgz`
runs the build-first consumer phase only;
it cannot replace the mandatory qualified job.

## Exact candidate, unchanged tests

### Canonical peer and current metadata source

The maintained migration profile requires `poe-code >=13.0.0`, with development
and lockfile version exactly `13.0.0`. `--peer-tarball` is an explicit existing
registry artifact, not a download request or credential. There is no environment
variable fallback. The shared `peer.mjs` helper verifies the exact registry URL,
SHA-512 SRI, package metadata and the build tooling's selected bytes. It refuses
an optional peer, other peers, a mismatched pin or artifact, symlinks and source
fallback. This profile does not automatically qualify later package versions.

Both current and moved packed consumers receive only the selected public Node
runtime closure, its existing authenticated declaration closure, and the peer
manifest. The actual 13.0.0 input selects four JavaScript files and 26 declaration
files. No CLI dependency tree, blanket node_modules permission, private engine
or filesystem implementation is copied. Transitive runtime imports are parsed
with the existing TypeScript tool; unsupported foreign packages or unexported
peer routes fail closed. The private conditional type mapping remains the
published package's own mapping, not a rewritten declaration or ambient shim.

Artifact admission reads at most 64 MiB compressed and inflates at most 128 MiB.
This pinned npm artifact uses regular USTAR members; other member types are
refused rather than extracted. Headers, checksums, safe unique paths, trailers,
the 20,000-member bound and 16 MiB per-member bound are checked in memory before
any consumer staging. Only selected authenticated bytes are written. The helper
rechecks inputs before staging and the exact installed file set/bytes after
moving, typing and runtime execution. Existing source-read permission denials,
negative types, runtime counts and packed lifecycle controls remain mandatory.

The real-commit wrapper supplies metadata verification with its authenticated
snapshot source inventory, source digest and resolved commit. The explicit
`committed-current-source` profile replaces only historical product source and
root compiler/package input paths, verifies their complete current census and
hashes on both lifetime boundaries, and retains all non-source historical inputs.
It does not ignore arbitrary missing paths or reseal an old manifest. Calling
the metadata runner without that profile retains its historical default. All
318 metadata cases, 22 native rows, oracle hashes and fixture expectations stay
unchanged; the pure profile selector does not independently attest Git provenance.
The wrapper's real `git archive` is the provenance boundary.

The new admission/profile unit tests use the declared dev-only
`memfs@4.56.10` (Apache-2.0), with no host disk writes or network. It adds no
runtime dependency. The existing unit/test tooling remains unchanged. See
`docs/plans/canonical-peer-qualified-release.md` for the bounded change and
the distinction between current qualified acceptance and historical failures.

### DU staging-input typing

`staged-types.json` separately authenticates fourteen literal DU recipe inputs
against their owning manifests: six sealed captures, five versioned v5–v9
templates and three reusable templates. Their bytes and filenames stay intact.
Their relative `./node_modules/virtual-bash/dist/commands/du/index.js` imports
only resolve in the recipes' isolated installed-package layout, not as root
compilation units. Each exact exclusion requires an intact owner record and a
maintained `du-leaf` local-package type/runtime route; no DU directory is omitted.
Reusable templates remain usable recipes, not disposable historical data. New
recipe templates should be named `consumer.ts.fixture` and staged byte-identically
as `consumer.ts`; this does not rename existing frozen inputs or change the
maintained standalone `.mts` inventory convention.

The maintained `du-leaf.mts` consumer imports the installed internal leaf,
checks factories/options strictly, executes a VFS workflow and a limit refusal,
and disposes both shells. Its `localPackage:true` route receives the same built
declaration authentication and moved runtime permissions as other current
consumers. It is not public DU export/default integration, full DU behavioral
acceptance, or a rerun of historical source revisions. Unknown `.mts` inputs
still fail classification; neighboring `.ts` sources remain compiler inputs.
The one-byte output-limit control requires status1 and both streams empty:
DU's documented cap combines stdout and stderr, so no diagnostic fits. The
original author consumer incorrectly required diagnostic text; its failed
packed runs remain evidence rather than a DU product defect or a waived limit.

The owned snapshot helper reuses existing `run`/`step`/`finish` conventions,
without modifying the previous stream-public helpers or independent holdouts.
Git archives resolve one commit, never dirty source. Harness bytes must match
that commit. The source archive, source/test manifests, harness, installed
compiler/loader versions and hashes are retained in `.runs/qualified-*`.
Current consumers and both unchanged archive test files/support files are
explicitly included. Builds emit only inside the archived candidate; the current
consumer package contains only copied candidate `dist` plus its manifest.
Strict compiler file lists reject source/shared-build fallback. Plain Node runs
emitted consumers with filesystem access restricted to that consumer tree;
the original moved offline npm-packed checks and their denial controls still run.
No source-loader is used for the public consumers. Native test oracles remain
host processes, never a product fallback.

`inventory.json` enumerates each tracked `.mts` path, hash, classification,
reason and existing/new script coverage at its recorded commit. Newly tracked
standalone files fail closed pending explicit classification. Maintained inputs
are strictly compiled with `skipLibCheck:false`; self-contained programs run
unchanged, including the thirteen WebDAV serialized-loopback tests and public
type assertions. Provider programs use their unchanged shared `example.mts` /
`https.mts` companions as the original runners assemble them. They are strictly
compiled, but their Apache/WsgiDAV/S3 workflows are **not executed** by this job;
importing exported workflow modules is not service proof. Research feasibility
inputs are not claimed as supported product features. Frozen evidence copies
are hash-inventoried, not mutated or rescored. Four imported `.d.mts` support
declarations are not standalone runtime programs. The original standalone
reconciliation changed neither root `.ts` inclusion nor canonical test
configuration; the later exact-data typing repair is recorded below.

### August 27 inventory reconciliation

The original20 unclassified paths at6ffe4f4 are explicitly routed: six current
inputs (two time-env positive consumers and four WebDAV atomic-extension
inputs), two intentional negative-type fixtures, and twelve frozen captures
(three pre-public time-env programs and nine captured WebDAV inputs). None is
raw data. Historical programs retain their literal65/absent-export/native
failure profiles; frozen package identities and evidence hashes are verified.
The negative fixtures require their positive paired consumer first, then exact
diagnostic text, positions and counts (two public and five internal-leaf errors).
No generic nonzero exit or missing-module error counts as successful type checking.

One later tracked `release-timestamp-independent/independent.test.mts` is also
current: strict compilation and actual emitted node:test execution,23 tests
split into20 controls and3 mutant-kill assertions. It is not frozen data or23
provider-success workflows. The original13-test WebDAV consumer remains
unchanged and mandatory, using the candidate's current provider fixture.
The three TLS-dependent author inputs receive strict current declarations only.
The independent atomic consumer is service-free: its own group strictly compiles
and executes unchanged `consumer.mjs`, with an identifying package.json beside
the emitted file. Its injected fetch/configured removal and stock refusal do
not establish deployed-provider acceptance. External service acceptance and
configured-rmdir evidence remain separate.

That historical census has177 entries:29 current,2 negative,4 declarations,141 frozen
evidence and1 frozen oracle. New paths still fail closed. Development tooling
is copied as regular files into the frozen candidate, not linked to a mutable
dependency tree. `tests/integration/qualified-current-release-inventory/verify.mjs`
checks the census and eight guard mutations; it is not a runtime release gate.

### August 27 build-aware typing route

Two later env-split fixtures from f2906a06 are explicitly classified, not omitted:
`public-types.mts` is a maintained declaration-only proof; `invalid-binding.mts`
must produce exactly one TS2741 diagnostic. Their bytes remain unchanged. The
updated census is179:30 current,3 negative,4 declarations,141 frozen evidence and
1 frozen oracle. The positive route intentionally has no runtime: its original
`run-v2.mjs` also invokes only tsc for this file. This is not new env-S acceptance.

`npm run typecheck:all` builds once, keeps current source/tests checked, and reuses
these maintained routes for strict copied-build declarations and exact negative
diagnostics without executing consumer programs. Four current `.ts` consumers
also remain in the root compiler and get three explicit strict build-first
groups. Those WebDAV fixtures deliberately import source MockDav helpers; they
are not represented as isolated packed service proofs. Current public imports
must resolve candidate `dist`. The separate runtime release runner retains its
mandatory pre/post execution guards and canonical `.test.mts` execution.

Exactly five flattened historical tree contract captures are classified as
authenticated data by `captured-types.json`, not current compilation units.
Their original current contract sources and neighboring TypeScript remain
checked. See `tests/integration/typecheck-workflow-repair/README.md` for source
binding, cold prerequisites, retained historical failures and mutation controls.
The census reads all tracked paths (including future examples outside tests or
scripts), with no prefix exclusions. The former independent-holdout prefix
contained zero .mts files; it can no longer silently hide a future executable.
The frozen archive includes the actual candidate README so npm's automatically
included README is not silently missing from the qualified package. Earlier
selected-tree packages without that README remain separate captured artifacts.

### Independent review corrections

Independent862fdc54 accepted the original20 classifications, but identified the
service-free consumer omission and an empty-runtime coverage hole. Preserve
847dfd7's exit0 as an incomplete-coverage checkpoint, not current complete
coverage. The repaired runner checks mandatory `.test.mts` to emitted-runtime
mapping and nonempty `nodeTests` execution before building, then checks exact
declared-versus-actual results/counts after execution. A compiler pass with zero
runtime tests is not accepted. Canonical regressions and live-runner sentinel
mutations are in `tests/integration/qualified-current-release-repair`.
The fixed configuration needs a different verifier; metadata classification
remains reviewed trusted configuration, not a hostile-JavaScript sandbox.

Dirac's accepted `aac345a0` review retains canonical **470/470 + 485/485**, and
pre-existing standalone omissions **11/30** at its two historical commits.
Those are not the current inventory denominator. The existing historical
`selected-gnu.ts` dedicated strict build-first check remains mandatory; its
obsolete READY/56-command runtime is not executed or called current proof.

## Native fixture authority

All existing fifteen metadata prerequisites and stream native pins remain.
The archive executable pins/profile are adapted from `e3c04127`, not its
historical runner's `e36dab2` source binding. GNU tar1.35 must be an existing
regular executable with SHA256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
BSD tar, Apple gzip/gunzip hashes and version stdout/stderr are checked too.
The authenticated GNU executable is copied exclusively into the candidate's
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`; both current test files
hardcode that path. Symlink parents and existing destinations are rejected.
The primary is untouched. Full unchanged files must report **11/11**, with zero
failures, skips, cancellations or TODOs. The historical same-e36 **5 pass/6 fail**
missing-tool run and **11/11** configured run remain separate original evidence.

GNU chmod controls require actual fixture authority: a child inheriting gid0
when the caller belongs to gid20 may fail EPERM despite identical mode bits.
The runner creates only its own new native TMPDIR, records uid/gid/groups,
parent/child ownership, mode, umask and ACL output, and if necessary changes
only that new owned directory to the caller's member primary group. It probes
actual pinned GNU chmod setid operations and fails setup if authority is absent.
The canonical runner's existing exported environment receives this explicit
TMPDIR; native expectations/product permissions are unchanged. Neither host
paths, repository paths nor native pins are chowned. This is a measured fixture
profile, not portable GNU/Linux semantics or a product SGID fix.

## Preserved limits and first failures

Original author **318/318**, independent first **316/318**, six historical SGID
strict differences, and stream **124/164 strict + 40 exact stderr differences**
remain distinct. No original failure is rewritten. Five known public
premature-cleanup failures remain **OPEN** pending separate independent closure;
new source/contract/runtime commits do not retroactively change frozen
`b7ae676a57adec1193b51fe08a91b17eac6f5884` evidence. Current consumer success is
not whole-package lifecycle acceptance, release readiness, superiority, full
native parity or fulfillment of the requested72 hours. See retained current
run reports for the actual candidate and outcomes, not historical counts.

## August 28 maintained inventory delta

The seven later `.mts` additions are individually classified in
`inventory-maintenance-20260828/REPORT.md`. Six exact sealed timeout/XAN inputs
retain authenticated history; the unchanged WebDAV public declaration consumer
gets a current strict type-only route. A maintained timeout options counterpart
preserves the sealed source-local assertions with only the public import changed.
The new200-entry census retains all192 previous entries. Metadata admission
checks do not establish compilation/runtime success, retry XAN, or change the
fixed76 gate's historical192-entry profile. Unknown neighbors still fail closed.
