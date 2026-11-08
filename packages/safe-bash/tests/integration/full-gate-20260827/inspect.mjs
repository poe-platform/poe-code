import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function git(...args) { return execFileSync("git", args, { cwd: repository, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 32 * 1024 * 1024 }); }
export function inspect(requested) {
  const revision = git("rev-parse", `${requested}^{commit}`).trim();
  const rows = git("ls-tree", "-rzl", "--full-tree", revision).split("\0").filter(Boolean).map(row => {
    const separator = row.indexOf("\t"), [mode, type, blob, size] = row.slice(0, separator).trim().split(/\s+/);
    const path = row.slice(separator + 1);
    assert.ok(["100644", "100755"].includes(mode) && type === "blob", `Not a regular committed file: ${path}`);
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."));
    return { path, mode, blob, bytes: Number(size) };
  });
  const read = path => git("show", `${revision}:${path}`);
  const configurationPaths = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "benchmarks/package.json", "benchmarks/package-lock.json", "benchmarks/tsconfig.json"];
  const configuration = Object.fromEntries(configurationPaths.map(path => { const text = read(path); return [path, { sha256: hash(text), value: JSON.parse(text) }]; }));
  const canonical = rows.filter(row => row.path.startsWith("tests/") && row.path.endsWith(".test.ts"));
  assert.ok(canonical.every(row => !row.path.split("/").some(part => part.startsWith("."))), "Hidden glob paths require explicit Node discovery review");
  const noncanonical = rows.filter(row => row.path.startsWith("tests/") && /\.(?:ts|mts|mjs|js)$/.test(row.path) && !row.path.endsWith(".test.ts"));
  const evidenceTests = canonical.filter(row => /\/(?:evidence|reports|fixtures)\//.test(row.path));
  return { inspectedAt: new Date().toISOString(), revision, kind: "static-discovery-not-execution", configuration, trackedFiles: rows.length,
    trackedBytes: rows.reduce((sum, row) => sum + row.bytes, 0), tree: rows, canonicalTestFiles: canonical,
    contractTestFiles: canonical.filter(row => row.path.startsWith("tests/contracts/")), noncanonicalPrograms: noncanonical,
    matchingHistoricalLocations: evidenceTests, exclusions: "Only the declared tests/**/*.test.ts discovery rule excludes direct execution. All committed files remain in the archive; matching stress tests and characterizations are not removed. Nonmatching helpers/child cases may still be imported or invoked by matching tests.",
    types: { root: configuration["tsconfig.json"].value, build: configuration["tsconfig.build.json"].value, benchmarks: configuration["benchmarks/tsconfig.json"].value },
    safejs: "SAFEJS_LOCAL_ROOT stays unset. Existing unavailable-engine skips remain non-acceptance; ef1699b real-engine public acceptance is separate.",
    authorization: "Inspection does not authorize execution. Full run requires an explicit root integration handoff and --handoff full commit hash --execute." };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(inspect(process.argv[2] ?? "HEAD"), null, 2));
