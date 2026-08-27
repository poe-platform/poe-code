# Author replay archive

This is an evidence-only archive of /tmp/safe-bash-author-constructor-final-20260827-K4tcZj.
REPORT.md and all original non-snapshot files, plus both snapshot/probe.mjs files,
are preserved byte-for-byte. ARCHIVE.json records their original byte sizes and
SHA-256 hashes. SHA256SUMS seals every archived file except itself.

Both runs are retained: narrow author controls 20/20; unchanged original43
38 positives + 5 controls; original source-loss guards 4/4; required guards 49/49.
The final replay is at e9783ecd393efd8af1b892c94f73a863d28650a7. The second run
followed unrelated command changes after the first. These are AUTHOR results,
not Dirac acceptance, a global typecheck, or whole-product validation.
No tests were rerun while archiving. Historical cohorts and fixtures are untouched.

## Verification and reproduction

Run shasum -a 256 -c SHA256SUMS from this directory. Command JSON files retain
exact argv, absolute executable/cwd, timestamps, statuses and raw-output hashes;
before/after manifests retain all source and fixture hashes. Raw stdout retains
per-case results and provider traces. Original absolute paths intentionally remain.

Full snapshots, dependencies and temporary namespaces are omitted. To reconstruct
a run elsewhere, materialize the tracked inputs listed in its before.json from
its recorded HEAD, apply its snapshot-overrides.patch if present, and verify every
input hash. Copy that run's snapshot/probe.mjs to the reconstructed root, supply
the recorded development tooling, and run the commands from REPORT.md there.
The compact patches capture only differences from that run's recorded commit;
they are evidence, not changes to current production. ARCHIVE.json lists them.

run.mjs is the exact original historical harness, not an archive replay launcher:
it snapshots the live repository and chooses rounds based on summary.json. Do
not execute it in this immutable archive. Use a fresh output location for replay.

The original immutable reference is
tests/fs/mount/identity-compatibility-review/evidence/author-integration-eab1d48/manifest-before.json.
The historical original31/38, qualified38/38 and previous raw failures remain
separate. Earlier S3 constructor evidence remains in the parent directory.
