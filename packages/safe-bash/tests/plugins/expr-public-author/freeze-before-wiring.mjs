import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: root });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const before = git("rev-parse", "HEAD").toString().trim();
const freeze = "f8b982f09e51b9a0a073b0b7bb393cb54796dd62";
const du = "0895de2dc63014989f23912c3d48f7c4d0d35a47";
const accepted = "c3e40f8bd721da5e496f3b3abfd51aee45db5a84";
git("merge-base", "--is-ancestor", freeze, before);
const paths = ["src/index.ts", "src/plugins/index.ts", "package.json"];
const entries = [];
for (const commit of [freeze, before]) for (const path of paths) {
  const bytes = git("show", `${commit}:${path}`), source = bytes.toString();
  if (path === "package.json") assert.equal(JSON.parse(source).exports["./commands/expr"], undefined);
  else assert.doesNotMatch(source, /commands\/expr\/|createExprCommand|readonly expr\?/u);
  if (commit === before) assert.deepEqual(readFileSync(new URL(`../../../${path}`, import.meta.url)), bytes, "root input is clean before wiring");
  entries.push({ commit, path, gitBlob: git("rev-parse", `${commit}:${path}`).toString().trim(), sha256: digest(bytes) });
}
const engine = git("ls-tree", "-r", "--name-only", before, "--", "src/commands/expr", "src/commands/regex-execution").toString().trim().split("\n").filter(path => path.endsWith(".ts"));
const engineBindings = engine.map(path => {
  const bytes = git("show", `${before}:${path}`); assert.deepEqual(bytes, git("show", `${accepted}:${path}`), path);
  assert.deepEqual(bytes, readFileSync(new URL(`../../../${path}`, import.meta.url)), `live source changed: ${path}`);
  return { path, gitBlob: git("rev-parse", `${before}:${path}`).toString().trim(), sha256: digest(bytes) };
});
const literal = /const expected = (\[[\s\S]*?\])\.sort\(\);/u.exec(git("show", `${du}:tests/plugins/du-public-author/consumer.ts.fixture`).toString())[1];
const names = JSON.parse(literal.replace(/,\s*\]$/u, "]"));
const casesPath = "tests/integration/expr-public-independent-20260827/cases.json";
const casesBytes = git("show", `${freeze}:${casesPath}`); assert.deepEqual(readFileSync(new URL(`../../../${casesPath}`, import.meta.url)), casesBytes);
const cases = JSON.parse(casesBytes); assert.deepEqual([...names].sort(), [...cases.baselineNames].sort()); assert.equal(names.length, 75);
const record = { schema: 1, createdAt: new Date().toISOString(), qualification: "Git and clean root/source absence authenticated before author wiring; no baseline product execution", beforeCommit: before, freezeCommit: freeze, du75Commit: du, acceptedEngineCommit: accepted, entries, engineBindings, names75: names, names76: [...names, "expr"], casesIdentity: { path: casesPath, sha256: digest(casesBytes) } };
const output = new URL("./PRE-WIRING.json", import.meta.url); writeFileSync(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ before, freeze, du, engineFiles: engine.length, output: fileURLToPath(output), sha256: digest(readFileSync(output)) }));
