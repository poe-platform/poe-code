import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recipes, performanceRecipes } from "./recipes.mjs";
import { prepareNative, observeNative } from "./native.mjs";
import { localServer } from "./server.mjs";
import { hash } from "./common.mjs";

const output = resolve(process.argv[2] ?? "benchmarks/reports/expanded-20260827/native-first");
await mkdir(output, { recursive: false });
const profile = await prepareNative(process.cwd());
const server = await localServer();
try {
  const corpus = recipes(), performance = performanceRecipes(), observations = [];
  for (const specimen of [...corpus, ...performance]) observations.push({ id: specimen.id, recipeHash: hash(JSON.stringify(specimen)), ...await observeNative(profile, specimen, server.baseUrl) });
  const invalid = observations.filter(observation => !observation.oracleValid);
  const report = { createdAt: new Date().toISOString(), primaryProfile: "GNU Bash5.3 and coreutils9.7, LC_ALL=C, TZ=UTC; other executable profiles individually recorded",
    toolIdentities: profile.tools, recipeCount: corpus.length, performanceCount: performance.length,
    recipes: corpus, performanceRecipes: performance, observations, invalidCount: invalid.length,
    projections: ["native temporary fixture root to /fixture", "preexisting external native scratch to /tmp; TMPDIR=/tmp in both virtual engines", "native role-bin root to /usr/bin", "loopback origin to {{BASE}}"],
    sourceHashes: Object.fromEntries(await Promise.all(["recipes.mjs", "native.mjs", "common.mjs", "server.mjs", "capture.mjs"].map(async path => [path, hash(await readFile(new URL(path, import.meta.url)))]))) };
  await writeFile(resolve(output, "native.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, total: observations.length, invalid: invalid.map(({ id, exitCode, reason, stderr }) => ({ id, exitCode, reason, stderr: Buffer.from(stderr, "base64").toString() })) }, null, 2));
  assert.equal(invalid.length, 0, "Invalid oracle recipes remain explicit and must be investigated before engine scoring");
} finally { await server.close(); await profile.close(); }
