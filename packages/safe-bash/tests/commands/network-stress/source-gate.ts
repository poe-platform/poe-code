import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

export const originalRevision = "deab14d9f4b3b6f0d73f96587c74a9de23091300";
export async function validateSourceRevision(): Promise<{ revision: string; digest: string }> {
  const revision = process.env.CURL_VERIFY_SOURCE_REVISION ?? originalRevision;
  assert.match(revision, /^[a-f0-9]{40}$/, "Require an explicit full committed source revision");
  assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", originalRevision, revision]).status, 0, "Source revision must descend from the authentic handoff");
  const listing = spawnSync("git", ["ls-tree", "-r", "--name-only", revision, "--", "src/commands/network"], { encoding: "utf8" });
  assert.equal(listing.status, 0);
  const paths: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path); else paths.push(path);
    }
  }
  await walk("src/commands/network");
  assert.deepEqual(paths.sort(), listing.stdout.trim().split("\n").sort(), "Network source inventory differs from revision");
  const hashes: [string, string][] = [];
  for (const path of paths) {
    const committed = spawnSync("git", ["show", `${revision}:${path}`]);
    assert.equal(committed.status, 0);
    const actual = createHash("sha256").update(await readFile(path)).digest("hex");
    assert.equal(actual, createHash("sha256").update(committed.stdout).digest("hex"), `Network source differs from revision: ${path}`);
    hashes.push([path, actual]);
  }
  return { revision, digest: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") };
}
