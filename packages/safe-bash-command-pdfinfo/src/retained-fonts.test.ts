import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createPdffontsCommand, runPdffontsCli, runPdffontsCliSync } from "./index.js";

for (const flags of [[], ["-loc"], ["-locPS"], ["-subst"], ["-f", "2", "-l", "2"], ["-f", "3"]]) {
  it(`streams pdffonts output with buffered parity: ${flags.join(" ")}`, async () => {
    const doc = PdfDocument.create(); doc.addPage().drawText("first", { x: 0, y: 0 }); doc.addPage().drawText("second", { x: 0, y: 0 }); const bytes = doc.save();
    const args = [...flags, "in.pdf"]; const expected = runPdffontsCliSync(args, new Map([["in.pdf", bytes]]));
    const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); await fs.writeFile("/in.pdf", bytes);
    const injected = new Proxy(fs, { get(target, key) {
      if (key === "readFile") return async () => { throw new Error("whole input read forbidden"); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    let stdout = "", stderr = "";
    const result = await createPdffontsCommand({ limits: { maxInputBytes: bytes.length } }).execute({
      command: "pdffonts", args, cwd: "/", env: {}, fs: injected, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, expected);
    assert.deepEqual(await fs.readdir("/tmp"), []);
  });
}

it("awaits each font row sink and cancels without further output or leaked traversal state", async () => {
  const doc = PdfDocument.create(); for (let i = 0; i < 20; i++) doc.addPage().drawText(`page ${i}`, { x: 0, y: 0 });
  const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); await fs.writeFile("/in.pdf", doc.save());
  const controller = new AbortController(); const failure = new Error("cancel font output"); let writes = 0; let pending = 0;
  const { executePdffonts } = await import("./index.js");
  await assert.rejects(executePdffonts({
    command: "pdffonts", args: ["in.pdf"], cwd: "/", env: {}, fs, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {} }, stderr: { async write() {} },
    stdout: { async write(bytes) {
      assert.equal(pending, 0); pending += bytes.length; writes++;
      await new Promise<void>(resolve => setTimeout(resolve, 0)); pending -= bytes.length;
      if (writes === 2) controller.abort(failure);
    } },
  }), error => error === failure);
  assert.equal(writes, 2); assert.equal(pending, 0); assert.deepEqual(await fs.readdir("/tmp"), []);
});

for (const [fixture, name, encoding] of [
  ["pdfjs-bug1873345.pdf", "ZTWIJM+Helvetica", "WinAnsi"],
  ["pdfjs-calgray.pdf", "Times-Roman", "Standard"],
  ["pdfbox-5403-bad-rendering.pdf", "HFEYZI+PTSans-Regular", "Custom"],
  ["pdfjs-bug1873345.pdf", "QCYPOE+CMCSC10", "WinAnsi"],
]) {
  for (const retained of [false, true]) it(`reports native encoding ${encoding} for ${name} (retained=${retained})`, async () => {
    const bytes = await readFile(new URL(`../../pdf-ast/src/fixtures/${fixture}`, import.meta.url));
    let stdout = "";
    if (retained) {
      const fs = createMemoryFileSystem(); await fs.mkdir("/tmp"); await fs.writeFile("/in.pdf", bytes);
      const result = await createPdffontsCommand().execute({
        command: "pdffonts", args: ["in.pdf"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { assert.fail(new TextDecoder().decode(chunk)); } },
      });
      assert.equal(result.exitCode, 0);
    } else {
      const result = runPdffontsCliSync(["in.pdf"], new Map([["in.pdf", bytes]]));
      assert.equal(result.exitCode, 0); stdout = result.stdout;
    }
    const row = stdout.split("\n").find(line => line.startsWith(name!));
    assert.ok(row); assert.equal(row.slice(55, 71).trim(), encoding);
  });
}

for (const [fixture, name] of [
  ["pdfjs-calgray.pdf", "Times-Roman"],
  ["pdfjs-jbig2-symbol-offset.pdf", "Helvetica"],
]) {
  it(`reports unresolved substitutes without inventing host paths for ${name}`, async () => {
    const bytes = await readFile(new URL(`../../pdf-ast/src/fixtures/${fixture}`, import.meta.url));
    const args = ["-subst", "in.pdf"];
    const files = new Map([["in.pdf", bytes]]);
    const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
    let stdout = "";
    const result = await createPdffontsCommand().execute({
      command: "pdffonts", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { assert.fail(new TextDecoder().decode(chunk)); } },
    });
    assert.equal(result.exitCode, 0);
    for (const output of [stdout, runPdffontsCliSync(args, files).stdout, (await runPdffontsCli(args, files)).stdout]) {
      const row = output.split("\n").find(line => line.startsWith(name!));
      assert.ok(row);
      assert.equal(row.slice(47, 83).trim(), "[unresolved]");
      assert.equal(row.slice(84), "[unresolved]");
    }
  });
}
