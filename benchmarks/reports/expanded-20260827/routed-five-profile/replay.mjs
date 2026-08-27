import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = process.cwd(), output = resolve(process.argv[3]);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const revision = git("rev-parse", process.argv[2] ?? "HEAD");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const temporary = await mkdtemp(join(tmpdir(), "safe-five-profile-"));
const ids = ["command/patch/apply", "command/patch/dry-run", "command/patch/reverse", "command/stat/timestamp", "composition/patch-hash/patch-hash"];
const profiles = [
  { name: "original", revision: git("rev-parse", "0294afb"), gold: "native-corrected/native.json" },
  { name: "scratch-aligned", revision: git("rev-parse", "d1b10a3"), gold: "native-scratch-aligned/native.json" },
];
const sourceHashes = {};
async function hashes(root, prefix = "src") {
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await hashes(root, path);
    else sourceHashes[path] = sha(await readFile(join(root, path)));
  }
}
async function archive(name, commit, paths) {
  const directory = join(temporary, name); await mkdir(directory);
  execFileSync("git", ["archive", "-o", join(temporary, `${name}.tar`), commit, ...paths], { cwd: repo });
  execFileSync("tar", ["-xf", join(temporary, `${name}.tar`), "-C", directory]);
  await symlink(join(repo, "node_modules"), join(directory, "node_modules"), "dir");
  return directory;
}
try {
  const source = await archive("source", revision, ["src", "package.json", "package-lock.json"]);
  await hashes(source);
  const baselineRoot = join(repo, "benchmarks/node_modules/just-bash"), results = [];
  const baseline = {
    version: JSON.parse(await readFile(join(baselineRoot, "package.json"), "utf8")).version,
    bundleSha256: sha(await readFile(join(baselineRoot, "dist/bundle/index.js"))),
    lockSha256: sha(await readFile(join(repo, "benchmarks/package-lock.json"))),
  };
  assert.equal(baseline.version, "3.4.2");
  for (const profile of profiles) {
    const harness = await archive(profile.name, profile.revision, ["benchmarks/expanded", "package.json"]);
    const { session } = await import(pathToFileURL(join(harness, "benchmarks/expanded/session.mjs")).href);
    const { recipes } = await import(pathToFileURL(join(harness, "benchmarks/expanded/recipes.mjs")).href);
    const { compare, environment } = await import(pathToFileURL(join(harness, "benchmarks/expanded/common.mjs")).href);
    const goldenBytes = execFileSync("git", ["show", `d1b10a3:benchmarks/reports/expanded-20260827/${profile.gold}`], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
    const golden = JSON.parse(goldenBytes), rows = [];
    for (const engine of ["virtual-bash", "just-bash"]) {
      const worker = await session(engine, source, baselineRoot);
      try {
        for (const id of ids) {
          const specimen = recipes().find(row => row.id === id), expected = golden.observations.find(row => row.id === id);
          assert.ok(specimen && expected?.oracleValid);
          assert.equal(sha(JSON.stringify(specimen)), expected.recipeHash);
          const observed = await worker.run(specimen, undefined, false);
          rows.push({ id, engine, specimen, expected, observed, comparison: observed.observation ? compare(expected, observed.observation) : null });
        }
      } finally { await worker.close(); }
    }
    results.push({ profile, environment, goldenSha256: sha(goldenBytes), rows,
      totals: Object.fromEntries(["virtual-bash", "just-bash"].map(engine => [engine, {
        total: rows.filter(row => row.engine === engine).length,
        pass: rows.filter(row => row.engine === engine && row.comparison?.pass).length,
        fail: rows.filter(row => row.engine === engine && !row.comparison?.pass).length,
      }])) });
  }
  const original = results[0], aligned = results[1];
  const differences = original.rows.map(row => {
    const other = aligned.rows.find(candidate => candidate.id === row.id && candidate.engine === row.engine);
    assert.deepEqual(row.specimen, other.specimen);
    return { id: row.id, engine: row.engine,
      oracleChangedFields: ["stdout", "stderr", "exitCode", "entries"].filter(field => JSON.stringify(row.expected[field]) !== JSON.stringify(other.expected[field])),
      productChangedFields: ["stdout", "stderr", "exitCode", "entries"].filter(field => JSON.stringify(row.observed.observation?.[field]) !== JSON.stringify(other.observed.observation?.[field])),
    };
  });
  const report = {
    capturedAt: new Date().toISOString(), revision, sourceHashes, baseline, results, differences,
    scope: "Five existing routed recipes, two committed unchanged harness/native profiles, exact committed production archive and installed baseline. No dirty source, benchmark edits, native recapture or full224 score. Scratch-only effect delta is separate from Faraday source fixes.",
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ revision, totals: results.map(result => ({ profile: result.profile.name, ...result.totals })), differences }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
