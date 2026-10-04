import assert from "node:assert/strict";
import { it } from "node:test";
import { deflateSync } from "node:zlib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosDict, cosName, cosStream } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createQpdfCommand } from "./index.js";

function runner(fs: ReturnType<typeof createMemoryFileSystem>, maxOutputBytes?: number) {
  return async (args: string[]) => {
    const carrier = createCommandArguments(args);
    const errors: Uint8Array[] = [], output: Uint8Array[] = [];
    const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs
    } as unknown as CommandContext;
    const result = await createQpdfCommand(maxOutputBytes === undefined ? {} : { limits: { maxOutputBytes } }).execute(context);
    assert.equal(result.exitCode, 0, new TextDecoder().decode(Buffer.concat(errors)));
    return Buffer.concat(output);
  };
}

for (const equals of [true, false]) {
  it(`loads and copies binary VFS attachments (${equals ? "equals" : "separate"} operands)`, async () => {
    const fs = createMemoryFileSystem();
    const doc = PdfDocument.create(); doc.addPage();
    await fs.writeFile("/in.pdf", doc.save());
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await fs.writeFile("/payload.bin", payload);
    const execute = runner(fs);
    const operand = (flag: string, path: string) => equals ? [`${flag}=${path}`] : [flag, path];
    await execute([...operand("--add-attachment", "/payload.bin"), "--key=mykey", "--", "/in.pdf", "/attached.pdf"]);
    await execute([...operand("--copy-attachments-from", "/attached.pdf"), "--", "/in.pdf", "/out.pdf"]);
    assert.deepEqual(await runner(fs, payload.length)(["/out.pdf", "--show-attachment=mykey"]), payload);
    await assert.rejects(runner(fs, payload.length - 1)(["/out.pdf", "--show-attachment=mykey"]), /Output byte limit exceeded/);
  });
}

for (const filtered of [false, true]) {
  it(`preserves binary ${filtered ? "filtered" : "raw"} stream stdout`, async () => {
    const fs = createMemoryFileSystem();
    const doc = PdfDocument.create(); doc.addPage();
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const compressed = deflateSync(payload);
    const ref = doc.cos.allocateObject(cosStream(cosDict({ Filter: cosName("FlateDecode") }), compressed));
    await fs.writeFile("/in.pdf", doc.save());
    const expected = filtered ? payload : compressed;
    const args = ["/in.pdf", `--show-object=${ref.objectNumber}`, filtered ? "--filtered-stream-data" : "--raw-stream-data"];
    assert.deepEqual(await runner(fs, expected.length)(args), expected);
    await assert.rejects(runner(fs, expected.length - 1)(args), /Output byte limit exceeded/);
  });
}
