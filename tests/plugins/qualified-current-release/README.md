# Current qualified release profile

This is the mandatory qualified job, not a portable substitute or whole-package
release-readiness certificate. Run from the repository root with existing Node
22+ and installed project development tooling; no installation or download occurs:

```sh
npm run verify:release:qualified -- \
  --source-commit COMMITTED_CANDIDATE \
  --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7" \
  --archive-tar-from "$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"
```

`--check-only true` authenticates and stages prerequisites without running tests;
it is not a release pass. Missing/wrong/unset required assets fail with exit78
before product tests. No ambient `GNU_TAR`, host reconstruction, download,
rebuild, global install or changed lock/runtime dependency substitutes for setup.
The separate diagnostic command `node scripts/verify-current-consumers.mjs
--source-commit COMMITTED_CANDIDATE` runs the build-first consumer phase only;
it cannot replace the mandatory qualified job.

## Exact candidate, unchanged tests

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
declarations are not standalone runtime programs. No root `.ts` inclusion or
canonical test configuration changes occur.

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
Neither deployed WebDAV atomic-extension workflow is run here; their four
maintained inputs receive strict current declarations only. External service
acceptance and configured-rmdir evidence remain separate.

This census has177 entries:29 current,2 negative,4 declarations,141 frozen
evidence and1 frozen oracle. New paths still fail closed. Development tooling
is copied as regular files into the frozen candidate, not linked to a mutable
dependency tree. `tests/integration/qualified-current-release-inventory/verify.mjs`
checks the census and eight guard mutations; it is not a runtime release gate.

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
