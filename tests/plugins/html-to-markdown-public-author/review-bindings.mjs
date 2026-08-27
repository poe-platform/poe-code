import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory } from "../../integration/html-public-independent-20260827/contract.mjs";

const [authorDirectory, declarationDirectory, output] = process.argv.slice(2);
assert.ok(authorDirectory && declarationDirectory && output, "supply author run, retained full-archive declaration attempt and new output filename");
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const report = JSON.parse(readFileSync(join(authorDirectory, "REPORT.json"))); assert.equal(report.status, "pass");
const git = args => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = git(["ls-tree", "-rz", report.candidate]).toString().split("\0").filter(Boolean).map(line => {
  const separator = line.indexOf("\t"), metadata = line.slice(0, separator), path = line.slice(separator + 1);
  const [mode, type, blob] = metadata.split(" "); return { mode, type, blob, path };
});
const packageFiles = {}, archiveSymlinks = {}, extracted = join(declarationDirectory, "full-archive");
for (const entry of entries) {
  assert.equal(entry.type, "blob"); const path = join(extracted, entry.path), stat = lstatSync(path);
  const bytes = entry.mode === "120000" ? readlinkSync(path, { encoding: "buffer" }) : readFileSync(path);
  assert.equal(stat.isSymbolicLink(), entry.mode === "120000");
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.blob, entry.path);
  if (entry.mode === "120000") archiveSymlinks[entry.path] = { target: bytes.toString(), sha256: digest(bytes), gitBlob: entry.blob };
  else { assert.ok(["100644", "100755"].includes(entry.mode)); assert.equal(stat.isFile(), true); packageFiles[entry.path] = digest(bytes); }
}
const hash = createHash("sha256"); for await (const bytes of createReadStream(join(declarationDirectory, "candidate.tar"))) hash.update(bytes);
const packFiles = inventory(report.package.installed);
assert.deepEqual(packFiles, Object.fromEntries(report.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
const node = realpathSync(process.execPath), originalNpm = realpathSync(join(dirname(node), "npm"));
const npmSource = dirname(dirname(originalNpm));
const npmRoot = mkdtempSync(join(declarationDirectory, "regular-file-npm-tools-v2-"));
function copyTools(source, destination) {
  for (const name of readdirSync(source)) {
    const original = realpathSync(join(source, name)), target = join(destination, name);
    assert.ok(original.startsWith(npmSource + "/"), "npm tooling link must remain within its declared package");
    const stat = statSync(original);
    if (stat.isDirectory()) { mkdirSync(target); copyTools(original, target); }
    else { assert.equal(stat.isFile(), true); copyFileSync(original, target); assert.deepEqual(readFileSync(target), readFileSync(original)); }
  }
}
copyTools(npmSource, npmRoot);
const npm = join(npmRoot, "bin/npm-cli.js"); assert.deepEqual(readFileSync(npm), readFileSync(originalNpm));
const toolPaths = { node, npm, tsc: realpathSync(join(repository, "node_modules/typescript/bin/tsc")), typescript: realpathSync(join(repository, "node_modules/typescript")), nodeTypes: realpathSync(join(repository, "node_modules/@types/node")), undiciTypes: realpathSync(join(repository, "node_modules/undici-types")), npmRoot };
const value = {
  schema: 1, admission: "BLOCKED: fixture54f1e4d full-tree inventory rejects twelve historical symlinks; this is a provenance receipt, not a silently relaxed executable declaration",
  candidateCommit: report.candidate, fixtureCommit: "54f1e4d819e0d3cde422c1f305a84474932e3bac", baselineCommit: "e9843e601859282de25fa40742529c6be6668bf3",
  declaredBy: "Curie author through root; different review pending", subpath: "virtual-bash/commands/html-to-markdown", agentOption: "htmlToMarkdown",
  changedProductPaths: git(["diff", "--name-only", "e9843e60", report.candidate, "--", "src", "package.json"]).toString().trim().split("\n").filter(Boolean).sort(),
  htmlIoPaths: ["src/commands/html-to-markdown/index.ts"],
  sourceScopeApproval: "Root authorized index/I/O-only adoption and root/default integration. Only HTML index.ts changes behavior. Renderer/parser/options/entities/text/input/budget unchanged; intervening expr README not semantically approved here.",
  archiveSha256: hash.digest("hex"), packSha256: report.package.tarballSha256, rendererSha256: packageFiles["src/commands/html-to-markdown/render.ts"],
  packageFiles, archiveSymlinks, packFiles, packageExports: JSON.parse(readFileSync(join(extracted, "package.json"))).exports,
  workerFiles: Object.fromEntries(Object.entries(packFiles).filter(([path]) => path.startsWith("dist/commands/regex-execution/") && path.endsWith(".js"))),
  toolPaths, toolExecutables: Object.fromEntries(["node", "npm", "tsc"].map(name => [name, digest(readFileSync(toolPaths[name]))])),
  toolStaging: { originalNpm, npmRoot, policy: "explicit regular-file copy of installed npm cached tooling, dereferencing its .bin links; not a product/archive copy and no installation. CLI bytes unchanged; new complete tool tree bound separately" },
  toolTrees: Object.fromEntries(["typescript", "nodeTypes", "undiciTypes", "npmRoot"].map(name => [name, digest(JSON.stringify(inventory(toolPaths[name])))])),
  clarifications: "Read README pending boundaries; no exit-status or opaque-preemption expansion",
};
writeFileSync(output, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, candidate: report.candidate, files: Object.keys(packageFiles).length, historicalSymlinks: Object.keys(archiveSymlinks).length, archiveSha256: value.archiveSha256, admission: value.admission }));
