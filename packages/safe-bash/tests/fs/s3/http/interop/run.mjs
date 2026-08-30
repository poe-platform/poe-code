import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const binary = resolve(process.argv[2]);
const suite = process.argv[3] ?? "transport";
assert.ok(suite === "transport" || suite === "fallback");
const output = mkdtempSync("/tmp/safe-bash-s3-http-interop-");
const archive = join(output, "archive"); mkdirSync(archive);
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const pin = git("rev-parse", "HEAD").toString().trim();
const digest = data => createHash("sha256").update(data).digest("hex");
const httpManifest = () => readdirSync(join(repository, "src/fs/s3/http")).filter(name => name.endsWith(".ts")).sort()
  .map(name => ({ path: `src/fs/s3/http/${name}`, sha256: digest(readFileSync(join(repository, "src/fs/s3/http", name))) }));
const httpBefore = httpManifest();
const tar = git("archive", pin, "src", "package.json", "tsconfig.json", "tsconfig.build.json");
assert.equal(spawnSync("tar", ["-xf", "-", "-C", archive], { input: tar }).status, 0);
cpSync(join(repository, "src/fs/s3/http"), join(archive, "src/fs/s3/http"), { recursive: true });
assert.deepEqual(httpBefore, httpBefore.map(entry => ({ path: entry.path, sha256: digest(readFileSync(join(archive, entry.path))) })));
cpSync(join(repository, "tests/fs/s3/http/interop"), join(archive, "tests/fs/s3/http/interop"), { recursive: true,
  filter: path => !path.split("/").includes("evidence") });
symlinkSync(join(repository, "node_modules"), join(archive, "node_modules"));
const hash = data => createHash("sha256").update(data).digest("hex");
const walk = path => readdirSync(join(archive, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const files = [...walk("src"), ...walk("tests/fs/s3/http/interop")].sort();
const manifest = () => files.map(path => ({ path, sha256: hash(readFileSync(join(archive, path))) }));
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const before = manifest(); save("manifest-before.json", before);
save("provenance.json", { pin, sourceOverlay: "src/fs/s3/http only", node: process.version, status: git("status", "--short").toString(),
  latestHttpCommit: git("log", "-1", "--format=%H", pin, "--", "src/fs/s3/http").toString().trim(), httpBefore,
  httpMatchesPinnedCommit: httpBefore.every(entry => digest(git("show", `${pin}:${entry.path}`)) === entry.sha256) });
console.log(output);
for (const [name, args] of [["build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]],
  [suite, ["--unhandled-rejections=strict", `tests/fs/s3/http/interop/${suite}-check.mjs`, binary]]]) {
  const result = spawnSync(process.execPath, args, { cwd: archive, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(output, name + ".stdout"), result.stdout ?? ""); writeFileSync(join(output, name + ".stderr"), result.stderr ?? "");
  save(name + ".exit.json", { argv: [process.execPath, ...args], status: result.status, signal: result.signal, error: result.error?.message });
  console.log(name, result.status, result.stdout);
  if (result.status !== 0) { process.exitCode = 1; if (name === "build") break; }
}
assert.deepEqual(manifest(), before); save("manifest-after.json", manifest());
save("http-worktree-after.json", { httpAfter: httpManifest(), unchanged: JSON.stringify(httpBefore) === JSON.stringify(httpManifest()) });
