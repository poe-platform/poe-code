import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const objectHash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
let root;
if (process.argv[2] === "--admit") {
  root = fs.mkdtempSync("/tmp/bash-strict-mode-design-");
  fs.writeFileSync(path.join(root, "START.json"), JSON.stringify({ started: new Date().toISOString(), role: "SOURCE_DATA_ONLY", product: 0, native: 0, build: 0, private: 0 }), { flag: "wx" });
  fs.writeFileSync(path.join(own, "CAPTURE.json"), JSON.stringify({ root }), { flag: "wx" });
} else root = JSON.parse(fs.readFileSync(path.join(own, "CAPTURE.json"))).root;
const output = [];
try {
  function admitted(relative) {
    assert.ok(!relative.includes("..") && !relative.split("/").includes("AGENTS.md"));
    const filename = path.join(repo, relative), stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024);
    return fs.readFileSync(filename);
  }
  function git(args, name, input) {
    const result = spawnSync("/usr/bin/git", args, { cwd: repo, input, maxBuffer: 4 * 1024 * 1024, timeout: 10000, env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } });
    fs.writeFileSync(path.join(root, name + ".stdout"), result.stdout ?? Buffer.alloc(0), { flag: "wx" });
    fs.writeFileSync(path.join(root, name + ".stderr"), result.stderr ?? Buffer.alloc(0), { flag: "wx" });
    output.push({ args, code: result.status, signal: result.signal });
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    return result.stdout;
  }
  if (process.argv[2] === "--admit") {
    const bytes = admitted("tests/integration/git-public-20260829/SOURCE.json");
    assert.equal(hash(bytes), "14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450");
    const manifest = JSON.parse(bytes); assert.equal(manifest.computedTree, "c83f352f057c64917f219eb938f54aa42cdab829");
    const selected = manifest.inputs.filter(row => row.path.startsWith("src/shell/") || ["src/contracts/command.ts", "src/contracts/io.ts"].includes(row.path));
    assert.ok(selected.length <= 32);
    const stream = git(["cat-file", "--batch"], "selected-blobs", selected.map(row => row.blob).join("\n") + "\n");
    let cursor = 0;
    for (const row of selected) {
      const newline = stream.indexOf(10, cursor); assert.equal(stream.subarray(cursor, newline).toString(), `${row.blob} blob ${row.bytes}`);
      cursor = newline + 1; const body = stream.subarray(cursor, cursor + row.bytes); cursor += row.bytes + 1;
      assert.equal(stream[cursor - 1], 10); assert.equal(hash(body), row.sha256); assert.equal(objectHash(body), row.blob);
      const filename = path.join(root, row.path + ".data"); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, body, { flag: "wx" });
    }
    assert.equal(cursor, stream.length);
    const overlayBytes = admitted("tests/compatibility/bash-redirection-author-20260829/SOURCE.json"), overlay = JSON.parse(overlayBytes);
    assert.equal(hash(overlayBytes), "d181f7d3b5acfcb5521dd5cc26be0aa4f2ac15b3fed1df4b8c729f25b5e34b17");
    const patch = git(["diff", "1e9b83d7^", "1e9b83d7", "--", "src/shell/parser.ts", "src/shell/runtime.ts", "src/shell/display.ts"], "provisional-redirection-diff");
    git(["status", "--porcelain=v1", "-z", "--untracked-files=no"], "tracked-status-nul");
    git(["diff", "--cached", "--name-only", "-z"], "index-nul");
    const binding = { role: "FIXED_C83_SOURCE_WITH_SEPARATE_PROVISIONAL_REDIRECTION_DIFF", candidate: manifest.computedTree, acceptedBy: "9dca6b405f7059bd54848422d27a80afdf80e504", sourceManifestSha256: hash(bytes), selected, provisionalRedirection: { sourceCommit: "1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e", candidate: overlay.computedTree, sourceSha256: hash(overlayBytes), diffSha256: hash(patch), scope: "review-pending; no unit2 changes included" }, children: output, native: 0, product: 0, compiler: 0, workers: 0 };
    fs.writeFileSync(path.join(root, "BINDING.json"), JSON.stringify(binding, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ root, selected: selected.length, candidate: binding.candidate, provisional: binding.provisionalRedirection, children: output }));
  } else {
    assert.equal(process.argv[2], "--read");
    const requests = JSON.parse(process.argv[3]); assert.ok(Array.isArray(requests) && requests.length <= 8);
    const binding = JSON.parse(fs.readFileSync(path.join(root, "BINDING.json")));
    for (const request of requests) {
      const row = binding.selected.find(row => row.path === request.path); assert.ok(row);
      const bytes = fs.readFileSync(path.join(root, row.path + ".data")); assert.equal(hash(bytes), row.sha256);
      const lines = bytes.toString().split("\n");
      const text = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern, "u").test(line) ? [`${index + 1}:${line}`] : []).join("\n") : lines.slice(request.from - 1, request.to).map((line, index) => `${request.from + index}:${line}`).join("\n");
      output.push({ request, sha256: row.sha256, text });
    }
    const data = JSON.stringify(output, null, 2); assert.ok(Buffer.byteLength(data) <= 256 * 1024);
    const index = fs.readdirSync(root).filter(name => /^read-\d+\.json$/.test(name)).length + 1;
    fs.writeFileSync(path.join(root, `read-${index}.json`), data, { flag: "wx" });
    for (const row of output) console.log(JSON.stringify(row.request), row.text);
  }
} catch (error) { fs.writeFileSync(path.join(root, `ERROR-${Date.now()}.json`), JSON.stringify({ output, error: String(error), stack: error.stack }), { flag: "wx" }); throw error; }
