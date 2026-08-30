import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "safe-bash-webdav-public-consumer-"));
const archive = join(output, "archive");
mkdirSync(archive);
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const pin = git("rev-parse", "HEAD").toString().trim();
const source = git("archive", pin, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json");
assert.equal(spawnSync("tar", ["-xf", "-", "-C", archive], { input: source }).status, 0);
cpSync(join(repository, "tests/fs/webdav"), join(archive, "tests/fs/webdav"), {
  recursive: true, filter: path => !path.split("/").includes("evidence"),
});
symlinkSync(join(repository, "node_modules"), join(archive, "node_modules"));
const hash = content => createHash("sha256").update(content).digest("hex");
const walk = path => readdirSync(join(archive, path), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(path, entry.name)) : [join(path, entry.name)]);
const files = [...walk("src"), ...walk("tests/fs/webdav")].sort();
const manifest = () => files.map(path => ({ path, sha256: hash(readFileSync(join(archive, path))) }));
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const before = manifest();
save("manifest-before.json", before);
save("provenance.json", { pin, node: process.version, archiveSha256: hash(source), currentOwnedTests: true });
const strict = ["--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext",
  "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node"];
const commands = [
  { name: "build", args: ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"] },
  { name: "scoped-types", args: ["node_modules/typescript/bin/tsc", "--noEmit", ...strict,
    ...files.filter(path => (path.startsWith("src/fs/webdav/") || path.startsWith("tests/fs/webdav/")) && path.endsWith(".ts"))] },
  { name: "consumer-types", args: ["node_modules/typescript/bin/tsc", ...strict, "--rootDir", "tests/fs/webdav/consumer", "--outDir", "consumer-out",
    ...files.filter(path => path.startsWith("tests/fs/webdav/consumer/") && path.endsWith(".mts"))] },
  { name: "built-consumer", args: ["--unhandled-rejections=strict", "--test", "consumer-out/consumer.test.mjs"] },
];
save("commands.json", commands);
console.log(output);
let failed = false;
for (const command of commands) {
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: archive, encoding: "utf8", timeout: 120000,
    maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TMPDIR: output } });
  writeFileSync(join(output, command.name + ".stdout"), result.stdout ?? "");
  writeFileSync(join(output, command.name + ".stderr"), result.stderr ?? "");
  save(command.name + ".exit.json", { argv: [process.execPath, ...command.args], start, end: new Date().toISOString(),
    status: result.status, signal: result.signal, error: result.error?.message });
  console.log(command.name, result.status);
  if (result.status !== 0) failed = true;
}
assert.deepEqual(manifest(), before);
save("manifest-after.json", manifest());
save("artifact-hashes.json", [...walk("dist"), ...walk("consumer-out")].sort()
  .map(path => ({ path, sha256: hash(readFileSync(join(archive, path))) })));
process.exitCode = failed ? 1 : 0;
