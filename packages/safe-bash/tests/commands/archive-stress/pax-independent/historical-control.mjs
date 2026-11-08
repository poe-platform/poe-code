import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [historicalRoot, evidencePath] = process.argv.slice(2);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const evidenceBytes = readFileSync(evidencePath);
assert.equal(digest(evidenceBytes), "6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b");
const prior = JSON.parse(evidenceBytes);
assert.equal(realpathSync(prior.frozen), historicalRoot);
assert.equal(realpathSync(process.cwd()), historicalRoot);
assert.equal(prior.inputs.files.length, 1629);
assert.equal(prior.frozenBefore, "0e384ea33290a09c255ee29b6db6d4831cfaf2113377be703ff9498ce473f3f9");
const verify = () => {
  const verified = prior.inputs.files.map(entry => {
    const path = join(historicalRoot, entry.path);
    const metadata = lstatSync(path);
    assert.equal(realpathSync(path), path, `historical import alias: ${entry.path}`);
    assert.ok(metadata.isFile() && metadata.nlink === 1, entry.path);
    assert.equal(metadata.mode & 0o777, entry.mode, entry.path);
    const sha256 = digest(readFileSync(path));
    assert.equal(sha256, entry.copiedSha256, entry.path);
    return { path: entry.path, sha256 };
  });
  assert.equal(digest(JSON.stringify(verified)), prior.frozenBefore);
};
verify();
assert.equal(digest(readFileSync(join(historicalRoot, "src/fs/memory/index.ts"))), "57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad");
const original = readFileSync(new URL("./observation-control.mjs", import.meta.url), "utf8");
assert.equal(digest(original), "6bd2e01d72e0bd887ecb3db22a0c989db49efdb89d3d7f96695d923c6c4500c7");
const ownBase = pathToFileURL(join(historicalRoot, "tests/commands/archive-stress/pax-independent/observation-control.mjs")).href;
const fixtureUrl = pathToFileURL(join(historicalRoot, "tests/commands/archive-stress/pax-independent/fixtures.ts")).href;
const relocated = original.replace('"./fixtures.ts"', JSON.stringify(fixtureUrl)).replaceAll("import.meta.url", JSON.stringify(ownBase));
assert.equal(relocated.split("assert.").length, original.split("assert.").length);
const controlUrl = `data:text/javascript;base64,${Buffer.from(relocated).toString("base64")}`;
const tracePath = join(process.env.ARCHIVE_ACCEPTANCE_EVIDENCE, "resolved-imports.jsonl");
writeFileSync(tracePath, "", { flag: "wx" });
const guard = `import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
let settings;
export function initialize(data) { settings = data; }
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  const url = new URL(result.url); url.search = ""; url.hash = "";
  assert.ok(result.url === settings.controlUrl || url.protocol === "node:" || settings.allowed.includes(url.href), "import outside sealed historical profile: " + result.url);
  appendFileSync(settings.tracePath, JSON.stringify({ specifier: result.url === settings.controlUrl ? "unchanged-relocated-control" : specifier, resolved: result.url === settings.controlUrl ? "unchanged-relocated-control" : result.url }) + "\\n");
  return result;
}`;
register(`data:text/javascript;base64,${Buffer.from(guard).toString("base64")}`, { data: { controlUrl, tracePath, allowed: prior.inputs.files.map(entry => pathToFileURL(join(historicalRoot, entry.path)).href) } });
try {
  await import(controlUrl);
} finally {
  verify();
  console.log(JSON.stringify({ historicalProfileOnly: true, profile: "memory-intact-57a6148", source: historicalRoot, inputFilesVerifiedBeforeAndAfter: prior.inputs.files.length, closureSha256: prior.frozenBefore, identicalAssertionCode: true, relocationOnly: true, importGuard: "Every subsequent ESM resolution must be builtin, the exact relocated control, or a pinned historical input; old absolute tsx preload and dependencies are sealed." }));
}
