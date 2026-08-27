# Independent PAX verification — bounded gate remains open

This exclusive subtree belongs to the independent leaf verifier, not the PAX
source author or primary-source researcher. No source or sibling test is edited.
The author owns sibling `pax-*.test.ts` and `pax-extensibility-evidence/`.

Root subsequently supplied explicit author READY and execution authorization.
The completed run is **176/177 passing**, with no skips, cancellations or TODOs.
The remaining failure is the original B02 retained `identityScope` assertion,
not the historical BSD vendor rejection. Scoped/global types, global build and
built4 pass. See `REPORT.md` for the concrete blocker, exact evidence and limits.
No production or sibling-test changes, staging or commits were made.

## Six independent controls

| Identity | Discriminator |
| --- | --- |
| I01 | Binary optional values surround real UTF-8 path, size and linkpath overrides; raw size differs from effective size; following record alignment, actual symlink type and literal `._literal` file survive. |
| I02 | Length ±1, missing delimiters, record-crossing equals lookup, bad newline, unsafe length, invalid key bytes, checksum and truncation mutations fail before replacing a sentinel. |
| I03 | Exact sparse/layout keys reject even on excluded members; optional metadata cannot disable effective-path traversal, Unicode, NUL, charset or sparse-type checks. |
| I04 | Exactly bounded ignored bytes pass; PAX/member/archive/effective-size limits still reject, including excluded members; an optional-only local header remains orphaned. |
| I05 | Fixed virtual local/global millisecond expectations remain separate from exact native local nanoseconds and the BSD global-profile conflict. Native default `._` presentation is recorded, never copied into product semantics. |
| I06 | Backward PAX hardlinks retain actual shared identity and writes; missing/false backend support rejects without copying or replacing existing destinations. |

Fixtures are built independently in `fixtures.ts`; no product encoder, author
helper, author fixture generator or observed product output supplies expectations.
Only documented optional xattr namespaces are positive controls. There is no
generic vendor-wide ignore requirement and no Apple-name-only exception.
Scenarios inside six top-level tests are not additional test identities.
Input mutations are not claimed as production-source mutant executions.

The tests inspect exact namespaces, bytes, types and complete backing identities,
not listing substrings or same-content substitutes for hardlinks. They deliberately
do not claim restoration of xattrs, ACLs, ownership, platform flags, sparse layouts,
all timestamps, or all archive formats. Empty-value deletion semantics remain an
open issue from the independent research; this nonempty-mtime control does not
approve fallback to raw fields after deletion.

## Primary rationale and independent profile audit

Research is retained at `/tmp/safe-bash-pax-research-detail.txt` with source bodies,
native reproducer and hashes under `/tmp/safe-bash-pax-primary-sources/`. Read it
and its evidence on resume; the READY manifest does not replace that review.

- POSIX.1-2024 `pax`, Extended Header / Keyword Precedence / File Times: byte
  lengths include framing and final newline; real path/linkpath/size overrides
  remain effective, local nonempty times override global times, then raw fields.
  Publisher HTML SHA-256: `398b008eab3110cd482eee2e62797adaf915405e488b1f36bc73fc2a29591efb`.
- Libarchive 3.7.4, pinned commit `313aa1fa10b657de791e3202c168a6c833bc3543`,
  `archive_read_support_format_tar.c`: separate handling of raw SCHILY xattrs,
  encoded LIBARCHIVE xattrs, sparse layout and global-header limitations.
- Maintainer star manual, commit `e835e64f0d84a614b3c8d619ac646060ea6922a5`,
  `star/star.5`: `SCHILY.filetype` and `SCHILY.realsize` affect actual type/layout,
  not optional xattr decoration.
- Apple's official libarchive-160 source, commit
  `e6f2f0739fd3ce7207a2b6955d50fbc0141e1080`, reader defaults `mac-ext` on
  when built with copyfile support and detects `._` last components inside
  `read_mac_metadata_blob`. This is platform-reader presentation, not permission
  to drop ordinary USTAR members from this VFS. Binary build equivalence is not
  inferred from a source tag.

