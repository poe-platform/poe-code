# Independent archive native-prerequisite verification

## Result and limits

**All six original missing-prerequisite failures reproduce, then all six pass
with setup alone corrected on the same frozen historical source/test inputs.**
Both affected files ran in full: 11 cases/profile, no filters or hidden skips.

| Profile | Cases | Pass | Fail | Skip/TODO/cancel | Process exit |
| --- | ---: | ---: | ---: | --- | ---: |
| Missing hardcoded GNU executable | 11 | 5 | 6 | 0/0/0 | 1 |
| Exact pinned executable added | 11 | 11 | 0 | 0/0/0 | 0 |

These are **two separate observations**, not 22 unique tests or a new full gate.
The six original full-gate rows remain historical environment failures. No
current-HEAD, complete archive128/177/196, whole-product, superiority or global
typecheck claim follows. No remaining configured semantic failure appeared in
these eleven cases. Other tests/cohorts were **unexecuted**, not passes or skips.

## Exact historical failures

The source of record is the full-gate report's native-prerequisite section and
its `classification.json`/original TAP, revision
`e36dab2b6abc216ddc89e5786a0eba76f08a1722`. All six originally had `ENOENT` while
reading the ignored, hardcoded GNU executable. Raw original diagnostic excerpts
with line numbers and the parent evidence hashes are preserved here.

| Exact test name | Original TAP not-ok line | New missing → configured |
| --- | ---: | --- |
| pinned GNU cross-readability BOTH directions plain | 648 | ENOENT fail → pass |
| pinned GNU cross-readability BOTH directions gzip | 665 | ENOENT fail → pass |
| pinned GNU legacy long-name and long-link records are read without data conversion | 682 | ENOENT fail → pass |
| native -C, files-from, excludes, selected strips agree on safe common fixtures | 699 | ENOENT fail → pass |
| pinned GNU rejects forward hardlinks but continues; virtual rejects fail-fast | 716 | ENOENT fail → pass |
| I05 fixed local nanoseconds and global precedence have separate virtual and native profile assertions | 320 | ENOENT fail → pass |

The first five belong to `tests/commands/archive/native.test.ts`, **not** the
similarly named `tests/commands/archive-stress/native.test.ts`. I05 belongs to
`tests/commands/archive-stress/pax-independent/controls.test.ts`.

## Snapshot identity and checkout qualification

- Historical commit: `e36dab2b6abc216ddc89e5786a0eba76f08a1722`.
- Historical Git tree: `a73200db83a3e9c75d1138480c10c5c5e57bb16d`.
- Frozen-manifest SHA256:
  `0b5610448c655b85414a5291559bbec2a4ee10e41d107a6abd4a7693833577b2`.
- Git-blob/source qualification manifest SHA256:
  `48ee7d930d0e0e4e29d7c2acafe594bde63118209f7f0a1f8d5899d4b33cd1b2`.
- Retained tree: `/tmp/safe-bash-archive-prerequisites-e36dab2-20260827/tree`;
  actual macOS path is `/private/tmp/safe-bash-archive-prerequisites-e36dab2-20260827/tree`.
- 180 Git-blob inputs: all 173 historical `src/` files, the two tests, their two
  support files and three root package/config files. Another 60 regular files
  supply only tsx4.23.12/esbuild0.28.2/Darwin-arm64-esbuild0.28.2. Total snapshot:
  **240 regular files / 23,573,939 bytes**, no symlink aliases or build output.

Live HEAD moved from `a6a1a44fbec63c4b5752c76398e00c2738448223` at preparation
to `9ad8165dc263f492a664d49d828b69ee61667766` at run completion. Its unrelated
dirty/untracked state and empty index are recorded before/after. Thirty of the
180 live paths differed from historical blobs at capture; none supplied product
bytes to the snapshot. The selected tests/helpers/fixtures and archive source
matched historical bytes, but that does not make this a current runtime gate.

| Frozen test/support path | SHA256 |
| --- | --- |
| tests/commands/archive/native.test.ts | `a7bde7f866349006aa5fce9f8615a4190ee279212e88fdd2a8568f45b88f3e45` |
| tests/commands/archive/helpers.ts | `7a9e593f5fa7a9e003c4ee9d481df072c0acb17b4a46ee2db321356833a819e0` |
| tests/commands/archive-stress/pax-independent/controls.test.ts | `1e64cbc1953b50846b5af1448cbe2dcb3d578b82d124e6e8e0967dd938befa56` |
| tests/commands/archive-stress/pax-independent/fixtures.ts | `3abeb1283fe401794383d366087e29589fbe38f8bef22164933785ba82d87673` |

Per-file source Git object IDs and every copied dependency hash are in
`evidence/source-git-blobs.json`, `dependencies.json`, `frozen-manifest.json`
and `after-manifest.json`. No live build, source patch or config change was used.
The final manifest differs only by the added 456,096-byte pinned executable.

