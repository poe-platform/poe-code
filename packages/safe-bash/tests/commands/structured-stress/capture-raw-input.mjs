import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const native = argv => spawnSync("/usr/bin/jq", argv, { shell: false, timeout: 2000, maxBuffer: 65536 });
const version = native(["--version"]);
assert.equal(version.status, 0);
assert.equal(version.stdout.toString().trim(), "jq-1.7.1-apple");
const cases = [];
const add = (id, argv, input, extra = {}) => cases.push({ id, argv, inputHex: Buffer.from(input).toString("hex"), ...extra });
for (const [name, input] of Object.entries({ empty: "", blank: "\n", blanks: "\n\n", lf: "a\nb\n", partial: "a\nb", crlf: "a\r\nb\rc\nlast\r", unicode: "😀\né\n雪", bom: "\uFEFFtext\n", controls: "a\u0000b\t\n\u001b" })) {
  for (const flags of ["-Rc", "-Rsc", "-Rr", "-Rsj", "-Re"]) add(`${name}:${flags}`, [flags, "."], input);
}
for (const [id, argv, input] of [
  ["long-options", ["--raw-input", "--slurp", "--raw-output", "."], "a\r\nb"],
  ["join-output-long", ["--raw-input", "--join-output", "."], "a\nb\n"],
  ["join-nonstrings", ["-Rcj", ".,null,false,0,[1]"], "x\n"],
  ["join-then-raw", ["-Rjr", "."], "a\nb"],
  ["raw-then-join", ["-Rrj", "."], "a\nb"],
  ["status-false", ["-Re", "false"], "x\n"],
  ["status-null", ["-Rej", "null"], "x\n"],
  ["status-empty", ["-Re", "empty"], "x\n"],
  ["status-prior", ["-Re", "select(length > 0)"], "x\n\n"],
  ["null-slurp", ["-Rnsce", "."], Buffer.from([255])],
  ["null-raw", ["--raw-input", "--null-input", "--join-output", "."], "ignored"],
  ["record-error-prefix", ["-Rc", ".,1/0"], "x\ny\n"],
]) add(id, argv, input, id === "record-error-prefix" ? { policy: "stop-first-runtime-error", policyStdout: '"x"\n', policyStatus: 5 } : {});
const files = [{ path: "first.txt", inputHex: Buffer.from("a\r\npartial").toString("hex") }, { path: "empty.txt", inputHex: "" }, { path: "last.txt", inputHex: Buffer.from("b\nlast").toString("hex") }];
for (const flags of ["-Rc", "-Rsc", "-Rj", "-Rns"]) add(`files:${flags}`, [flags, ".", "first.txt", "empty.txt", "-", "last.txt", "-"], "stdin\ntail", { files });
for (const flags of ["-Rc", "-Rsc"]) add(`file-unicode:${flags}`, [flags, ".", "unicode-start", "-"], Buffer.from([0x98, 0x80, 10]), { files: [{ path: "unicode-start", inputHex: "f09f" }], policy: "strict-utf8-per-file", policyStdout: "", policyStatus: 5 });
add("null-missing-file", ["-Rns", ".", "missing-file"], Buffer.from([255]));
for (const [index, bytes] of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f], [0x80]].entries()) {
  for (const flags of ["-Rc", "-Rsc"]) add(`invalid:${index}:${flags}`, [flags, "."], Buffer.concat([Buffer.from("ok\n"), Buffer.from(bytes)]), { policy: "strict-utf8", policyStdout: flags === "-Rc" ? '"ok"\n' : "", policyStatus: 5 });
}
const directory = mkdtempSync(join(tmpdir(), "safe-bash-raw-capture-"));
try {
  for (const fixture of cases) {
    for (const file of fixture.files ?? []) writeFileSync(join(directory, file.path), Buffer.from(file.inputHex, "hex"));
    const result = spawnSync("/usr/bin/jq", fixture.argv, { cwd: directory, input: Buffer.from(fixture.inputHex, "hex"), shell: false, timeout: 2000, maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    Object.assign(fixture, { stdout: result.stdout.toString(), status: result.status, stderr: result.stderr.toString().slice(0, 4096) });
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
const document = { provenance: { executable: "/usr/bin/jq", version: "jq-1.7.1-apple", date: "2026-08-26", shell: false, timeout: 2000, maxBuffer: 65536 }, cases };
const path = "tests/commands/structured-stress/raw-input-native.json";
const patch = `*** Begin Patch\n*** Add File: ${path}\n${JSON.stringify(document, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
const applied = spawnSync("apply_patch", [patch], { encoding: "utf8", shell: false, timeout: 2000, maxBuffer: 65536 });
assert.equal(applied.status, 0, applied.stderr);
console.log(`${cases.length} raw-input captures; ${cases.filter(fixture => fixture.policy).length} explicit safety policy differences`);
