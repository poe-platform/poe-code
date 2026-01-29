import { Command } from "commander";
import * as fs from "node:fs/promises";
import { createInterface } from "node:readline";
import { getPoeApiKey } from "../src/sdk/credentials.js";
import { createPoeClient } from "../src/services/llm-client.js";
import {
  listSnapshots,
  deleteSnapshots,
  refreshSnapshots,
  findStaleSnapshots,
  pruneSnapshots
} from "../tests/helpers/snapshot-store.js";

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

class StaleAccessedKeysError extends Error {
  constructor(ageMinutes: number) {
    super(
      `Accessed keys file is ${ageMinutes} minutes old (max: 10 minutes).\n` +
      `Run tests first: POE_SNAPSHOT_MODE=playback npm test`
    );
    this.name = "StaleAccessedKeysError";
  }
}

function resolveSnapshotDir(): string {
  const value = process.env.POE_SNAPSHOT_DIR;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "__snapshots__";
}

function resolveApiBaseUrl(): string {
  const value = process.env.POE_API_BASE_URL;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "https://api.poe.com/v1";
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer: string = await new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (input) => {
      resolve(input);
    });
  });

  rl.close();

  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}

async function loadAccessedKeys(snapshotDir: string): Promise<Set<string> | null> {
  const accessedKeysPath = `${snapshotDir}/.accessed-keys.json`;
  try {
    const stat = await fs.stat(accessedKeysPath);
    const ageMs = Date.now() - stat.mtime.getTime();
    if (ageMs > MAX_AGE_MS) {
      const ageMinutes = Math.floor(ageMs / 60000);
      throw new StaleAccessedKeysError(ageMinutes);
    }

    const raw = await fs.readFile(accessedKeysPath, "utf8");
    const keys = JSON.parse(raw) as string[];
    return new Set(keys);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

const program = new Command();

program
  .name("snapshots")
  .description("Manage LLM test snapshots");

program
  .command("list")
  .description("List all snapshots")
  .option("--model <model>", "Filter by model name")
  .action(async (options?: { model?: string }) => {
    const snapshotDir = resolveSnapshotDir();
    const summaries = await listSnapshots(fs as any, snapshotDir, {
      model: options?.model
    });

    if (summaries.length === 0) {
      console.log("No snapshots found.");
      return;
    }

    for (const summary of summaries) {
      const recordedAt = summary.recordedAt ?? "";
      const prompt = summary.prompt;
      console.log(`${summary.key} | ${summary.model} | ${prompt} | ${recordedAt}`);
    }
  });

program
  .command("refresh [key]")
  .description("Re-record snapshots from API")
  .option("--model <model>", "Filter by model name")
  .action(async (key?: string, options?: { model?: string }) => {
    const snapshotDir = resolveSnapshotDir();
    const apiKey = await getPoeApiKey();
    const baseUrl = resolveApiBaseUrl();
    const client = createPoeClient({ apiKey, baseUrl });

    const refreshed = await refreshSnapshots(fs as any, snapshotDir, {
      client,
      key,
      model: options?.model
    });

    console.log(`Refreshed ${refreshed} snapshot${refreshed === 1 ? "" : "s"}.`);
  });

program
  .command("delete [key]")
  .description("Delete snapshots")
  .option("--model <model>", "Filter by model name")
  .option("--stale", "Delete stale snapshots (requires running tests with POE_SNAPSHOT_MODE=playback first)")
  .action(async (key?: string, options?: { model?: string; stale?: boolean }) => {
    const snapshotDir = resolveSnapshotDir();

    if (options?.stale) {
      const accessedKeys = await loadAccessedKeys(snapshotDir);
      if (!accessedKeys) {
        console.error("No accessed keys file found. Run tests with POE_SNAPSHOT_MODE=playback first.");
        process.exitCode = 1;
        return;
      }

      const stale = await findStaleSnapshots(fs as unknown as any, snapshotDir, accessedKeys);
      if (stale.length === 0) {
        console.log("No stale snapshots found.");
        return;
      }

      console.log(`Found ${stale.length} stale snapshot${stale.length === 1 ? "" : "s"}:`);
      for (const staleKey of stale) {
        console.log(`  ${staleKey}`);
      }

      const confirmed = await confirm(`Delete ${stale.length} stale snapshot${stale.length === 1 ? "" : "s"}?`);
      if (!confirmed) {
        console.log("Delete cancelled.");
        return;
      }

      const pruned = await pruneSnapshots(fs as unknown as any, snapshotDir, accessedKeys);
      console.log(`Deleted ${pruned.length} snapshot${pruned.length === 1 ? "" : "s"}.`);
      return;
    }

    if (!key && !options?.model) {
      const confirmed = await confirm("Delete all snapshots?");
      if (!confirmed) {
        console.log("Delete cancelled.");
        return;
      }
    }

    const deleted = await deleteSnapshots(fs as any, snapshotDir, {
      key,
      model: options?.model
    });

    console.log(`Deleted ${deleted} snapshot${deleted === 1 ? "" : "s"}.`);
  });

await program.parseAsync(process.argv);
