import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createQpdfCommand, type QpdfCommandOptions } from "./index.js";

for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }]) {
  it(`enforces configured ${Object.keys(limits)[0]} before publication`, async () => {
    const fs = createMemoryFileSystem();
    const doc = PdfDocument.create(); doc.addPage(); await fs.writeFile("/in.pdf", doc.save());
    const carrier = createCommandArguments(["/in.pdf", "/out.pdf"]);
    const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
      fs
    } as unknown as CommandContext;
    await assert.rejects(async () => createQpdfCommand({ limits } as QpdfCommandOptions).execute(context), /limit/i);
    await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
  });
}
