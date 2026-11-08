import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const original = fs.readFileSync(path.join(own, "types.mts.fixture"), "utf8"), corrected = fs.readFileSync(path.join(own, "types-v2.mts.fixture"), "utf8");
assert.equal(original.replace('from "virtual-bash/shell";', 'from "virtual-bash";'), corrected);
const hashes = Object.fromEntries(["types-v2.mjs", "types-v2.mts.fixture", "types.mts.fixture"].map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
const sealPath = path.join(own, "TYPE-BINDING-v2.json");
if (process.argv[2] === "--seal") {
  fs.writeFileSync(sealPath, JSON.stringify({ sealedAt: new Date().toISOString(), hashes,
    change: 'Exactly one module specifier: ShellInvokeOptions import "virtual-bash/shell" -> "virtual-bash"',
    reason: "Candidate package exports root re-export of shell types; no ./shell subpath. Prior TS2307 is reviewer binding error, not missing product API.",
    preserves: "Original positive compile status2 in both layouts and negative4 diagnostics including TS2307; all semantic assertions/directives remain unchanged", runtimeReruns: 0,
    sourceCaptureCompressedSha256: "88fadf81a9ab984e4c25ff26f9f1d13331967549c0dbe08fbce268ee7ed1da12" }, null, 2) + "\n", { flag: "wx" });
  process.exit(0);
}
const seal = JSON.parse(fs.readFileSync(sealPath, "utf8")); assert.deepEqual(hashes, seal.hashes);
const compressed = Buffer.from(fs.readFileSync(path.join(own, "actual-01.json.gz.base64"), "utf8"), "base64"); assert.equal(hash(compressed), seal.sourceCaptureCompressedSha256);
const prior = JSON.parse(gunzipSync(compressed)), tarball = Buffer.from(prior.package.base64, "base64");
assert.equal(hash(tarball), "13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9");
const output = path.join(own, "type-observations-v2.json.gz.base64"); assert.equal(fs.existsSync(output), false);
const root = fs.realpathSync(fs.mkdtempSync("/tmp/combined77-types-v2-")), tools = path.join(root, "tools/node_modules");
const capture = { startedAt: new Date().toISOString(), root, seal, packageSha256: hash(tarball), records: [], layouts: {}, runtimeExecutions: 0 };
const inventory = directory => {
  const files = {};
  const walk = current => { for (const name of fs.readdirSync(current).sort()) {
    const filename = path.join(current, name), stat = fs.lstatSync(filename);
    if (stat.isDirectory()) walk(filename); else { assert.ok(stat.isFile()); files[path.relative(directory, filename)] = { sha256: hash(fs.readFileSync(filename)), bytes: stat.size, mode: stat.mode & 0o777 }; }
  } }; walk(directory); return files;
};
try {
  for (const [name, data] of Object.entries(prior.tools)) {
    assert.deepEqual(inventory(data.input), data.files);
    const target = path.join(tools, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(data.input, target, { recursive: true });
    assert.deepEqual(inventory(target), data.files);
  }
  const installed = path.join(root, "installed"), packageRoot = path.join(installed, "node_modules/virtual-bash"); fs.mkdirSync(packageRoot, { recursive: true });
  const extract = spawnSync("/usr/bin/tar", ["-xz", "--strip-components=1", "-C", packageRoot], { input: tarball }); assert.equal(extract.status, 0);
  assert.deepEqual(inventory(packageRoot), prior.packageInventory);
  fs.writeFileSync(path.join(installed, "types.mts"), corrected);
  fs.writeFileSync(path.join(installed, "negative.mts"), corrected.replace(/^\/\/ @ts-expect-error[^\n]*\n/gmu, ""));
  for (const layout of ["installed", "moved"]) {
    const directory = layout === "installed" ? installed : path.join(root, "physically moved");
    if (layout === "moved") { fs.renameSync(installed, directory); assert.equal(fs.existsSync(installed), false); }
    for (const name of ["types", "negative"]) {
      const args = [path.join(tools, "typescript/bin/tsc"), "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(tools, "@types"), "--listFiles", path.join(directory, `${name}.mts`)];
      const child = spawnSync(process.execPath, args, { cwd: directory, env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LC_ALL: "C" }, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      capture.records.push({ layout, name, args, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr, pid: child.pid });
      assert.equal(child.error, undefined); assert.equal(child.signal, null);
      assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH");
      const diagnostics = child.stdout.match(/error TS\d+:/gu) ?? [];
      assert.equal(child.status, name === "types" ? 0 : 2, child.stdout);
      assert.equal(diagnostics.length, name === "types" ? 0 : 3);
      if (name === "negative") assert.deepEqual(diagnostics, ["error TS2540:", "error TS2322:", "error TS2353:"]);
      for (const required of ["dist/index.d.ts", "dist/shell/types.d.ts", "dist/contracts/command.d.ts", "dist/commands/which/index.d.ts"]) assert.ok(child.stdout.includes(path.join(directory, "node_modules/virtual-bash", required)), required);
      capture.layouts[`${layout}-${name}`] = { status: child.status, diagnostics };
    }
    assert.deepEqual(inventory(path.join(directory, "node_modules/virtual-bash")), prior.packageInventory);
  }
  capture.completed = true;
} catch (error) { capture.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  fs.rmSync(root, { recursive: true, force: true }); capture.temporaryRemoved = !fs.existsSync(root); capture.finishedAt = new Date().toISOString();
  const bytes = gzipSync(JSON.stringify(capture), { level: 9 }); fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: capture.completed, failure: capture.failure, layouts: capture.layouts, temporaryRemoved: capture.temporaryRemoved }));
}
