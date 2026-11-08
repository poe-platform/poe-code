# Combined S3 snapshot-profile integration checkpoint

August 27, 2026. Source is frozen at
`04879692a66d88eee129b8ffd6e7ca93c7a9476a`, including S3 implementation
`5660248b1ff89572a6164d0b0c7bd22d03630d9b` and the wrapper safety change.
Live HEAD had already advanced to `bf8b5540fd2d222a273922b12d347f3aa5d07d3b`
when inspected; it was not substituted for the requested combined source.

## Observed original79 result

**78 pass / 79 tests / 1 fail / 0 cancelled / 0 skipped / 0 TODO.**
The matrix exits **1**. The sole remaining failed row is:

`webdav: create, copy, append, inspect and remove files`

It retains the actual `rmdir` ENOTSUP failure at `/work/scratch/nested`.
No atomic WebDAV extension or unsafe collection DELETE was enabled.

The preserved built `debb29e` baseline is **77/79**, not overwritten. Exactly
the S3 create/copy/append/inspect/remove row changes from failure to success;
all original 79 names/assertions and inputs are retained. The earlier unbuilt
58/79 capture and its missing-worker explanation are also unchanged. Separate
preflight controls pass **30/30**, and the actual fixture installs
`agentCommands()` with all **22 required names** executable. No literal default
command-count requirement is introduced.

This is an explicit **contract/production capability-profile delta**, not a
fixture waiver or a claim of unchanged semantics. The approved
`snapshotRmdir: true` profile permits snapshot-empty explicit-marker deletion
without promising logical-directory absence, marker-instance/ABA protection or
rollback. S3 uses that declaration without a new constructor option; mount
exposes it and overlay refuses unsafe snapshot-upper whiteout publication.
`evidence/contract-profile.diff` retains the contract change separately.

## Separate six-test integration cohort

**6/6 pass**, no cancellations/skips/TODOs. Frozen build and scoped strict
TypeScript checking both exit zero. These six are not added to the 79 denominator:

- Four actual `S3FileSystem`/Shell flows: `rmdir` and `rm -d`, each direct and
  mounted, inject a nested binary child at the public mock DELETE boundary.
  Each confirms one exact marker-key DELETE, missing marker afterward,
  preserved child bytes through both VFS and actual Shell `cat`, and a still
  visible logical directory. Mounted snapshot-profile disclosure is checked.
- One quiescent aggregate Shell flow removes two explicitly created markers
  using the two commands and confirms their exact keys and directory absence.
- One actual aggregate Shell flow through mounted readonly S3 denies both
  commands, retains the explicit marker and issues no transport DELETE. It
  separately asserts the typed direct readonly error.

The tests reuse existing `withFixture("s3")`, actual `agentCommands()`, actual
S3 adapter and unchanged MockS3Client. Only the new isolated late-child tests
temporarily wrap their own mock instance's public `deleteObject` method to
insert a child before calling the original implementation. This is disclosed
test instrumentation, not an original-fixture or mock-source edit. The marker
really is deleted by that original mock method. No service, dependency install,
download, duplicated unit catalog or production-source edit is part of this phase.
These tests do not prove MinIO/AWS behavior, external-writer safety for unrelated
overlay operations, or full product completion. Service evidence stays with the
S3 author; different-agent verification remains root's next step.

## Exact commands and source binding

Commands actually used, from the repository root:

```sh
node tests/integration/adapter-tools/remote-rmdir/capture.mjs combined-0487969 04879692a66d88eee129b8ffd6e7ca93c7a9476a debb29ead94ae387f359d9d04b333ee4380f88d6 debb29ead94ae387f359d9d04b333ee4380f88d6
node tests/integration/adapter-tools/remote-rmdir/combined-shell/verify.mjs evidence
```

Both build the archived committed source before execution, never copy live
`dist`, and verify original inputs before/after each subprocess. The first
records original79 and preflight raw output in `../combined-0487969/`. The
second extracts those same hash-checked source/input/helper archives, adds only
`snapshot.test.ts`, and records its exact subprocess argv/cwd/times/statuses in
`evidence/`. Evidence directories are never overwritten. For another run, use a
new cohort name. Existing local Node/tsx/TypeScript tooling is reused and recorded;
entire installed dependency trees are not frozen. No whole-repository tests run.

Runner cleanup is the recorded `rmSync(snapshot, { recursive: true, force: true })`
on its own newly created snapshot only. `evidence/cleanup.json` confirms the
new-test snapshot no longer exists. The matrix snapshot
`.archive-LvNq4F` was separately observed absent after its runner's finally
cleanup. All temporary native roots are confined to owned snapshots; no other
owner's native artifacts are removed. Raw output and runner hashes are retained.

| Fingerprint | SHA-256 or Git tree |
| --- | --- |
| Combined committed `src` Git tree | `f7479a1c8d893bb25eee5ca26d2d0a5efed0a157` |
| Source/configuration manifest | `4fd795e7c72a92f6791b502fc6e094cf80a8181531bb3f2560329c790d06e932` |
| All original79 source/input/helper manifest | `1eb1f97daa3e1125199cdf14c1e31d9cb9cd50a66bcd947b4bbf866a4e132a30` |
| Original matrix/fixture/preflight manifest, unchanged | `6f259e4705e7e504dec6849c8ef1c997829e0e8bedaf9d95fd2e3c271ae7cf15` |
| Original WebDAV helper manifest, unchanged | `d636e8cacb636e08d57d45d0d1a33432cc6f9e50c1d18ea3145c907b5a876e18` |
| Original `fixtures.ts`, unchanged | `127a6910a2733d6b6df01285d37d5c90ccbeeeefda40e0869dc633ef8f6d14e5` |
| Original `matrix.test.ts`, unchanged | `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d` |
| S3 `MockS3Client` source, unchanged | `99655664c7a52c595dc1ec4e5d461e4c002a0c9ba60d222ded078e5b9780841e` |
| WebDAV mock source, unchanged | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |
| New six-test file | `1a0cfacea4533e3307f0801aa728a2ed2a898b43b671450c3274d7ebf4ced25c` |

`evidence/provenance.json` independently compares exact original and combined
Git blob bytes for the matrix, fixture, preflight implementation and controls,
S3 mock and WebDAV mock: **all unchanged**. The source archive hash is
`afc3190a03b9a6d3b54e6e8944ff1c59069ea6fed32e60f06f017dbcf2afcb54`;
input/helper archives retain their baseline hashes. Manifest fingerprints use
the capture runner's SHA-256 of `JSON.stringify(entries)` in recorded order,
including group/revision fields. No helper delta is hidden in this cohort.
