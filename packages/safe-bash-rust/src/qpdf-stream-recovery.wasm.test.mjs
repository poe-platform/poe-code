import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const {cases} = JSON.parse(readFileSync(new URL("../tests/fixtures/stream-recovery.json", import.meta.url), "utf8"));
const {cases: reference} = JSON.parse(readFileSync(new URL("../tests/fixtures/qpdf-stream-parity.json", import.meta.url), "utf8"));

for (const [name, {pdf}] of Object.entries(cases)) test(`qpdf stream recovery matches JavaScript: ${name}`, async () => {
  const {reports, rewritten} = reference[name];
  const bytes = Buffer.from(pdf, "base64");
  const bash = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    for (const [flags, want] of Object.entries(reports)) for (const zero of [false, true]) {
      const result = await bash.exec(`qpdf in.pdf ${flags}${zero ? " --warning-exit-0" : ""}`);
      assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), result.stderr],
        [zero && want.status === 3 ? 0 : want.status, Buffer.from(want.stdout, "base64"), want.stderr], `${flags}/${zero}`);
    }
    const measured = await bash.exec("qpdf in.pdf --show-object=4");
    const limit = measured.stdoutBytes.length + Buffer.byteLength(measured.stderr);
    assert.deepEqual(await bash.exec("qpdf in.pdf --show-object=4", {limits: {maxOutputBytes: limit}}), measured);
    await assert.rejects(bash.exec("qpdf in.pdf --show-object=4", {limits: {maxOutputBytes: limit - 1}}),
      {name: "ShellLimitError", limit: "maxOutputBytes"});
    const written = await bash.exec("qpdf in.pdf --stream-data=uncompress out.pdf");
    const page = await bash.exec("qpdf out.pdf --show-pages");
    const stream = page.stdout.split("content:\n")[1].trim().split(" ")[0];
    const output = await bash.exec(`qpdf out.pdf --show-object=${stream} --raw-stream-data`);
    assert.deepEqual([output.exitCode, output.stderr, Buffer.from(output.stdoutBytes)],
      [0, "", Buffer.from(rewritten.stream, "base64")]);
    assert.equal((await bash.exec(`qpdf out.pdf --show-object=${stream}`)).stdout, rewritten.dictionary);
    assert.equal(written.exitCode, reports["--stream-data=uncompress out.pdf"].status);
    assert.deepEqual(await bash.fs.readFile("/in.pdf"), new Uint8Array(bytes));
  } finally {await bash.dispose();}
});
