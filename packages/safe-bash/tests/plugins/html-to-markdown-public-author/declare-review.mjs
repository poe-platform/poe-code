import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseline, inventory, rendererHash, validateDeclaration } from "../../integration/html-public-independent-20260827/contract.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const [reportDirectory, output] = process.argv.slice(2);
assert.ok(reportDirectory && output, "explicit final author report directory and new declaration filename required");
const report = JSON.parse(readFileSync(join(reportDirectory, "REPORT.json")));
assert.equal(report.status, "pass"); assert.deepEqual(report.failures, []);
const candidate = report.candidate;
const directory = realpathSync(mkdtempSync(join(tmpdir(), "html-review-declaration-")));
const archive = join(directory, "candidate.tar"), extracted = join(directory, "full-archive"); mkdirSync(extracted);
const git = args => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
git(["archive", "--format=tar", `--output=${archive}`, candidate]);
const hash = createHash("sha256"); for await (const bytes of createReadStream(archive)) hash.update(bytes);
execFileSync("/usr/bin/tar", ["-xf", archive, "-C", extracted]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const packageFiles = inventory(extracted), packFiles = inventory(report.package.installed);
assert.deepEqual(packFiles, Object.fromEntries(report.package.before.filter(entry => entry.kind === "file").map(entry => [entry.path, entry.sha256])));
assert.equal(packageFiles["src/commands/html-to-markdown/render.ts"], rendererHash);
const node = realpathSync(process.execPath), npm = realpathSync(join(dirname(node), "npm"));
const toolPaths = { node, npm, tsc: realpathSync(join(repository, "node_modules/typescript/bin/tsc")), typescript: realpathSync(join(repository, "node_modules/typescript")), nodeTypes: realpathSync(join(repository, "node_modules/@types/node")), undiciTypes: realpathSync(join(repository, "node_modules/undici-types")), npmRoot: dirname(dirname(npm)) };
const declaration = {
  candidateCommit: candidate, fixtureCommit: "54f1e4d819e0d3cde422c1f305a84474932e3bac", baselineCommit: baseline,
  declaredBy: "Curie author, routed through root; independent execution/acceptance not claimed", subpath: "virtual-bash/commands/html-to-markdown", agentOption: "htmlToMarkdown",
  changedProductPaths: git(["diff", "--name-only", baseline, candidate, "--", "src", "package.json"]).toString().trim().split("\n").filter(Boolean).sort(),
  htmlIoPaths: ["src/commands/html-to-markdown/index.ts"],
  sourceScopeApproval: "Root authorized HTML index/I/O routing only plus public/default integration. Only index.ts changes HTML behavior; input/budget/parser/renderer/options/entities/text retain accepted module bytes. src/commands/expr/README.md is an intervening foreign documentation change, not this review's semantic acceptance.",
  archiveSha256: hash.digest("hex"), packSha256: report.package.tarballSha256, rendererSha256: rendererHash,
  packageFiles, packFiles, packageExports: JSON.parse(readFileSync(join(extracted, "package.json"))).exports,
  workerFiles: Object.fromEntries(Object.entries(packFiles).filter(([path]) => path.startsWith("dist/commands/regex-execution/") && path.endsWith(".js"))),
  toolPaths, toolExecutables: Object.fromEntries(["node", "npm", "tsc"].map(name => [name, digest(readFileSync(toolPaths[name]))])),
  toolTrees: Object.fromEntries(["typescript", "nodeTypes", "undiciTypes", "npmRoot"].map(name => [name, digest(JSON.stringify(inventory(toolPaths[name])))])),
  clarifications: "Read README pending boundaries; no exit-status or opaque-preemption expansion",
};
validateDeclaration(declaration);
writeFileSync(output, JSON.stringify(declaration, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, candidate, fullArchiveFiles: Object.keys(packageFiles).length, packFiles: Object.keys(packFiles).length, archiveSha256: declaration.archiveSha256, packSha256: declaration.packSha256, directory }));
