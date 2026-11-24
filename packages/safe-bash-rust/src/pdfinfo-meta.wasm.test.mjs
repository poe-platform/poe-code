import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createRustWasmBash} from "./index.js";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/pdfinfo-meta-parity.json", import.meta.url), "utf8"));
for (const fixture of fixtures) test(`pdfinfo metadata handling matches JavaScript: ${fixture.name}/${fixture.args.join(" ")}`, async () => {
  const bytes = Buffer.from(fixture.pdf, "base64");
  const shell = await createRustWasmBash({forceNative: true, cwd: "/", files: {"/in.pdf": bytes}});
  try {
    const result = await shell.exec("pdfinfo " + fixture.args.join(" "));
    assert.deepEqual([result.exitCode, result.stderr, Buffer.from(result.stdoutBytes)],
      [fixture.status, fixture.stderr, Buffer.from(fixture.stdout, "base64")]);
    assert.deepEqual(await shell.fs.readFile("/in.pdf"), new Uint8Array(bytes));
    if (fixture.args.length === 2 && fixture.args[0] === "-meta") {
      if (fixture.commandError) {
        const later = await shell.exec("\n\npdfinfo -meta in.pdf");
        assert.deepEqual([later.exitCode, later.stdout, later.stderr], [1, "", "shell: line 3: internal error\n"]);
      } else if (result.stdoutBytes.length > 1) {
        const exact = await shell.exec("pdfinfo -meta in.pdf", {limits: {maxOutputBytes: result.stdoutBytes.length}});
        assert.deepEqual([exact.exitCode, exact.stdout, exact.stderr], [result.exitCode, result.stdout, result.stderr]);
        await assert.rejects(shell.exec("pdfinfo -meta in.pdf", {limits: {maxOutputBytes: result.stdoutBytes.length - 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
      }
    }
  } finally {await shell.dispose();}
});
