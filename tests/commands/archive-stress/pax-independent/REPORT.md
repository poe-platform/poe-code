# Independent PAX checkpoint — BLOCKED, 176/177

August 27, 2026 UTC. Distinct leaf verification after explicit author READY and
root resume. No production/sibling-test edits, installs, staging or commits.
Only this subtree and `/tmp` were authored. No broad filesystem, jq, table-text,
comparison or full-package test suite ran.

## Disposition

**Do not describe this checkpoint as a clean ready-to-commit acceptance gate.**
The narrow PAX implementation and disclosed native-profile test refactor pass
this bounded source review and all new targeted controls, but the requested
combined gate has one failing original stress case. Route that failure to the
existing test/source owner before claiming full acceptance; do not waive it.

| Cohort | Pass | Fail | Skip | TODO | Cancel | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original author six files | 128 | 0 | 0 | 0 | 0 | 128 |
| Original default wiring | 1 | 0 | 0 | 0 | 0 | 1 |
| Profile-refactored original five stress files | 29 | 1 | 0 | 0 | 0 | 30 |
| Final author targets | 12 | 0 | 0 | 0 | 0 | 12 |
| Independent controls | 6 | 0 | 0 | 0 | 0 | 6 |
| Unique main identities | **176** | **1** | **0** | **0** | **0** | **177** |

Exact ordered names match all five cohort manifests; 177 unique names, no
duplicates. P12 is one native-only profile test inside author12. I05 is one
mixed virtual/native profile test inside independent6. Neither is counted again.
Native author5 and original H01–H03 are overlapping subsets, not extra tests.

Scoped types: exit 0. Actual global `npm run typecheck`: exit 0, no unrelated
type errors. Actual global `npm run build`: exit 0. Existing built-package
checks: separately **4/4**, exit 0 against the fresh emitted `dist`.
No command timeout, output-limit event, skip, cancellation or TODO occurred.
The completed runner exits 1 for the genuine recorded test failure.

## Concrete blocker

`B02 default 64 MiB entry declaration rejects plus one before body reads or publication`
fails in unchanged `tests/commands/archive-stress/limits-effects.test.ts:104`:

```text
Expected values to be strictly equal:
+ actual - expected
+ undefined
- Symbol()
```

This is `retained.identityScope` versus `original.identityScope` in the
over-limit branch. The test obtains the original stat, replaces `fs.writeStream`
with a counting forwarder, invokes tar, then compares identity. Before the failing
assertion, it already verifies the expected entry-limit error, one input pull,
iterator closure and zero publications. The exact-boundary branch separately
records two pulls, one publication and the intentional body-read sentinel error.

The over-limit branch's subsequent dev/ino, content and namespace assertions
do not execute after this failure; do not advertise them as passing. The failed
test source is byte-identical to the historical gate input, SHA-256:
`b7962d85dd8362b5da7f4df5839fb6e7b1f9cbd19295607252717a4e7018f2ae`.

No claim is made that this proves a PAX parser defect or file-content mutation.
The visible instrumentation/identity interaction needs owner investigation.
This leaf did not investigate filesystem internals, change the test, change its
expectation, retry toward a green result, or modify production. Root must route
the issue and authorize any follow-up. It is a concrete blocker, not a waived
capability or a replacement of the old BSD failure history.

Raw failure: `runs/run-0N6uc7/profile-refactored-stress30/stdout.log:128`.

## Independent source and assertion audit

All supplied hashes matched before execution. The complete author manifest
contains exactly 167 entries; every entry matched before and after the gate.
Its hash remains `269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f`.
The author's 90 protected historical records also match before/after.

Reviewed source delta in `format.ts` validates byte framing and the strictly
decoded key before deciding whether to decode a value. Only nonempty
`LIBARCHIVE.xattr.*`, `SCHILY.xattr.*`, and exact `SCHILY.fflags` /
`LIBARCHIVE.creationtime` are omitted as bounded opaque metadata. No Apple-only
exception, broad vendor prefix, optional-value text/base64 decoding, path/type/
size interpretation, persistent optional-state growth or host restoration was
introduced. Unknown, sparse/layout/type/volume, ACL, label and archived-identity
extensions remain unsupported. Existing resource, checksum, charset, namespace,
pending-header and hardlink behavior stays on its original code path.

