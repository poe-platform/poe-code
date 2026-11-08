import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const freeze = process.argv[2];
if (!/^[0-9a-f]{40}$/u.test(freeze ?? "")) throw new Error("usage: node verify-freeze.mjs EXACT_40_CHAR_FREEZE_COMMIT");
const relativeRoot = "tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function git(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", status => status === 0 ? resolvePromise(Buffer.concat(stdout)) : rejectPromise(new Error(Buffer.concat(stderr).toString())));
  });
}
const resolved = (await git(["rev-parse", `${freeze}^{commit}`])).toString().trim();
if (resolved !== freeze) throw new Error("freeze revision did not resolve exactly");
const manifestBytes = await git(["show", `${freeze}:${relativeRoot}/MANIFEST.json`]);
const manifest = JSON.parse(manifestBytes.toString());
const tree = (await git(["ls-tree", "-r", "--name-only", freeze, "--", relativeRoot])).toString().split("\n").filter(Boolean);
if (tree.some(path => /(^|\/)AGENTS\.md$/u.test(path))) throw new Error("freeze contains forbidden AGENTS file");
const expected = [...manifest.files.map(file => `${relativeRoot}/${file.path}`), `${relativeRoot}/MANIFEST.json`].sort();
if (JSON.stringify(tree.sort()) !== JSON.stringify(expected)) throw new Error("manifest is not a complete frozen-tree inventory");
for (const file of manifest.files) {
  const path = `${relativeRoot}/${file.path}`;
  const bytes = await git(["show", `${freeze}:${path}`]);
  const blob = (await git(["rev-parse", `${freeze}:${path}`])).toString().trim();
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256 || blob !== file.gitBlob) throw new Error(`mismatch: ${file.path}`);
}
process.stdout.write(`${JSON.stringify({ freeze, tree: (await git(["rev-parse", `${freeze}^{tree}`])).toString().trim(), manifestSha256: sha256(manifestBytes), fileCount: manifest.files.length + 1, allNonSelfBytesVerified: true, forbiddenAgents: 0 }, null, 2)}\n`);
