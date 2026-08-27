import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "./common.mjs";

const response = await fetch("https://registry.npmjs.org/just-bash", { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Registry returned ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer()), registry = JSON.parse(bytes);
const baselineRoot = resolve("benchmarks/node_modules/just-bash");
const installed = JSON.parse(await readFile(resolve(baselineRoot, "package.json"), "utf8"));
const latest = registry["dist-tags"].latest;
const report = { queriedAt: new Date().toISOString(), url: response.url, responseSha256: hash(bytes), tags: registry["dist-tags"], latest,
  published: registry.time[latest], dist: registry.versions[latest].dist, repository: registry.versions[latest].repository,
  installed: installed.version, installedManifestSha256: hash(await readFile(resolve(baselineRoot, "package.json"))),
  installedBundleSha256: hash(await readFile(resolve(baselineRoot, "dist/bundle/index.js"))),
  isolatedLockSha256: hash(await readFile("benchmarks/package-lock.json")), newInstallRequired: latest !== installed.version,
  primaryReferences: ["https://github.com/vercel-labs/just-bash", "https://raw.githubusercontent.com/vercel-labs/just-bash/main/packages/just-bash/package.json", "https://www.gnu.org/software/bash/manual/bash.html", "https://www.gnu.org/software/coreutils/manual/coreutils.html"],
  caveat: "Release registry metadata and installed artifact hashes are separate from mutable main-branch documentation. No package install performed." };
await writeFile(resolve(process.argv[2]), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ latest, installed: installed.version, queriedAt: report.queriedAt }));
