# S3 fixture split — author checkpoint, August 27, 2026

## Decision and commits

Root approved the exact fixture-only migration after the bounded read-only
classification. Ownership remained the existing remote workflow test and this
new subtree. No production, contract, root configuration, other fixture or
private poe-code path was modified.

- Historical seal: `12782961ce72a7b84f9043bb1f0d75456cf6c5d1` (five evidence files,
  committed before fixture edits).
- Fixture/regression code: `8b19cf4fad31ed4c11ca76bcb0cc38ef1a5ce508` (six explicit
  owned paths; no raw evidence mixed into this code commit).
- Fresh validation outputs and this report are a separate evidence-only commit.
  Root assigns an independent reviewer after this checkpoint; none is claimed here.

## Old versus new

The old S3 test unconditionally expected `FsError ENOTSUP` from
`rmdir("/work/scratch/nested")`. Its exact bytes remain in
`historical/remote-safe-workflows.test.ts.data`, authenticated against b494675c.
The original raw frozen failure is still `Missing expected rejection.`, at
original assertion line 58 and decoded TAP line 109632. `historical/manifest.json`
contains exact paths, encoded/decoded SHA256 and the routing identity. The raw
repository artifacts and original result were not changed or relabeled.

The new S3 case explicitly requires `snapshotRmdir === true`, successful removal,
and exactly one mutation: `deleteObject({Bucket:"safe-workflows",
Key:"work/scratch/nested/"})`. There are zero child DELETEs, extra writes or
compensating mutations. The entire remaining object snapshot (bodies, metadata,
ETags) must equal the prior snapshot minus only that zero-byte marker. Both
parent directories and `/sentinel` bytes `[255,3]` remain. Only in this quiescent
fixture does the nested directory become ENOENT after success.

Inputs are unchanged: recursive mkdir of the same nested path; the same 4099-byte
`binary` helper (byte index modulo 256); named-file write and `rm`; sentinel
write; identical empty readdir and removed-file checks. The four other workflow
test bodies are byte-for-byte unchanged. Stock WebDAV retains the exact
ENOTSUP/syscall/path assertion, mutation count, snapshot equality, all three
directory checks and sentinel check. It additionally rejects accidental snapshot
profile advertising. No either-outcome assertion or capability weakening exists.

The snapshot helper now asserts that mock object keys are strings and bodies
are Uint8Array, narrowing transport-level optional/stream types without changing
the mock command inputs or bytes.

## Evidence preservation

At author start the only surviving prior `/tmp` artifact was
`/tmp/s3-routed-review-d4EdKC.md`. It was copied byte-for-byte and sealed as
`historical/classification-report.md.data` (SHA256
`2ac8fccf4f61899f80c06785d51749c0e8f87ca222a8632e02a7d4256862a2d4`).
The old classification archive/raw replay logs had already been cleaned; they
are unavailable and were **not reconstructed as historical raw**. The surviving
original `/tmp` report remains untouched. Existing authenticated repository raw
failure evidence supplies the original frozen result, not newly generated TAP.

All four new runs below are explicitly **fresh author replay**. Their actual TAP,
stdout/stderr, commands, hashes, source revisions, dirty/committed state and
before/after git status are preserved in their respective `report.json` and
`.log.data` files. Captured `.data` files are not TypeScript source/test inputs;
no discovery exclusions or root configuration edits were added.

## Commands and results

From repository root, each command uses a new non-overwritable output directory:

```sh
node tests/stress/adapters/s3-snapshot-profile/run.mjs tests/stress/adapters/s3-snapshot-profile/evidence/author-run-001
node tests/stress/adapters/s3-snapshot-profile/run.mjs tests/stress/adapters/s3-snapshot-profile/evidence/author-run-002
node tests/stress/adapters/s3-snapshot-profile/run.mjs tests/stress/adapters/s3-snapshot-profile/evidence/author-run-003
node tests/stress/adapters/s3-snapshot-profile/run.mjs tests/stress/adapters/s3-snapshot-profile/evidence/committed-run-001
```

| Fresh run | Migrated/control cohort | Scoped typing | Original assertion replay |
| --- | --- | --- | --- |
| author-run-001 | 48 pass, 0 fail | exit 2, TS2322 snapshot type mismatch | 0 pass, 1 fail, exit 1 |
| author-run-002 | 48 pass, 0 fail | exit 0 after key/body assertions | 0 pass, 1 fail, exit 1 |
| author-run-003 | 49 pass, 0 fail | exit 0; added HTTP false-capability/no-request guard | 0 pass, 1 fail, exit 1 |
| committed-run-001 | 49 pass, 0 fail | exit 0 | 0 pass, 1 fail, exit 1 |

