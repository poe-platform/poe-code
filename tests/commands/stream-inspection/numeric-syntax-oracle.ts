import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { capture, defaultGnu, identity } from "./oracle.js";
import { numericSyntaxCases } from "./numeric-syntax-cases.js";
import { runFixture } from "./helpers.js";

export function sourceManifest() {
  const hashes = Object.fromEntries(readdirSync("src/commands/stream-inspection").sort().map(name => {
    const path = `src/commands/stream-inspection/${name}`;
    return [path, createHash("sha256").update(readFileSync(path)).digest("hex")];
  }));
  return { hashes, sha256: createHash("sha256").update(Object.entries(hashes).map(([path, hash]) => `${path}\0${hash}\n`).join("")).digest("hex") };
}

export function captureNumericSyntax() {
  const binaries = {
    expand: { path: `${defaultGnu}/expand`, sha256: "158dccaca888f3187291f4f4ede9b3715ccee15e8e441f82030dc09d25a2648b", version: "expand (GNU coreutils) 9.7" },
    fold: { path: `${defaultGnu}/fold`, sha256: "8cfe2de684b57136dcb7040d529289b610f4f15a4f8696cded679d56a5361559", version: "fold (GNU coreutils) 9.7" },
    strings: { path: "/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings", sha256: "90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f", version: "GNU strings (GNU Binutils) 2.44" },
  };
  const identities = () => Object.fromEntries(Object.entries(binaries).map(([name, binary]) => {
    const details = identity(binary.path);
    assert.equal(details.sha256, binary.sha256);
    assert.equal(details.versionStatus, 0);
    assert.ok(details.version.startsWith(binary.version));
    return [name, details];
  }));
  const before = identities();
  const observations = numericSyntaxCases.map(specimen => capture(specimen, binaries[specimen.command as keyof typeof binaries].path));
  const after = identities();
  assert.deepEqual(after, before);
  return { startedProfile: { platform: platform(), release: release(), arch: arch(), LC_ALL: "C", LANG: "C", TZ: "UTC" }, before, observations, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2] === "--corrected" ? "fixer-numeric-controls.json" : "fixer-numeric-before.json";
  assert.equal(existsSync(`tests/commands/stream-inspection/evidence/${destination}`), false, "never overwrite previous evidence");
  const started = new Date().toISOString();
  const source = sourceManifest();
  const native = captureNumericSyntax();
  const before = [];
  for (const specimen of numericSyntaxCases) {
    const result = await runFixture(specimen);
    before.push({ id: specimen.id, exitCode: result.exitCode, stdoutHex: result.stdoutHex, stderr: result.stderr });
  }
  assert.deepEqual(sourceManifest(), source);
  const content = JSON.stringify({ started, finished: new Date().toISOString(), source, fixtures: numericSyntaxCases, native, before }, null, 2);
  execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: tests/commands/stream-inspection/evidence/${destination}\n` + content.split("\n").map(line => "+" + line).join("\n") + "\n*** End Patch\n" });
}