No new source defect was demonstrated by this bounded review. This is not
proof of every extension or all adversarial inputs. Empty-value deletion remains
the separately identified OPEN issue; no implementation change or semantic
approval is implied by passing nonempty-mtime controls.

The only original `native.test.ts` delta adds direct virtual extraction and
exact payload/time assertions for the independent PAX fixture. Its native-only
time assertion is relocated to P12 with exact GNU/BSD profile expectations;
native times and `nativeMatchesPosix` remain recorded in N-in. The two original
compression crossreads, exact listing/payload/link assertions and continuation
after fixture discrepancies remain. No existing product assertion was removed.
This is deliberately reported as **profile-refactored30**, not the unchanged
original native oracle. Historical raw158/159 and raw29/30 remain immutable.

AppleDouble coverage uses BSD's default presentation plus GNU's independent raw
listing/extraction of the same BSD archive bytes. Four default/PAX × plain/gzip
scenarios contain four ordinary `._*` members, each 163 bytes in this run; raw
namespace and byte assertions preserve them in the VFS. Product creation later
selects only explicit user names, so it is not a full-sidecar re-emission claim.
No production filtering or lower expected product namespace was introduced.
Our I01 separately requires a literal ordinary `._literal` file to survive.

## Fresh fixed-time and native-option evidence

I05 independently builds one fixed archive, SHA-256
`259f156dd7cd11fe320d1569a8598afcda3900653982018bc3c41460dde9f5ee`.
Both exact native binaries restore local `1700123401123456789` ns. GNU restores
following global `1700123400000000000` ns; BSD restores raw-header
`1700123456000000000` ns. The 56-second conflict is not clock calibration or
granularity. Virtual extraction separately asserts fixed local/global ms.
P12 independently retains its `.125` local/native-global profile checks.

I05 native argv is recorded exactly: `--version`, `-xf fixed.tar -C out`, and
`-tf sidecar.tar`; environment is `PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC`.
There are no extra native options or copyfile-suppression variables. GNU lists
`._literal` then `literal`; BSD lists only `literal`, status 0. This is recorded
as native presentation, not a rule for dropping product files. Sidecar fixture
hash: `8404daf3a152880fa1bc3521a786ce051566fb418feb40017d0104dd46cfbde8`.

Pinned GNU 1.35 executable:
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
Pinned BSD frontend 3.5.3 / linked libarchive 3.7.4 executable:
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
Native argv/status/output and retained archives are under the respective cohort
directories. Both original H01–H03 and I06 pass actual identity/shared-write and
unsupported-no-copy tests. These are not remote-provider hardlink guarantees.

## Corrected capture and honest global types

The first attempt, `runs/run-9Q9lJM`, stopped before product execution because
the verifier normalized `/tmp` lexically while macOS compiler output used
`/private/tmp`. All logs/snapshot remain retained. Only this runner was fixed.
That attempt also exposed overbroad result-JSON capture; the corrected selection
excludes those unrelated output copies rather than copying historical trees.

Completed attempt: `runs/run-0N6uc7/evidence.json`, elapsed 22,907 ms.
Retained regular-file snapshot: `/tmp/safe-bash-pax-independent-YKSbHc/tree`.
Sealed HEAD: `cd8b5c8025e9d40ba71594f7b709a42f5249988d`; current dirty inputs are
included. This is not a clean committed-HEAD validation. Root56 remains the
historical `33347b76def1b2cbbe3f399b3be330d3f40e6a50` checkpoint.

1,629 captured regular files, 58,268,240 copied bytes. Root locked dependencies
are copied once; no benchmark dependency tree, old `.snapshot`/`.oracle` build
copy, nested node_modules alias or generated evidence tree is materialized.
Explicitly required original TAP/JSON/raw BSD fixtures and the exact GNU binary
are retained. Legitimate named fixtures/configuration/current code remain;
every actual compiler input is included. Per-path exclusions and rationale are
in the evidence manifest. Four regular `.bin` forwarding shims preserve copied
tool entry points; their generated hashes and targets are recorded separately.
Dependency package code is unchanged. Installed versions/integrity metadata and
file hashes are verified offline, not revalidated against downloaded tarballs.