All runtime cohorts have zero skips, cancellations and TODOs. The first typing
failure is retained, not discarded or called a passing candidate. The old
assertion is executed from its preserved bytes against each fresh committed
source freeze and fails with the exact original diagnostic. It is a separate
negative comparison cohort, not a pass or a replay of the original historical
full gate. Combining the final TAP streams without qualification would yield
49 pass / 1 fail, not an all-green original cohort.

The committed run freezes actual revision
`8b19cf4fad31ed4c11ca76bcb0cc38ef1a5ce508`, with no owned tracked code diff.
Its 49 checks comprise six workflow tests, twenty new fixture/preservation/
tamper/capability guards, and twenty-three unchanged selected controls:

- S3 marker controls: 10/10 (observed direct/nested byte children and markers,
  exact marker-only success with conditions absent/present, late-child survival,
  pre-abort/read-only/root protection).
- Snapshot inspection controls: 9/9 (pagination, incomplete LIST, disappeared
  marker, ambiguous representation, implicit-marker refusal, late byte/nested
  marker/child preservation).
- Unknown authority refusal: 1/1, with no destructive publication.
- Stock WebDAV refusal/race controls: 3/3; no collection DELETE.

New tamper guards reject missing/wrong/extra DELETEs, child DELETE even if final
bytes are restored, compensating PUT, marker retention, missing parents,
changed remaining bytes/metadata/ETag, missing/nonempty marker and observed
descendants. The HTTP construction control checks conditionalPut/Copy/Delete
remain false without verification, atomicRename remains false, and no request
is issued. This is not live HTTP/provider acceptance.

Each test child uses `TSX_DISABLE_CACHE=1`, Node v22.22.2 on Darwin arm64,
`--import /Users/kjopek/Workspace/safe-bash/node_modules/tsx/dist/esm/index.mjs`,
`--test --test-reporter=tap --test-concurrency=1`, and exact file/name filters
recorded in the run report. Existing tsx is 4.23.12. Scoped typing runs
`node /Users/kjopek/Workspace/safe-bash/node_modules/typescript/bin/tsc -p tsconfig.scoped.json`
inside the isolated copy; its captured config extends the frozen root config,
uses noEmit, and includes only the changed fixture and new TS tests/helper.
No build, shared dist, full gate, downloads, real bucket or service runner ran.

## Input hashes and source status

`historical/author-start-inputs.json` records 224 source/config/helper/control/
fixture input hashes at author start. Comparing it to the committed replay
confirms all **223 non-fixture inputs unchanged**. Each replay captures its full
input inventory and checks working and isolated bytes again before cleanup.

| Input | SHA256 |
| --- | --- |
| Original fixture | `e8f5e47e15f8e601b08176954533eacff02102c4910d4c6da52547546989f4e5` |
| Migrated fixture | `c82963893dd92fb08c2b684d8f359e1ecc94d8cfb7f38d79aee6095e5a41d689` |
| src/fs/s3/filesystem.ts | `9ac11951d681db45cee474568ca46d227cfb5bbd9b0d5ce2d6c176d0c4f94833` |
| src/contracts/filesystem.md | `4c0c83ac7477776455055b32370844453ee7521467f02e5304bff23901df06b2` |
| tests/fs/conformance/fixtures.ts | `0e54d28e8f669f60cf0f38247ae30da5d5b864a44216c8b10f9730f93b8be4f0` |
| tests/fs/webdav/mock.ts | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |
| package.json | `2127bbfed020aeb7873462ae65224e6ee73069425c878aa2ceee9816b2191245` |
| package-lock.json | `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b` |
| tsconfig.json | `86adf86ecb49df322e08438453c00ef14d922c0785f7d879498b1fc8cb48e5d4` |
| tsconfig.build.json | `b57d3e5aab1f1f7ab7a70f275183ea6de255e65a2c40a0047c08d97769a1a16e` |

Committed-run report SHA256:
`1fe8f6d7841853b0e4ff1f45d90f91cb7c2237b111e8caf15f3246be26cedf0b`.

All four task-owned fresh temporary archives were removed and report
`cleaned: true`. Concurrent metadata-profile edits, benchmark evidence,
cleanup/typecheck review artifacts and existing native scratch directories
were preserved. Each run records status before/after; the index was empty at
those observations. Only explicit owned paths are staged and committed.

Historical b494 RAW UNQUALIFIED 16,520 pass / 307 fail / 13 skip remains unchanged.
This is a reviewed-scope migration and author checkpoint, not independent review,
deployed-provider support, full current acceptance or superiority evidence.
