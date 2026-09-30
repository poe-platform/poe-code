import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createQpdfCommand, type QpdfCommandOptions } from "./index.js";

for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }]) {
  it(`enforces configured ${Object.keys(limits)[0]} before publication`, async () => {
    const volume = new Volume();
    const doc = PdfDocument.create(); doc.addPage(); volume.writeFileSync("/in.pdf", doc.save());
    const carrier = createCommandArguments(["/in.pdf", "/out.pdf"]);
    const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
      fs: { async readFile(path: string) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); } }
    } as unknown as CommandContext;
    await assert.rejects(async () => createQpdfCommand({ limits } as QpdfCommandOptions).execute(context), /limit/i);
    assert.equal(volume.existsSync("/out.pdf"), false);
  });
}