## Actual native setup and invocation

The existing primary is
`tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`, GNU tar1.35, SHA256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
This same path/hash is documented by the original author128 evidence,
independent177 report and independent196/deletion evidence. All inspected
historical evidence hashes remained unchanged; their earlier failures/profile
corrections are not reinterpreted by this replay.

GNU_TAR is required by the **new setup runner**, but neither affected existing
test honors that variable. The native prerequisites are hardcoded and hashed.
We copied the accepted primary into that location in the isolated regular-file
tree. The primary itself remained read-only and was rehashed unchanged.
Both profiles used identical env/argv with explicit `GNU_TAR` target and
`PATH=/usr/bin:/bin`; setup changed only the one missing file. Thus an environment
variable without the required file is not falsely presented as sufficient.

The configured trace records **17 paired native calls: 14 GNU, 3 BSD**. Baseline
records zero native calls because the missing file fails before dispatch.
The calls include both plain/gzip PAX creation, native reading/extraction of
virtual output, legacy GNU creation, ustar/files-from/strip positive oracles,
the forward-hardlink negative oracle, and I05's GNU/BSD profiles. Six GNU calls
cover the two cross-readability directions for plain/gzip. The forward-hardlink
native call intentionally returns **2**, and its unchanged test passes; no
blanket requirement that every native command exit0 was imposed.

BSD remains frontend3.5.3/libarchive3.7.4, SHA256
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
I05 preserves the GNU/virtual global-mtime value and the distinct BSD native
value, plus separate literal dot-underscore presentation. It does not convert
BSD behavior into virtual acceptance or claim metadata restoration/parity.
Native version stdout/stderr, absolute paths and hashes are in `prepared.json`;
exact dispatch/options/status/raw output/fixture archives are in the trace.

Apple gzip479 SHA256:
`7bd218bc6b12fced475163901547a796736f72f99533cbec60eea150ed21afa3`;
gunzip479 SHA256:
`5ba665e19226838310b102c16b6cebed89f2048ccfc5bba2e8083deb80acec73`.
Node is v22.22.2/darwin-arm64, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
OS/dylibs and tar's gzip descendants are external, not independently
syscall-traced or a hermetic OS attestation. Trace success-stderr unavailable
through execFileSync's return API is explicitly null, not asserted empty.

## Unchanged semantic controls and bounds

I01–I04 and I06 pass in **both** profiles, including malformed PAX length,
framing, checksum/truncation errors, essential layout/path rejection, budgets,
literal sidecars, shared-write hardlinks and unsupported-no-copy behavior.
Their existing plain/gzip loops, diagnostics, byte/namespace assertions and
native-profile expectations are unchanged. `readonly-scope-check.json` verifies
13 archive/test/profile files against original blobs and capture hashes, plus
ten historical evidence files. No semantic coverage or parser assertion was
removed. This is not a separate all-parser or portable-stdio compatibility gate.

Baseline ran 2026-08-27T07:38:12.954Z–07:38:13.804Z; configured ran
2026-08-27T07:38:14.039Z–07:38:14.751Z. These are operational durations, not
performance claims. Both fit the prepublished 120-second process deadline,
60-second case ceiling and 16 MiB output cap. Original 8/10-second native bounds
remain intact. Neither process required killing; both owned groups were absent
on completion. No native fixture directories or TMPDIR contents remained.
Snapshots and captured safe archives are intentionally retained.

Three setup guard subprocesses each returned a clear hard failure for unset
GNU_TAR, missing executable, or mismatched binary hash. No install, skip or
fallback occurred. One early runner-only preparation defect expected Apple's
gzip version on stdout; it failed **before snapshot/tests**. The original
output is preserved in `preparation-attempt-1.log`; the owned runner now records
native stdout and stderr correctly. No existing expectation was changed.
There were 12 external version probes including initial inspection, failed
preparation, corrected preparation and copied-GNU verification; together with
17 test native calls, the declared explicit native-call total is **29**.

## Handoff

`README.md` supplies explicit-path, version/hash-validated reproducible setup,
check and two-profile runner commands. `PLAN.txt` preserves the plan published
before tests. Raw logs and per-file manifests are under `evidence/`; the final
owned-artifact inventory is `SHA256SUMS.json` (self excluded).

Only new owned files and isolated temporary files were written. No stage/commit,
production change, existing-test/config/report edit, full-gate rerun, native
installation, WebDAV/auth/private-poe-code activity or cold-typecheck extension.
The separate owner's eleven pre-existing `.mts` gaps among thirty cold-review
gaps remain outside this task. Root may use this setup evidence for a future
explicitly authorized provisioned gate; this leaf stops at the bounded handoff.
