import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const recipe = dirname(fileURLToPath(import.meta.url));
export const owned = dirname(recipe);
export const repository = resolve(owned, "../../..");
export const author = "tests/integration/html-public-independent-20260827/admission-v2";
export const independent = "tests/integration/html-public-admission-v2-independent-20260827";
export const node = "/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node";
export const parse = filename => JSON.parse(readFileSync(filename, "utf8"));
export const write = (filename, value) => writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
export async function digest(source) {
  const hash = createHash("sha256");
  for await (const bytes of source) hash.update(bytes);
  return hash.digest("hex");
}
export const fileHash = filename => digest(createReadStream(filename, { highWaterMark: 65536 }));
export async function gitHash(commit, filename) {
  const child = spawn("/usr/bin/git", ["--no-replace-objects", "show", `${commit}:${filename}`], { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolveResult, reject) => { child.once("error", reject); child.once("close", code => resolveResult(code)); });
  child.stderr.resume();
  const hash = await digest(child.stdout);
  assert.equal(await closed, 0);
  return hash;
}
export function inventory(directory, prefix = "") {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
    const filename = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink());
    return entry.isDirectory() ? [`${filename}/`, ...inventory(directory, filename)] : [filename];
  });
}
export async function authenticate() {
  const selected = [];
  async function verify(filename, expected, commit) {
    assert.equal(await fileHash(join(repository, filename)), expected, `live ${filename}`);
    assert.equal(await gitHash(commit, filename), expected, `Git ${filename}`);
    selected.push({ path: filename, sha256: expected, bytes: statSync(join(repository, filename)).size, commit });
  }
  const authorCommit = "aa4374b0ab5f0789e51026b7c6fe163c044a9a6c";
  const independentCommit = "d28083dd43c7d1b513ec195b38df2f7fd3e15b48";
  await verify(`${author}/SEAL.json`, "82347c76a2730e7ddbab6c696c5558b657edc6b4701549505ef4e557420c6aa7", authorCommit);
  await verify(`${independent}/MANIFEST.json`, "3d78ae7a8967aafba3a33343d9ded8d3bb964c63d8ac1a60033750eae73c3d1e", independentCommit);
  const seal = parse(join(repository, author, "SEAL.json"));
  const manifest = parse(join(repository, independent, "MANIFEST.json"));
  assert.equal(manifest.coveredFiles, 92);
  assert.equal(manifest.fileCountIncludingManifest, 93);
  const relevantControl = filename => /^(?:PRE|SUMMARY)\.json$/.test(filename) || /^0(?:29|30|31|32|33|34|35)-/.test(filename);
  const authorFiles = ["core.mjs", "controls.mjs", "stream-fixture.mjs", "run.mjs", "binding-04/BINDINGS.json", "controls-01/001-exact-metadata-and410-inputs.json", ...Object.keys(seal.files).filter(filename => filename.startsWith("controls-01/") && relevantControl(filename.slice("controls-01/".length)))];
  const independentFiles = ["execution/controls.PRE.json", "execution/controls.stdout.data", "execution/controls.stderr.data", "execution/SUPERVISOR.json", "supervise.mjs", "README.md", "STATIC-REVIEW.md", "SETTLEMENT-QUALIFICATION.json", "execution/controls/001-exact-metadata-and410-inputs.json", ...Object.keys(manifest.files).filter(filename => filename.startsWith("execution/controls/") && relevantControl(filename.slice("execution/controls/".length)))];
  for (const filename of authorFiles) await verify(`${author}/${filename}`, seal.files[filename], authorCommit);
  for (const filename of independentFiles) await verify(`${independent}/${filename}`, manifest.files[filename].sha256, independentCommit);
  const tools = [];
  for (const filename of [node, "/usr/bin/git", "/bin/ps"]) tools.push({ path: filename, realpath: realpathSync(filename), sha256: await fileHash(filename) });
  assert.equal(tools[0].sha256, "5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011");
  assert.equal(tools[1].sha256, "12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba");
  assert.equal(process.version, "v22.22.2");
  const memoryMentions = selected.flatMap(entry => {
    if (!entry.path.startsWith(independent) && !entry.path.includes("controls-01/")) return [];
    return readFileSync(join(repository, entry.path), "utf8").split("\n").flatMap((line, index) => /Rss|RSS|heapUsed|heapTotal|arrayBuffers|external|maxRSS/.test(line) ? [{ path: entry.path, line: index + 1, text: line }] : []);
  });
  return { at: new Date().toISOString(), selected, selectedCount: selected.length, tools, memoryMentions, independentManifestCounts: { files: 93, covered: 92 }, scope: "Selected small source/capture files only; no full archive hashing. v2run binding is admission-v2/run.mjs. Original independent RSS number not present in searched captures; author positive number is a different execution." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) write(process.argv[2], await authenticate());
