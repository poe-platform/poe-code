import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const directory = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const baseline = JSON.parse(readFileSync(join(directory, "baseline.json")));
const original = baseline.originals["tests/shell/script-entrypoint.test.ts"];
const syntax = ts.createSourceFile("original.ts", original.text, ts.ScriptTarget.Latest, true);
const fixtures = [];
function visit(node) {
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 4 && ts.isStringLiteral(node.elements[0]) && ["plain", "env"].includes(node.elements[0].text)) {
    fixtures.push({ name: node.elements[0].text, body: node.elements[1].text, mode: Number(node.elements[2].text), oldDiagnostic: node.elements[3].text });
  }
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.deepEqual(fixtures.map(fixture => fixture.name), ["plain", "env"]);
const profiles = [
  { name: "GNU5.3-primary", executable: "/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash", sha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c" },
  { name: "Bash3.2-historical", executable: "/bin/bash", sha256: "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3" },
];
const evidence = { startedAt: new Date().toISOString(), fixtureSourceSha256: original.sha256, fixtureSourceGitBlob: original.gitBlob, envExecutable: { path: "/usr/bin/env", sha256: digest(readFileSync("/usr/bin/env")) }, rows: [] };
for (const profile of profiles) {
  assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
  const scratch = realpathSync(mkdtempSync(join(directory, ".native-")));
  try {
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    for (const name of ["bash", "sh"]) symlinkSync(profile.executable, join(bin, name));
    writeFileSync(join(bin, "say"), `#!${profile.executable}\nprintf '%s\\n' "$*"\n`);
    chmodSync(join(bin, "say"), 0o755);
    const environment = { PATH: bin, HOME: scratch, LC_ALL: "C", LANG: "C", TZ: "UTC" };
    const version = spawnSync(profile.executable, ["--version"], { env: environment, cwd: scratch, timeout: 2000, maxBuffer: 65536 });
    assert.equal(version.status, 0);
    for (const fixture of fixtures) {
      const filename = join(scratch, fixture.name);
      writeFileSync(filename, Buffer.from(fixture.body));
      chmodSync(filename, fixture.mode);
    }
    function snapshot() {
      return Object.fromEntries([...readdirSync(scratch).filter(name => name !== "bin").map(name => [name, { hex: readFileSync(join(scratch, name)).toString("hex"), mode: lstatSync(join(scratch, name)).mode & 0o777 }]), ...readdirSync(bin).map(name => [`bin/${name}`, lstatSync(join(bin, name)).isSymbolicLink() ? { target: readlinkSync(join(bin, name)) } : { hex: readFileSync(join(bin, name)).toString("hex"), mode: lstatSync(join(bin, name)).mode & 0o777 }])]);
    }
    for (const fixture of fixtures) {
      const before = snapshot();
      const args = ["--noprofile", "--norc", "-c", `./${fixture.name}`];
      const result = spawnSync(profile.executable, args, { env: environment, cwd: scratch, input: Buffer.alloc(0), timeout: 2000, maxBuffer: 65536 });
      const after = snapshot();
      const row = { profile, version: version.stdout.toString(), fixture, inputBodyHex: Buffer.from(fixture.body).toString("hex"), cwd: scratch, environment, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex"), before, after, roles: fixture.name === "plain" ? "Profile Bash handles headerless executable fallback; say is a sandbox helper executed by the same pinned Bash." : "Profile Bash launches the executable; kernel shebang invokes actual /usr/bin/env; isolated PATH bash link selects the pinned profile; say helper also uses that profile." };
      evidence.rows.push(row);
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.deepEqual(after, before);
    }
    assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
evidence.finishedAt = new Date().toISOString();
evidence.generatedFixtureNote = "Only generated native sandbox fixtures use filesystem writes, chmod and profile symlinks; exact no-final-newline bodies come from the immutable old TypeScript AST. Repository code/evidence edits use apply_patch. Scratch trees are removed in finally.";
const output = join(directory, "native.json");
const patch = `*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
const saved = spawnSync("apply_patch", [patch], { encoding: "utf8" });
assert.equal(saved.status, 0, saved.stderr);
console.log(JSON.stringify(evidence.rows.map(({ profile, fixture, status, stdoutHex, stderrHex }) => ({ profile: profile.name, name: fixture.name, status, stdoutHex, stderrHex })), null, 2));
