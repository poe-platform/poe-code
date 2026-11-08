import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { directory, digest, read, json, putJson } from "./common.mjs";

const inputs = json(join(directory, "INPUTS.json"));
const pack = read(inputs.package.authorTarballLocation); assert.equal(digest(pack), inputs.package.tarballSha256);
const tar = gunzipSync(pack, { maxOutputLength: 16 * 1024 * 1024 });
const members = new Map();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
  const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/su, "");
  const prefix = text(345, 155), name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
  assert.ok(name.startsWith("package/")); assert.ok([0, 48].includes(header[156]));
  const path = name.slice(8), size = Number.parseInt(text(124, 12).trim(), 8);
  assert.ok(!members.has(path)); const bytes = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
  assert.equal(digest(bytes), inputs.packageFiles[path], path); members.set(path, bytes);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(members.size, 834);
const harness = Object.fromEntries(["child.mjs", "consumer-component.mjs", "observer.mjs", "silent-worker.mjs", "guard.mjs", "worker-guard.mjs", "cases.json"].map(name => [name, digest(read(join(directory, name)))]));
const runDirectory = join(directory, "work/run-001"), layouts = [];
function layout(name, consumer, mutation = null) {
  const packageHashes = { ...inputs.packageFiles };
  let forbiddenSource;
  if (mutation === "root-negative") packageHashes["dist/index.js"] = digest(members.get("dist/index.js").toString().replace('export * from "./commands/expr/index.js";', ""));
  if (mutation === "subpath-negative") { const metadata = JSON.parse(members.get("package.json")); delete metadata.exports["./commands/expr"]; packageHashes["package.json"] = digest(JSON.stringify(metadata)); }
  if (mutation === "worker-negative") delete packageHashes["dist/commands/regex-execution/matching.js"];
  if (mutation === "source-fallback") {
    forbiddenSource = pathToFileURL(join(consumer, "../src/poison.mjs")).href;
    packageHashes["dist/index.js"] = digest(members.get("dist/index.js").toString() + `\nimport ${JSON.stringify(forbiddenSource)};\n`);
  }
  const expected = Object.fromEntries([...Object.entries(packageHashes).map(([path, sha256]) => [join(consumer, "node_modules/virtual-bash", path), sha256]), ...Object.entries(harness).map(([path, sha256]) => [join(consumer, path), sha256])].sort(([left], [right]) => left.localeCompare(right)));
  layouts.push({ name, consumer, mutation, forbiddenSource, expected, expectedSha256: digest(JSON.stringify(expected)) });
}
layout("installed", join(runDirectory, "installed/consumer"));
layout("moved", join(runDirectory, "moved package with spaces/consumer"));
for (const phase of ["installed", "moved"]) for (const runtime of ["node22", "node24"]) for (const mutation of ["root-negative", "subpath-negative", "worker-negative", "source-fallback"]) {
  const label = `${phase}-${runtime}`; layout(`${label}-${mutation}`, join(runDirectory, "controls", label, mutation, "consumer"), mutation);
}
putJson(join(directory, "LAYOUTS.json"), { schema: "expr-preexecution-exact-load-layouts-v1", preparedAt: new Date().toISOString(), authenticatedAuthorpackOnlyForReadOnlyPlanning: inputs.package.tarballSha256, independentP01StillRequired: true, layouts });
console.log(JSON.stringify({ stage: "layout-preparation", productExecutions: 0, packageMembers: members.size, layoutCount: layouts.length, layoutManifestSha256: digest(read(join(directory, "LAYOUTS.json"))) }));
