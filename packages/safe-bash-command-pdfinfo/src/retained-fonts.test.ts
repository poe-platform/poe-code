import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createPdffontsCommand, runPdffontsCliSync } from "./index.js";

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
