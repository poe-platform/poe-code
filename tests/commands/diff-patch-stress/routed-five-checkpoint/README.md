# Historical routed-five checkpoint

This is an immutable archive of the pre-quiet-fix replay, **not postfix proof**.
The capture at `29a61222a8744ce479601ff33061a38b4a193b78` records **5/5
still-fails**: patch apply, dry-run, reverse, patch-hash, and stat timestamp.
All five fresh native observations matched the frozen observations. The raw
report, byte observations, recipe objects/hashes, native profiles/executable
identities, source hashes, dirty/index state and finalization drift are retained.

`manifest.json` maps ten byte-identical textual copies to their original `/tmp`
paths and SHA-256 values. `root-notification.txt` preserves the original root
handoff. `frozen-eighteen-failures.json` is explicitly a derived extraction of
all 18 failing rows (with original recipe objects) from the unchanged frozen
224-case benchmark; it records hashes of its read-only source files. It is not
a rerun, correction or removal of benchmark failures. No binary or native
temporary tree is archived. The preexisting replay log was not authored by the
original leaf and is not used as evidence in this archive.

## Provenance and commands

The original commands, run from `/Users/kjopek/Workspace/safe-bash`, were:

```sh
node /tmp/safe-bash-routed-five-probe.mjs
node /tmp/safe-bash-routed-five-finalize.mjs
```

These scripts are preserved as text for inspection, **not safe rerun entry
points**: they name the historical `/tmp` outputs and depend on the existing
benchmark harness and pinned binaries. Do not execute the archived copies to
overwrite the originals. A future independent reviewer owns fresh replay
artifacts and must select new destinations; this archive supplies no postfix
acceptance result. The archived report supplies the exact original launcher,
profile, recipe and cleanup details.

Verify copied artifacts without executing a replay:

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const root="tests/commands/diff-patch-stress/routed-five-checkpoint/"; const manifest=JSON.parse(readFileSync(root+"manifest.json")); for(const entry of manifest.artifacts){const bytes=readFileSync(root+entry.archive); assert.equal(bytes.length,entry.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"),entry.sha256);} console.log("10 original artifact hashes verified");'
```

The stable replay occurred August 27, 2026, 02:01:10 UTC (August 26, 2026,
21:01:10 America/Chicago). Finalization later observed concurrent HEAD
`90cbf287b8533c2dad9211d87d6cb66290a80132` and filesystem/stream source drift.
That later state is not validated by the stable `29a6122` replay. The implicated
patch/stat files and frozen harness/inputs remained equal at finalization.

## Limits and ownership

The native dry-run fixture contains an empty `tmp` directory because only its
native profile assigns that scratch location. This is a benchmark-owner Curie
fairness issue, separate from patch status, quiet output and preservation of
source bytes. No phantom VFS directory, benchmark expectation edit, or claimed
four-row exact closure is authorized by this archive.

The bounded patch leaf owns this archive and the quiet source/author tests.
Metadata source/tests remain with their parallel owner. Independent final
review belongs to `../routed-five-review/`, not this directory. Benchmark files
are read-only inputs. All copied source artifacts are baseline/history only.

Original 206/224 (18 failures), baseline just-bash 3.4.2 155/224, and initial
defective-oracle 191/224 versus 146/224 remain separate. Original 3750/3758 and
revised 3758/3758, historical 14/30, and table-text cohorts are untouched; none
was rerun to create this archive. No clean whole-product checkpoint, 72-hour
completion, full utility parity or superiority is claimed.
