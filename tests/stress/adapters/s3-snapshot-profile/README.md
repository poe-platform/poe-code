# Approved S3 snapshot-marker fixture migration

This changes only the expected profile of the S3 named-file cleanup fixture.
Its commands and input bytes are unchanged. Stock WebDAV retains its exact
ENOTSUP/path/syscall rejection and unchanged-state assertions. Other workflow
cases are byte-for-byte preserved.

S3 requires explicit `snapshotRmdir: true`, successful removal, one DELETE of
the exact empty marker, and equality of every remaining object body, metadata
and ETag. It retains both parent directories and the sentinel. The absence
assertion applies to this quiescent fixture, not to concurrent-child semantics.
The shared fixture assertion rejects missing/extra/wrong-key mutations,
observed descendants and preservation failures; its tamper tests exercise those
guards rather than claim new production behavior.

`historical/` is an immutable pre-edit evidence seal, committed separately.
Its `.data` files are captured source/prose, not canonical TypeScript inputs.
The prior investigation's raw /tmp results were already cleaned; only its
surviving report and authenticated existing-repository failure references are
available. No raw history is reconstructed and no original result is relabeled.

Run the bounded author checks from the repository root into a NEW output path:

```sh
node tests/stress/adapters/s3-snapshot-profile/run.mjs tests/stress/adapters/s3-snapshot-profile/evidence/author-run-001
```

The runner freezes committed product/config/helper/control inputs and records
the exact fixture/guard overlay hashes and dirty state. It replays the unchanged
old assertion as a **fresh expected failure**, then runs six migrated/unchanged
workflow cases, twenty new preservation/tamper/capability guards, twenty-three unchanged
selected S3/WebDAV/authority controls, and a scoped no-emit TypeScript check.
The S3 control under `rmdir-real-service/snapshot-profile` is a mock-based test;
no service runner, download, real bucket, private runtime or build is used.
All fresh TAP/stdout/stderr are stored as `.data` with hashes in `report.json`.
Output directories cannot be overwritten; only the runner's fresh temporary
archive is cleaned. The surviving original /tmp report is left untouched.

These are bounded author results, not independent review, deployed-provider
acceptance, full-gate completion or superiority evidence. Historical
16,520/307/13 remains RAW UNQUALIFIED. Root assigns a different reviewer.
