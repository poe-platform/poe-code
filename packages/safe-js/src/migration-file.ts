import { hostFs, hostCwd } from "#safe-js-platform";
import {createFsBridge, type FileSystem} from "@poe-code/safe-fs/core";
import {fsCodec} from "./modules/fs-codec.js";
import path from "./modules/paths.js";
import { hasOwnErrorCode } from "./error-codes.js";

import {
  inspectSnapshotMigration,
  migrateSnapshot,
  type SnapshotMigrationOptions
} from "./migrate.js";
import type { SafeJSSnapshot } from "./restore.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";

export type SnapshotMigrationFileOptions = {
  adapter?: FileSystem;
  snapshotPath: string;
  sourcePath: string;
  targetSourcePath?: string;
  planPath?: string;
  outputPath?: string;
  inspect?: boolean;
  dryRun?: boolean;
  cwd?: string;
};

export async function migrateSnapshotFile(options: SnapshotMigrationFileOptions) {
  const adapter = options.adapter;
  const io = adapter ? createFsBridge(adapter, {codec: fsCodec}) : hostFs;
  const readFile = io.readFile.bind(io);
  const cwd = options.cwd ?? hostCwd();
  const resolvePath = (value: string | undefined, label: string) => {
    if (typeof value !== "string" || value.trim().length === 0)
      throw new TypeError(`Migration requires ${label}.`);
    return path.resolve(cwd, value);
  };
  const snapshotPath = resolvePath(options.snapshotPath, "a snapshot path");
  const sourcePath = resolvePath(options.sourcePath, "--from <original.ajs>");
  if (
    options.inspect &&
    [options.targetSourcePath, options.planPath, options.outputPath].some(
      (value) => value !== undefined
    )
  )
    throw new TypeError("Migration --inspect cannot be combined with --to, --plan, or --output.");
  const outputPath = options.inspect
    ? undefined
    : resolvePath(options.outputPath, "--output <new-checkpoint.json>");
  const targetSourcePath = options.inspect
    ? undefined
    : resolvePath(options.targetSourcePath, "--to <continuation.ajs>");
  const planPath = options.inspect
    ? undefined
    : resolvePath(options.planPath, "--plan <migration.json>");
  for (const filepath of [sourcePath, targetSourcePath]) {
    if (filepath !== undefined && ![".ajs", ".safejs"].includes(path.extname(filepath)))
      throw new TypeError(
        "Migration source paths must name executable .ajs or .safejs files, not harness Markdown."
      );
  }
  const snapshot: SafeJSSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const source = await readFile(sourcePath, "utf8");
  const inspection = inspectSnapshotMigration(snapshot, { source });
  if (options.inspect) return { inspection };
  const plan: unknown = JSON.parse(await readFile(planPath!, "utf8"));
  if (
    plan === null ||
    typeof plan !== "object" ||
    !Object.hasOwn(plan, "state") ||
    !Object.hasOwn(plan, "reconciliation")
  )
    throw new TypeError("Migration plan requires explicit state and reconciliation fields.");
  const targetSource = await readFile(targetSourcePath!, "utf8");
  const migrated = migrateSnapshot(snapshot, {
    source,
    targetSource,
    state: (plan as SnapshotMigrationOptions).state,
    reconciliation: (plan as SnapshotMigrationOptions).reconciliation
  });
  const contents = serializeSafeJSSnapshot(migrated);
  if (!options.dryRun) {
    const temporaryPath = path.join(
      path.dirname(outputPath!),
      `.safejs-migration-${globalThis.crypto.randomUUID()}.tmp`
    );
    let created = false;
    try {
      if (adapter) {
        if (!adapter.open || !adapter.link || !adapter.unlink)
          throw new TypeError("Migration filesystem must support retained writes, hard links and unlink.");
        const handle = await adapter.open(temporaryPath, {access: "write", creation: "exclusive", mode: 0o600});
        created = true;
        try {
          const bytes = new TextEncoder().encode(contents);
          let position = 0;
          while (position < bytes.byteLength) {
            const written = await handle.write(bytes.subarray(position), position);
            if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - position)
              throw new Error("Migration filesystem returned an invalid write count.");
            position += written;
          }
          await handle.sync(false);
        } finally {await handle.close();}
      } else {
        const handle = await hostFs.open(temporaryPath, "wx", 0o600);
        created = true;
        try {
          await handle.writeFile(contents, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      try {
        if (adapter) await adapter.link!(temporaryPath, outputPath!);
        else await hostFs.link(temporaryPath, outputPath!);
      } catch (error) {
        if (hasOwnErrorCode(error, "EEXIST"))
          throw Object.assign(
            new Error(
              `Migration output already exists: ${JSON.stringify(outputPath)}. Choose a new output path; existing files are never overwritten.`,
              { cause: error }
            ),
            { code: "EEXIST" }
          );
        throw error;
      }
    } finally {
      if (created) {
        if (adapter) await adapter.unlink!(temporaryPath);
        else await hostFs.unlink(temporaryPath);
      }
    }
  }
  return { inspection, outputPath, dryRun: options.dryRun === true };
}
