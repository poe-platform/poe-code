# Migrating a SafeJS checkpoint

Use ordinary `restore(snapshot, { source })` to continue the same program. Use
explicit migration when the program or execution semantics must change.
Migration does **not** reinterpret old stack frames, edit a source hash, or run
the original program again. It creates a new continuation checkpoint containing
application state you deliberately select and an archive of prior effect history.

## Stop and reconcile first

1. Stop the original execution, including other processes that can resume it.
2. Keep the original source and checkpoint as immutable recovery evidence.
3. Inspect the checkpoint with its original executable `.ajs`/`.safejs` source:

   ```sh
   poe-safe-js migrate old.json --from original.ajs --inspect
   poe-code harness migrate old.json --from original.ajs --inspect
   ```

4. Use your external operation records to reconcile **every** `unresolvedCalls`
   entry. This includes cancelled operations and re-issuable reads, not just
   operations marked as effects. Do not assume a timeout means nothing happened.
5. Ensure outstanding operations and callbacks cannot continue after migration.
   Only then attest `quiescent: true` for the inspection's `checkpointDigest`.
   SafeJS cannot stop another process, verify an external transaction, or
   authenticate this assertion from JSON alone. The receipt is trusted host input.

The journal is complete through the saved checkpoint, not necessarily through
the time you stopped the old process. Account for work completed after that
checkpoint using external records when selecting state. A stopped writer alone
does not prove that checkpoint-era counters include every completed operation.

The digest covers the entire portable checkpoint. Reordering object keys does
not change it; changing recorded values does. A receipt for a different checkpoint,
missing resolutions, duplicate resolutions, and unrelated call IDs are rejected.

## Write the continuation and plan

The new program starts at its beginning and reads the selected state from
`import.meta.migration`. Write only the work that should happen **after** the
transition. For example, after externally confirming that three items completed:

```js
import { appendFile } from "fs";

export default async function (frontmatter) {
  const state = import.meta.migration;
  for (let index = state.completed; index < state.items.length; index += 1) {
    await appendFile("results.txt", state.items[index] + "\n");
  }
  return state.items.length;
}
```

Create `migration.json` with explicit `state` and `reconciliation` fields:

```json
{
  "state": { "completed": 3, "items": ["a", "b", "c", "d"] },
  "reconciliation": {
    "checkpointDigest": "COPY_THE_64_CHARACTER_DIGEST_FROM_INSPECTION",
    "quiescent": true,
    "calls": []
  }
}
```

An empty `calls` list is valid only when inspection reports no unresolved calls.
Otherwise include exactly one resolution per unresolved `id`, for example:

```json
{ "callId": "recorded-run-id:4", "disposition": "fulfilled", "value": null }
```

Other forms are `{"callId":"...","disposition":"rejected","reason":"..."}`
and `{"callId":"...","disposition":"not-performed"}`. Use the latter only
after confirming non-performance, not merely requesting cancellation. Outcomes
in file receipts are JSON data. They are archived as evidence; they do not execute
old callbacks or automatically determine application state.

Validate and publish a **new** checkpoint path:

```sh
poe-safe-js migrate old.json --from original.ajs --to continuation.ajs \
  --plan migration.json --output next.json --dry-run
poe-safe-js migrate old.json --from original.ajs --to continuation.ajs \
  --plan migration.json --output next.json
poe-safe-js continuation.ajs --restore next.json --snapshot current.json --fs
```

For a paired harness, use `poe-code harness migrate` with the same arguments and
the actual `.ajs` paths, then
`poe-code harness run continuation.md --snapshot-path next.json --resume --fs --yes`.
The root command supports global `--dry-run`. Migration itself never starts
either script or grants filesystem, environment, agent, or network capabilities.
Paired runs retain completed migrated checkpoints, unlike ordinary completed
harness runs, so their lineage survives and a subsequent `--resume` replays rather
than starts fresh. Deliberately starting without `--resume` still discards that
checkpoint; retain recovery copies before doing so.

Output publication writes and syncs a private temporary file, then uses an
exclusive hard link in the output directory. Existing files and symlinks are never
overwritten, and incomplete writes are not published as checkpoints. The directory
must already exist and support hard links. A killed process can leave a private
`.safejs-migration-*.tmp` file; inspect and remove such stale files only after
confirming their writer is no longer running. Keep the original checkpoint.

## SDK

```js
import { readFile } from "node:fs/promises";
import { inspectSnapshotMigration, migrateSnapshot, run } from "poe-code/safe-js";

const snapshot = JSON.parse(await readFile("old.json", "utf8"));
const source = await readFile("original.ajs", "utf8");
const targetSource = await readFile("continuation.ajs", "utf8");
const inspection = inspectSnapshotMigration(snapshot, { source });

const plan = JSON.parse(await readFile("migration.json", "utf8"));
const migrated = migrateSnapshot(snapshot, { source, targetSource, ...plan });
const result = await run(targetSource, {
  snapshot: migrated,
  entryPointArgs: []
});
```

Supply the target program's required modules and bindings to `run`; omit
`entryPointArgs` for a top-level script. Migration does not inherit old capabilities.
`importMeta.migration` is reserved when running a migrated checkpoint; other import
metadata remains available. State is copied through the portable graph codec:
cycles, shared references, maps, sets, and special primitive values are supported;
live closures, promises, generators, and accessor properties are not migration
state. Select data representing their intended continuation instead.

`migrateSnapshotFile(options)` provides the exact CLI file workflow. Required
options are `snapshotPath` and `sourcePath`. Set `inspect: true` for inspection
without writes; otherwise supply `targetSourcePath`, `planPath`, and `outputPath`.
`cwd` selects path resolution, and `dryRun: true` validates without publication.
It returns `inspection` and, for a migration, `outputPath` and `dryRun`.

## What carries across the boundary

- The new checkpoint contains current execution semantics, the target source
  hash, selected state, and a fresh active replay journal.
- Archived ancestry retains prior source hashes, execution markers, complete
  host-call journals, digest-bound receipts, and transition targets. Subsequent
  success/failure/budget checkpoints preserve it, as do additional migrations.
- The new run has fresh execution frames, promise scheduling, clock, and random
  initialization. Its own snapshots make subsequent replay deterministic.
- Completed predecessor effects are never automatically invoked by migration or
  replayed against new source. The continuation can deliberately call an old
  operation again; SafeJS cannot infer business-level deduplication from code.
- Format-1 and format-2 dumps with complete version-1 replay journals and `jobs-v1`
  through `jobs-v8` markers are accepted. New checkpoints use format 2. Unknown formats, missing histories, malformed
  identities, and unportable checkpoints fail closed. Keep the original runtime
  for checkpoints outside that explicit compatibility envelope.

Snapshot validation and host resource budgets still apply. This is a controlled
application-state transition, not automatic stack migration or an assertion that
arbitrary edited programs have equivalent behavior.