The original BSD profile has a 56-second global/raw difference, not a rounding
error. Independent native research shows exact local `.123456789` preservation
by both pinned binaries. I05 constructs fresh fixed input and checks bigint
`mtimeNs` directly. GNU following time is `1700123400000000000`; the measured BSD
profile is `1700123456000000000`. The virtual expectation remains the global
`1700123400000` milliseconds. No current-clock sampling, tolerance expansion or
moving expected value is involved. Native observations, argv, status, output,
version and executable hashes are in I05 TAP diagnostics even on assertion failure.

The sidecar probe is `-tf sidecar.tar`, with no hidden native options or copyfile
environment flags. Its input is a verifier-generated ordinary `._literal` member
followed by `literal`. GNU must list both. BSD output is diagnostic presentation;
I01 independently requires product listing and extraction of the actual ordinary
member. This is not a complete AppleDouble parsing/restoration test. Author native
changes must separately be reviewed against their captured raw archives and exact
options; no score waiver is embedded here.

## READY manifest and final invocation

The runner requires a root-approved JSON manifest at an absolute path:

```json
{
  "schema": 1,
  "status": "READY",
  "author": "01a0409f-da83-78f0-ab8c-8daa6f96e883",
  "authorHandoff": "Exact completed handoff reference supplied by author",
  "rootAuthorization": "Exact root resume authorization reference",
  "head": "FULL_40_HEX_CURRENT_HEAD",
  "authorTests": [
    "tests/commands/archive-stress/pax-extensibility.test.ts",
    "tests/commands/archive-stress/pax-native.test.ts"
  ],
  "authorNames": ["EXACT_ORDERED_NAMES_FROM_FINAL_AUTHOR_HANDOFF"],
  "inputs": {
    "RELATIVE_APPROVED_INPUT_PATH": "SHA256_OF_FINAL_BYTES"
  }
}
```

The example is intentionally incomplete and cannot authorize execution. `inputs`
must contain every archive production `.ts` file, each final author target,
`package.json`, `package-lock.json`, both root tsconfigs, and this subtree's
`run.mjs`, `fixtures.ts`, `controls.test.ts`, `tsconfig.scope.json`. Additional
approved paths may be included. `authorNames` must list every exact final author
test name in execution order, not just a count. Root must also examine any author
policy or test change; a machine-readable status is not an independent approval.

