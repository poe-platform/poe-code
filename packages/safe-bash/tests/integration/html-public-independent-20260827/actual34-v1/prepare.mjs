import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { author, bindingPath, candidate, coreSha, fileHash, freeze, frozen, git, here, inventory, json, packSha, parse, repository, sha256 } from "./common.mjs";

const protectedFiles = {}, commits = {};
function authenticateTree(commit, prefix) {
  assert.match(commit, /^[a-f0-9]{40}$/u);
  assert.equal(git(["rev-parse", `${commit}^{commit}`]).toString().trim(), commit);
  const rows = git(["ls-tree", "-rlz", commit, "--", prefix]).toString().split("\0").filter(Boolean);
  commits[commit] ??= [];
  for (const row of rows) {
    const [attributes, path] = row.split("\t"), [mode, kind, blob, size] = attributes.trim().split(/\s+/u);
    assert.equal(mode, "100644", path); assert.equal(kind, "blob");
    assert.ok(Number(size) <= 16 * 1024 ** 2, path);
    const bytes = git(["cat-file", "blob", blob]);
    assert.equal(bytes.length, Number(size));
    const hash = sha256(bytes); assert.equal(fileHash(join(repository, path)), hash, path);
    if (protectedFiles[path]) assert.equal(protectedFiles[path].sha256, hash, path);
    protectedFiles[path] = { sha256: hash, bytes: bytes.length, mode, blob };
    commits[commit].push(path);
  }
  assert.ok(rows.length, prefix);
}
const prefix = "tests/integration/html-public-independent-20260827";
authenticateTree(freeze, prefix);
const fixturePaths = [...commits[freeze]];
assert.equal(fixturePaths.length, 18);
authenticateTree("dfd7775b5319a85dffeee9c240806677d39e3572", prefix);
authenticateTree(author, `${prefix}/admission-v2`);
const partialRoot = "tests/integration/html-public-admission-partial-independent-20260827";
const resourceRoot = "tests/integration/html-public-admission-resource-v32-independent-20260827";
authenticateTree("7f272e4bdee84d3a40b0e3b9c2577b74b12bc6ef", partialRoot);
authenticateTree("49a35b8944728e05f3730a5a79aad91a5c9f8390", resourceRoot);
authenticateTree("3eb9767d5d6e6ec97c5e3c860aceb096d89d6575", resourceRoot);
authenticateTree("9aefcb0adc423636c3667731266c694598b281ab", `${resourceRoot}/prerequisites-01/recipe`);
authenticateTree("6758ae90b6561ff71a2064c09621e4a3fe724f4c", `${resourceRoot}/prerequisites-01`);
authenticateTree("9dc858c81672ff52b56d25f174d04714906cdff5", "tests/plugins/html-to-markdown-public-author/evidence-v1/INDEPENDENT-BINDINGS-BLOCKED.json");
authenticateTree("9dc858c81672ff52b56d25f174d04714906cdff5", "tests/plugins/html-to-markdown-public-author/README.md");
assert.equal(fileHash(join(frozen, "admission-v2/core.mjs")), coreSha);
assert.equal(fileHash(join(frozen, "admission-v2/run.mjs")), "93772a99c377a950307fdbefcf5f87ed7292a89c105833c4e180a0099f95de1d");
assert.equal(fileHash(bindingPath), "7df791cf7c7c0010af85726af9d9e78dcdebbdaff0c182fb9670be6e29b8989a");
const binding = parse(bindingPath);
assert.equal(binding.candidate, candidate); assert.equal(binding.freeze, freeze);
assert.equal(binding.tree, "9641374115db435022ac172ec9c99d305e07dbe4");
assert.equal(git(["rev-parse", `${candidate}^{tree}`]).toString().trim(), binding.tree);
assert.equal(binding.archive.sha256, "cb7f6b6d68f5946c3300e28156367ba42d1af83b12cb1b4be88832c50dfbfd07");
assert.equal(binding.archive.bytes, 2340945920);
assert.equal(binding.pack.sha256, packSha); assert.equal(Object.keys(binding.pack.files).length, 830);
const receiptPath = join(repository, "tests/plugins/html-to-markdown-public-author/evidence-v1/INDEPENDENT-BINDINGS-BLOCKED.json");
const declaration = parse(receiptPath);
assert.equal(declaration.candidateCommit, candidate); assert.equal(declaration.fixtureCommit, freeze);
assert.equal(declaration.agentOption, "htmlToMarkdown");
assert.deepEqual(declaration.packFiles, binding.pack.files);
const { validateDeclaration, baseline, moduleCommit, rendererHash } = await import("../contract.mjs");
validateDeclaration(declaration);
const changed = git(["diff", "--name-only", baseline, candidate, "--", "src", "package.json"]).toString().trim().split("\n").filter(Boolean).sort();
assert.deepEqual(changed, declaration.changedProductPaths);
assert.deepEqual(declaration.htmlIoPaths, ["src/commands/html-to-markdown/index.ts"]);
assert.equal(git(["rev-parse", "28cf1518eb3e1a27c5439ba89ff1801e3f852c3b^{commit}"]).toString().trim(), "28cf1518eb3e1a27c5439ba89ff1801e3f852c3b");
const htmlFiles = git(["ls-tree", "-r", "--name-only", candidate, "--", "src/commands/html-to-markdown"]).toString().trim().split("\n");
const html = {};
for (const path of htmlFiles) {
  const bytes = git(["show", `${candidate}:${path}`]); html[path] = sha256(bytes);
  if (path.endsWith("index.ts")) assert.equal(html[path], sha256(git(["show", `28cf1518eb3e1a27c5439ba89ff1801e3f852c3b:${path}`])));
  else if (path.endsWith(".ts")) assert.equal(html[path], sha256(git(["show", `${moduleCommit}:${path}`])));
}
assert.equal(html["src/commands/html-to-markdown/render.ts"], rendererHash);
const tools = {};
for (const [name, tool] of Object.entries(binding.tools)) {
  const actual = ["typescript", "nodeTypes", "undiciTypes", "npmRoot"].includes(name) ? sha256(JSON.stringify(inventory(tool.path))) : fileHash(tool.path);
  assert.equal(actual, tool.sha256, name); tools[name] = tool;
}
for (const path of ["/usr/bin/git", "/bin/ps"]) tools[path] = { path, sha256: fileHash(path) };
assert.equal(process.execPath, tools.node.path);
const partial = parse(join(repository, partialRoot, "RESULT.json"));
assert.equal(partial.status, "partial-four-plus-full-build-and-scoped-reconstruction-pass");
assert.equal(partial.verified.passed, 4); assert.equal(partial.verified.inputs.count, 410);
assert.equal(partial.verified.pack.hash, packSha); assert.equal(partial.verified.pack.members, 830);
assert.equal(partial.verified.reconstruction.deltaPaths, 2); assert.equal(partial.allGroupsSettled, true);
for (const row of partial.verified.archives) { assert.equal(row.sha256, binding.archive.sha256); assert.equal(row.bytes, binding.archive.bytes); }
const resources = parse(join(repository, resourceRoot, "RESULT.json"));
assert.equal(resources.resourceProfile.executed, 5); assert.equal(resources.resourceProfile.unexpected, 0);
const prerequisites = parse(join(repository, resourceRoot, "prerequisites-01/RESULT.json"));
assert.equal(prerequisites.status, "PREREQUISITES-75-PASS"); assert.equal(prerequisites.invocation, 1); assert.equal(prerequisites.retries, 0);
assert.equal(prerequisites.summary.declared, 75);
const packageBase64 = join(frozen, "admission-v2/admission-01/package.tgz.base64");
const packageBytes = Buffer.from(readFileSync(packageBase64, "utf8").trim(), "base64");
assert.equal(packageBytes.length, 717103); assert.equal(sha256(packageBytes), packSha);
json(join(here, "PREAUTH.json"), { schema: "html-actual34-preauth/1", at: new Date().toISOString(), candidate, freeze, tree: binding.tree, receiptPath, fixturePaths, protectedFiles, commits, tools, html, runner: { commit: author, sha256: fileHash(join(frozen, "admission-v2/run.mjs")), clarification: "93772a99 is a SHA256 prefix, not an existing Git commit prefix; accepted runner is admission-only." }, coreSha, bindingPath, bindingSha256: fileHash(bindingPath), package: { base64: relative(repository, packageBase64), sha256: packSha, bytes: packageBytes.length, memberHashes: binding.pack.files }, composition: { partialCommit: "7f272e4bdee84d3a40b0e3b9c2577b74b12bc6ef", partial: partial.verified, resourceCommits: ["49a35b8944728e05f3730a5a79aad91a5c9f8390", "3eb9767d5d6e6ec97c5e3c860aceb096d89d6575"], resourceProfile: resources.resourceProfile, prerequisiteCommit: "6758ae90b6561ff71a2064c09621e4a3fe724f4c", prerequisiteRecipe: prerequisites.recipe.commit, prerequisiteStatus: prerequisites.status, prerequisiteSummary: prerequisites.summary, reuse: "Accepted committed evidence, not new execution. No full archive replay, resource5, prerequisite75, build or reconstruction. Exact410 compiler-input evidence is distinct from complete archive proof; scoped reconstructions are not loose-object retention or full-clone guarantees." }, scope: "Node22 original frozen runtime profile: 34 x installed/moved = 68; five types per layout; ten control classes. No new exact close-disposition assertions; frozen unscored fields remain unscored." });
console.log(JSON.stringify({ status: "authenticated", originalFixtures: fixturePaths.length, protectedFiles: Object.keys(protectedFiles).length, packageSha256: packSha, candidate }));