Live before, frozen before, frozen after and live after `tsc --listFilesOnly`
lists are identical: **955 files = 130 src + 652 tests + 6 other project +
167 dependency/type inputs**. All 788 actual project inputs are present; no
partial archive-only tree was called a global typecheck. The list hash is
`fc56fc3d1d2df15ec2059776ffa36a7b328f6751edae8773077e91bb4455c197`.
Only compiler metadata/type/build work reads other families; their suites did
not execute. Node, npm and BSD executable hashes remain unchanged; system
libraries are external and no fully hermetic OS claim is made.

The live selected-input hash changes after sealing; that is separate moving-tree
drift, not newly tested source. Frozen before/after hashes match exactly; all
author and historical protected hashes remain stable. No native fixture
directories remain in the owned snapshot/temp locations checked after execution.
The runner's owned-child cleanup reports no errors.

## Exact commands and hashes

Completed driver command from repository root:

```sh
node tests/commands/archive-stress/pax-independent/run.mjs --ready /tmp/safe-bash-pax-independent-ready-02.json
```

Driver SHA-256: `088f5425cd60d572d7f7d4216da9c77bee6f5fa29c03659992171e153a001008`.
READY SHA-256: `c7379bd04320a4c0723a410076509fa11093e1c6893c438d2402372632790b78`.
Selected live-input manifest: `3144d0d90d695e021f6bd279c34ef31c49cd49c567d5b29c80c7acae7346f261`.
Frozen before/after manifest: `0e384ea33290a09c255ee29b6db6d4831cfaf2113377be703ff9498ce473f3f9`.
Result evidence JSON: `6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b`.

Executed test launcher, with each exact file list retained in evidence `commands`:

```sh
node --unhandled-rejections=strict --import tsx --test --test-timeout=20000 --test-concurrency=1 <cohort files>
node node_modules/typescript/bin/tsc -p tests/commands/archive-stress/pax-independent/tsconfig.scope.json
npm run typecheck
npm run build
node tests/commands/archive/built-package.mjs
```

`ARCHIVE_LONG_LINK_NATIVE=1`; archive source import override points only inside
the frozen tree; per-cohort native evidence directories are newly owned outputs.
The original author files are boundaries/core/lifecycle/native/options/safety;
wiring is aggregate-integration; stress files are acceptance/native/
long-link-regression/limits-effects/hardlink-identity. Final author targets are
pax-extensibility and pax-native; independent target is controls.test.ts.
No subset repetition is added to 177.

Source `format.ts`: `4e3c6fe95a6b967cf45bfd7b6903fd2e8b568233de33182e2e5af4424b79cfe0`.
Source README: `ec814681a5fc5c5a341b4a7fb15cb8afe460378df9a905c849254fe73cf92ef1`.
Approved native test: `8637e372c0955286bbec9fc1aa9b9465740e212fdbdabb4e31cb272154a10431`.
Stress TAP: `f3ea27f023c79ef47bd89e7973eaafafafea8af23f29123bae19e2d74478f465`.
Global typecheck stdout: `1fdde720d88bceb0944ea367ca22ed421eb773fe2037128aef9cf9646f975e47`.
Global build stdout: `192358b3fd3475b4bb505c07ba0b5608c6e4aa06624198bba950fe56e278e6f0`.
Built4 stdout: `550083dc4cf861bf2f2791cdacafb909fd69ee11f26cf596fa99839c8de1fe05`.

This README/report is written after the run and is not retroactively part of
the sealed input proof. Runtime source, controls, config and runner are not
changed after the completed run. All raw run records remain immutable.

## Remaining limits and next owner action

Root should assign B02's identity/instrumentation discrepancy, preserving this
failure and the original test expectation until a reviewed disposition exists.
No file-content corruption or archive defect is inferred merely from that failed
metadata assertion. Do not claim full green acceptance or commit readiness yet.

The PAX change remains limited opaque-metadata omission, not preservation of
xattrs/ACLs/security metadata, full sparse support, full POSIX/Bash/tar parity,
universal cancellation/resource limits, atomicity, a clean whole-product release,
superiority to just-bash, or evidence of 72 hours of completed work. Empty-value
deletion and native global/sidecar presentation differences remain explicit.
