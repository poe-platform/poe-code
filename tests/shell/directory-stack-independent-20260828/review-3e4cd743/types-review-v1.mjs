import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { inversions, invert, validateDiagnostics } from "../executor-preparation-v1/types.mjs";
import { snapshot, assertSnapshot, sha256 } from "./harness-v1/integrity.mjs";
import { runBoundedChild } from "./harness-v1/child-process.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../../../..");
const tools = JSON.parse(readFileSync(resolve(root, "TOOLS-v2.json")));
const source = resolve(root, "work-v1/source"), moved = resolve(root, "work-v1/moved-consumer");
const raw = resolve(root, "type-results-v1");
const sealCommit = process.argv[2]; assert.match(sealCommit, /^[a-f0-9]{40}$/);
assert.deepEqual(readFileSync(fileURLToPath(import.meta.url)), execFileSync("git", ["show", `${sealCommit}:${fileURLToPath(import.meta.url).slice(repository.length + 1)}`]));
assert(!existsSync(raw)); mkdirSync(raw);
const positive = readFileSync(resolve(root, "../executor-preparation-v1/types-positive.mts.fixture"), "utf8");
const negative = readFileSync(resolve(root, "../executor-preparation-v1/types-negative.mts.fixture"), "utf8");
const sourceBefore = snapshot(source);
const results = [];
for (const layout of ["source", "installed", "moved"]) {
  const fixtureRoot = resolve(raw, layout); mkdirSync(fixtureRoot);
  writeFileSync(resolve(fixtureRoot, "package.json"), '{"name":"directory-stack-independent-type-consumer","private":true,"type":"module"}\n');
  const declaration = layout === "source" ? resolve(source, "dist/index.d.ts") : resolve(moved, "node_modules/virtual-bash/dist/index.d.ts");
  assert(existsSync(declaration));
  const targetBefore = snapshot(layout === "source" ? source : moved);
  const config = { compilerOptions: { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, verbatimModuleSyntax: true, skipLibCheck: true, noEmit: true, types: ["node"], typeRoots: [resolve(source, "node_modules/@types")], paths: { "virtual-bash": [declaration] } }, files: ["positive.mts"] };
  const invocations = [{ id: "positive", text: positive, file: "positive.mts", expectedCode: 0 }, { id: "negative", text: negative, file: "negative.mts", expectedCode: 2 }, ...inversions.map(entry => ({ id: entry.id + "-inversion", text: invert(negative, entry.id), file: "negative.mts", expectedCode: 2, removed: entry.id }))];
  for (const item of invocations) {
    const directory = resolve(fixtureRoot, item.id); mkdirSync(directory);
    writeFileSync(resolve(directory, item.file), item.text);
    writeFileSync(resolve(directory, "tsconfig.json"), JSON.stringify({ ...config, files: [item.file] }));
    const before = snapshot(directory);
    assert.equal(sha256(readFileSync(tools.node.path)), tools.node.sha256);
    const child = await runBoundedChild(tools.node.path, [resolve(source, "node_modules/typescript/bin/tsc"), "-p", resolve(directory, "tsconfig.json"), "--pretty", "false"], { cwd: directory, env: { PATH: dirname(tools.node.path), HOME: resolve(root, "work-v1/home") }, timeoutMs: 60000, maxCaptureBytes: 1024 * 1024 });
    writeFileSync(resolve(raw, `${layout}-${item.id}.json`), JSON.stringify({ layout, id: item.id, declaration, fixtureSha256: sha256(Buffer.from(item.text)), ...child }, null, 2) + "\n", { flag: "wx" });
    assert(child.natural && child.closed && !child.leak, "STOP: compiler scope not naturally settled");
    assertSnapshot(directory, before); assertSnapshot(source, sourceBefore); assertSnapshot(layout === "source" ? source : moved, targetBefore);
    let status = "pass", error;
    try { assert.equal(child.code, item.expectedCode); assert.equal(child.stderr, ""); if (item.id === "positive") assert.equal(child.stdout, ""); else validateDiagnostics(child.stdout, item.text, item.removed); } catch (failure) { status = "assertion-failure"; error = failure.message; }
    results.push({ layout, id: item.id, status, error });
  }
}
writeFileSync(resolve(raw, "RESULTS.json"), JSON.stringify({ results, qualification: "source declarations versus actual physically moved installed package declarations; installed-stage compile timing is after move and uses moved package, NOT a pre-move installed compile claim; intended diagnostics/inversions unchanged" }, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify(results) + "\n");
