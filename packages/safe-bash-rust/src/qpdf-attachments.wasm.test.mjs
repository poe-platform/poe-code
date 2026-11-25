import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const {cases} = JSON.parse(readFileSync(new URL("../tests/fixtures/attachment-inspection.json", import.meta.url), "utf8"));
const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/qpdf-attachment-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`qpdf attachments match JavaScript: ${fixture.name}/${fixture.flags}`, async () => {
  const bytes = Buffer.from(cases[fixture.name].pdf, "base64");
  const bash = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    const script = `qpdf in.pdf ${fixture.flags}`;
    const result = await bash.exec(script);
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes)],
      [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
    const quiet = await bash.exec(`${script} --warning-exit-0`);
    assert.deepEqual([quiet.exitCode, quiet.stderr, quiet.stdoutBytes],
      [fixture.status === 3 ? 0 : fixture.status, result.stderr, result.stdoutBytes]);
    const limit = result.stdoutBytes.length + Buffer.byteLength(result.stderr);
    if (limit > 1) {
      const exact = await bash.exec(script, {limits: {maxOutputBytes: limit}});
      assert.deepEqual([exact.exitCode, exact.stderr, exact.stdoutBytes],
        [result.exitCode, result.stderr, result.stdoutBytes]);
      await assert.rejects(bash.exec(script, {limits: {maxOutputBytes: limit - 1}}),
        {name: "ShellLimitError", limit: "maxOutputBytes"});
    }
    assert.deepEqual(await bash.fs.readFile("/in.pdf"), new Uint8Array(bytes));
  } finally {await bash.dispose();}
});

for (const reference of ["3", "9", "0"]) test(`qpdf ignores invalid duplicate attachment reference ${reference}`, async () => {
  const bytes = Buffer.from(cases.duplicates.pdf, "base64");
  const offset = bytes.indexOf("/F 4 0 R");
  assert.notEqual(offset, -1);
  bytes[offset + 3] = reference.charCodeAt(0);
  const bash = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    for (const [flags, status, stdout, stderr] of [
      ["--list-attachments", 0, "alpha -> 8,0\n", ""],
      ["--show-attachment=alpha", 0, "XYZ", ""],
      ["--show-attachment=actual.bin", 2, "", "qpdf: attachment actual.bin not found\n"],
    ]) {
      const result = await bash.exec(`qpdf in.pdf ${flags}`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [status, stdout, stderr]);
    }
    assert.deepEqual(await bash.fs.readFile("/in.pdf"), new Uint8Array(bytes));
  } finally {await bash.dispose();}
});

test("qpdf attachment object-read errors remain errors", async () => {
  const bytes = Buffer.from(cases.duplicates.pdf, "base64");
  const offset = bytes.indexOf("4 0 obj");
  assert.notEqual(offset, -1);
  bytes[offset] = "X".charCodeAt(0);
  const bash = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    for (const flags of ["--list-attachments", "--show-attachment=alpha", "--show-attachment=actual.bin"]) {
      const result = await bash.exec(`qpdf in.pdf ${flags}`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [2, "", "qpdf: in.pdf: invalid PDF object or stream\n"]);
    }
    assert.deepEqual(await bash.fs.readFile("/in.pdf"), new Uint8Array(bytes));
  } finally {await bash.dispose();}
});