Once explicitly resumed, run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node tests/commands/archive-stress/pax-independent/run.mjs --ready /absolute/path/to/root-approved-handoff.json
```

Without the manifest, the runner refuses before creating outputs or freezing.
The actual completed invocation used `/tmp/safe-bash-pax-independent-ready-02.json`.
That manifest describes the frozen inputs, before this post-run README/report
update; future live-tree runs need refreshed approved hashes. A syntax check is:

```sh
node --check tests/commands/archive-stress/pax-independent/run.mjs
```

## Complete current-tree capture, not a partial global check

The corrected runner selects regular tracked and relevant untracked current
source, configuration and legitimate fixture inputs, then adds every actual
`tsc --listFilesOnly` input and narrowly required historical archive artifacts.
It explicitly excludes old `.snapshot`/`.oracle` build copies, nested dependency
aliases, evidence/report output trees, result JSON/transcripts, root `.git` and
root `dist`. Exclusions and rationale are recorded per path. Actual compiler
inputs override generic evidence exclusions; unexpected old generated compiler
inputs or external aliases stop capture instead of producing a partial gate.
Every frozen file is regular, independently copied with `nlink=1`, byte hash,
executable mode and a different backing inode. This is a current-working-input
snapshot, not `git archive HEAD` or a clean-HEAD claim.

Old nested fixture/dependency aliases are not traversed or copied. Root locked
dependencies are copied once. Generated `.bin` launchers are the sole byte-transform exception:
they are regular, recorded shell shims pointing at the copied original executable
inside the snapshot, because copying the body of a symlinked `tsc` launcher to a
different directory breaks its relative requires. Package implementation bytes
are never changed. Both original and shim hashes/targets are recorded.

Root installed packages are checked against the root lockfile versions and
integrity metadata; their contents are sealed. Benchmark dependencies are not copied.
This offline
check does **not** re-establish registry tarball integrity. No install, lifecycle
download or comparator runs. Missing/unlocked required packages fail preparation.
The exact GNU 1.35 executable is copied and hash-checked. Node, npm and the pinned
BSD executable are fingerprinted before/after; macOS runtime libraries are not
claimed to be copied or hermetically frozen.

Sealing requires matching selected live manifests before/after copying plus
verified frozen copies and exactly equivalent live/frozen global compiler lists.
The completed run has 955 compiler inputs: 130 source, 652 test, six other project
inputs and 167 dependency/type inputs. Actual copied inputs are 1,629 regular
files, 58,268,240 bytes, not historical output trees. A race stops before product
execution; there is no partial-tree fallback or indefinite retry. Capacity is
bounded to 10,000 files / 256 MiB / 900 seconds overall. The snapshot is retained in a new
private `/tmp/safe-bash-pax-independent-*` directory. Run output belongs only to
this subtree's new `runs/run-*`, outside sealed input closure.

After sealing the runner executes, sequentially and despite nonzero test results:

1. Original six author files: exact original **128** identities.
2. Original aggregate wiring: **1** identity.
3. Original five stress files: **30** identities with the explicitly reviewed native-profile assertion refactor.
4. Final author targets: separately named/counted from READY.
5. This verifier's **6** controls.
6. Scoped `tsc` including original, author and independent archive tests.
7. Actual `npm run typecheck` in the complete frozen current tree.
8. Actual `npm run build` there, with no copied root `dist`.
9. Existing immutable built-package check, separately **4/4**, valid only with
   successful fresh build and its expected completion marker.

The package scripts must remain exactly the reviewed tsc commands; unexpected
pre/post build/typecheck hooks reject. No full `npm test`, broad FS/table-text/jq
suite, comparator, native install or source mutation runs. Native metadata/version
probes are narrowly contained in the selected tests. Loader overrides are cleared;
command output/time are capped and owned process trees are terminated on limits.
Global types/build may inspect other families' types; their tests are not run.

## Immutable original accounting and reporting

Original raw gate remains **158/159 OPEN**, comprising author128 + wiring1 +
stress30, with stress29/30. Native-author5 is a subset, not five more tests.
`gate-3ecvdu` TAPs and evidence JSON are checked against fixed SHA-256 values.
Original runtime fixture/test files and built checks must match its sealed-input
manifest except the exact approved `native.test.ts` hash: native-only mtime
assertions move to P12 while N-in gains direct VFS byte/time checks. This is a
profile-refactored30, not an unchanged native oracle. Other unexpected edits stop
verification. Exact ordered test names and totals are checked per new run.

Every command retains argv, status, signal, stdout/stderr hashes, elapsed time,
TAP counts/names and failures. No nonzero raw native conflict becomes a pass.
The new native-profile control is reported separately from the historical raw
N-BSD-in mismatch. The completed runner exits 1 because B02 fails; it does not
convert the original historical 158/159 into a newly passing raw-native gate.

Post-run frozen hashes, protected live archive-history hashes and moving-tree
drift are separate. Later concurrent changes do not become tested source.
Root56 baseline `33347b76def1b2cbbe3f399b3be330d3f40e6a50` remains known history;
READY HEAD and working input hashes identify the actual future execution.
This harness preparation makes no superiority, full preservation, full-shell,
full-POSIX, all-platform, universal resource-bound, or 72-hour completion claim.

## Remaining before acceptance

- Root assigns the B02 identity assertion failure to its existing owner; this leaf
  cannot weaken that test or change filesystem/production behavior.
- The PAX allowlist and profile refactor pass bounded review and targeted tests,
  but the complete requested gate is still failing. Empty-value deletion is OPEN.
- All failed attempts are retained, including a pre-product canonical `/tmp`
  compiler-path bug fixed only in this harness. See `REPORT.md`.
