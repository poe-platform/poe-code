# Direct tool routing — author packet, 2026-08-28

Status: **ready for different Dirac review; no full-gate release**. This packet
does not retroactively bind the historical xcodebuild license subprocess or the
old trace's unresolved `otool-classic` basename.

## Exact bindings

- Final shipping source: `fe15f1e406fa1039accddec25c696ae7187f6135`.
- Final control harness: `07db17c0c37e2a5e9dbe77c248c48a67c7a6fa76`;
  fixed-input helper staging: `88f49dec2f9ee033c8577637508a24277ff1e5bb`.
- Normalized `DRIVER.json` SHA256:
  `25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527`.
  All original 35 closure entries remain; exactly `tool-routing.mjs` and
  `TOOL-ROUTES.json` are added. `evidence-v2/SOURCE-BINDING.json` authenticates
  all 37 committed blobs against the observed shipping files.
- Product remains `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, tree
  `5687cbdebc46ec6d3618d32072c4de708118b9bb`; expected package remains
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  **No production build, A10, package rebuild, or full-gate phase ran here.**
- Product profile stays
  `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f`;
  exact-six instruction projection stays
  `b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb`.
  Fourteen-phase ordering, build-once/type reuse, native49+2, zero-skip policy,
  632 canonical paths, 192 classifications and 256 cleanup inputs are retained
  contracts, not fresh executions in this packet.

## Shipping change and trust boundary

`tool-routing.mjs` verifies the root-approved direct inspector **before** each
inspection: physical path, mode, size, streamed SHA256, four allowed target
identities, exact argv/environment and the two approved absent system-library
references. It executes only
`/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/otool-classic`,
SHA256 `6beb1ad9c4fb7edafd59fddcb093f358f9a250bfe1db2db9f04ed1aacd523a69`,
with `-L` for the already selected Node, direct Git, tar and sandbox-exec targets.
Actual receipt includes PID and output hash. Exact linkage output is checked
inside the seam and existing caller comparisons remain.

Only `/usr/lib/libc++.1.dylib` and `/usr/lib/libSystem.B.dylib` for that exact
inspector gain the root-approved ENOENT metadata treatment on pinned macOS
26.4.1/build25E253. This is **not file-hash or full-OS attestation**, and does not
extend the exception to readable, user, npm, unknown or other DeveloperTools
libraries. Existing tool/reference bindings remain unchanged. Verification is
point-in-time; it does not defeat a malicious host replacing executables between
verification and exec or attest every dynamically loaded image.

Frozen typing's bare Git uses a finite 18-alias directory with no ambient PATH
tail. Git resolves to the already admitted
`/Applications/Xcode.app/Contents/Developer/usr/bin/git`, SHA256
`10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9`;
`GIT_EXEC_PATH` binds its existing 197-entry git-core closure. No new Git binary
or helper exception is introduced. All alias targets use existing external
admission entries. Separately staged native files still precede this directory,
but now reject extra entries, symlinks and changed hashes before phase dispatch;
this closes an added-native-`git` shadow route. Empty pre-stage is permitted;
mandatory native completeness remains checked separately before gate phases.
Unlisted required host commands must fail explicitly, not fall back. Full-suite
compatibility with this finite PATH has **not** been established by these tests.

The inherited OS fence denies the six exact selector paths in `TOOL-ROUTES.json`,
including `/usr/bin/otool`, `/usr/bin/git`, xcrun, xcodebuild and the two old
toolchain wrappers. Cleared environments do not remove these denials. This is
specific route protection, not a universal host-executable sandbox.

Existing resolved-write rules remain: inert outside symlink creation is allowed;
resolved writes through outside/instruction aliases are denied, as are outside
hardlinks and physical directory imports. Preopened writable descriptors remain
an explicit limitation; shipping descriptor isolation is retained. No rollback
claim follows from tar's historical denial after 216 ordinary extractions.
Original opaque authenticated Git provenance is allowed; no instruction body
was staged, checked out or copied into this packet.

## Executed author cohorts

The twelve expected groups remain byte-identical to preseal `0444f359`.
`CONTROLS.json` deliberately retains its original not-executed chronology;
actual results are separately versioned below.

| Capture | Shipping source | Result | Qualification |
| --- | --- | --- | --- |
| route-01 | 484c5c2a | 5 pass / 7 fail | Volatile inspector PID/time incorrectly participated in stable envelope equality; affected targets never launched. |
| route-02 | 6fd07337 | 11 pass / 1 fail | Actual typing helper could not import omitted `stream-five-public/current-profile.mjs`. |
| route-03 | 6fd07337 | 12 pass / 0 fail | Exact missing f5 helper dependency staged; no frozen helper change. |
| route-04 | 8b095f99 | 12 pass / 0 fail | Stronger missing-output/readable-reference and stable-field controls. |
| route-05 | fe15f1e4 | **12 pass / 0 fail / 0 not executed** | Adds actual unexecuted native-`git` shadow refusal. 08:21:53.334–08:22:00.880 UTC. |
| protocol-01 | 6fd07337 | 9 controls, script exit0 | Unchanged outer protocol; distinct from the twelve route groups. |
| protocol-02 | 8b095f99 | 9 controls, script exit0 | Same outer cohort; **not rerun on final fe15 source**. |

R01–R04 cover actual four-target linkage, changed identity/route metadata,
unknown/native-shadow routes and developer/loader/environment injections.
R05 executes the **unchanged f5 `verifyTypecheckInputs` function**, including its
one actual bare `git ls-files -z`: 300 physical inputs/6,058,848 bytes, 37,397
metadata-only indexed paths, 3,571,127 bytes of Git filename output. Its 192
classification result and helper input hashes are preserved. No build or full
product materialization was substituted for this function.

R06 exercises declared absolute Git/native-shell work with empty environments
and rejects undeclared fallback. R07's readable-library neighbor is a scoped
test injection, **not an actual system-library replacement**. R08 executes the
approved inspector then injects discarded output and confirms refusal; it is
not an unbound replacement executable. R09 performs ordinary Git tree/archive
work without instruction content. R10 obtains EPERM before execution for all
six selector routes with cleared environments. R11 retains actual write/alias
controls. R12 expects a non-clean receipt for abandoned owned work, verifies
reaping/no survivors and leaves the unrelated sentinel untouched before its
natural closure. An expected negative receipt is not a clean gate outcome.

Stable envelope comparisons omit only actual inspector PID/admission time;
binary, target, args, environment, references and output identity still match.
Intermediate source6fd's `previousDriverSha256` metadata was computed after its
previous-source field changed; that historical record is retained, not used as
the final lineage proof. Later/final seals bind the actual preceding normalized
driver bytes; every executed cohort is tied directly to committed file hashes.

## Evidence, cleanup and review request

`evidence-v2/RAW-INDEX.json` preserves 230 original report/output files (1,693,127
raw bytes) as individually hashed gzip data, including both failed attempts.
`seal-evidence.mjs` bounds each input at 8 MiB and total at 32 MiB, refuses links
and instruction filenames/content hashes, verifies raw pre/post inventories,
and never reruns product tests. `CLEANUP.json` records removal of exactly 36
protocol roots after device/inode/mode/uid verification; no signals were sent.
All route work roots had already been removed by their finalizers. Outer raw
reports remain available; no foreign process, index or private checkout changed.

Different Dirac review should check the final 37-file source closure, approved
two-reference scope, actual four inspector targets, finite Git/native routing,
unknown-route/selection denials and stable envelope exclusions. The final
author12 and intermediate protocol9 are scoped evidence, not independent
acceptance. A10 has prior separate acceptance, not a fresh result here. A new
complete release binding and explicit root release remain required before any
full gate; historical HOLDs and fixed f5/c109 inputs remain unchanged.
