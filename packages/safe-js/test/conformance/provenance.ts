import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sha256 = (source: string | Uint8Array) => createHash("sha256").update(source).digest("hex");

export async function sourceProvenance() {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const hashes: Record<string, string> = {};
  const visit = async (path: string): Promise<void> => {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source provenance rejects symbolic link: ${child}`);
      if (entry.isDirectory()) await visit(child);
      else hashes[child] = sha256(await readFile(join(root, child)));
    }
  };
  // Hash all workspace runtime sources: transitive workspace imports are part of the engine.
  for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const child of await readdir(join(root, "packages", entry.name), { withFileTypes: true })) {
      if ((child.name === "src" || child.name === "dist") && child.isDirectory()) await visit(`packages/${entry.name}/${child.name}`);
      if (child.name === "package.json" || child.name.startsWith("tsconfig")) {
        const path = `packages/${entry.name}/${child.name}`;
        if (child.isFile()) hashes[path] = sha256(await readFile(join(root, path)));
      }
    }
  }
  await visit("packages/safe-js/test/conformance");
  for (const path of ["package.json", "package-lock.json", "tsconfig.json"]) hashes[path] = sha256(await readFile(resolve(root, path)));
  const ordered = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
  return { sourceSha: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceHash: sha256(JSON.stringify(ordered)), sourceHashes: ordered };
}
