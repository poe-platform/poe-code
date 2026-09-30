import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createQpdfCommand } from "./index.js";

it("preloads equals-form attachment sources in the VFS", async () => {
  const volume = new Volume();
  const doc = PdfDocument.create(); doc.addPage();
  volume.writeFileSync("/in.pdf", doc.save());
  volume.writeFileSync("/payload.txt", "hello attachment");
  const execute = async (args: string[]) => {
    const carrier = createCommandArguments(args);
    const errors: Uint8Array[] = [], output: Uint8Array[] = [];
    const context = { command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
      fs: { async readFile(path: string) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); } }
    } as unknown as CommandContext;
    const result = await createQpdfCommand().execute(context);
    assert.equal(result.exitCode, 0, new TextDecoder().decode(Buffer.concat(errors)));
    return new TextDecoder().decode(Buffer.concat(output));
  };
  await execute(["--add-attachment=/payload.txt", "--key=mykey", "--", "/in.pdf", "/attached.pdf"]);
  await execute(["--copy-attachments-from=/attached.pdf", "--", "/in.pdf", "/out.pdf"]);
  assert.equal(await execute(["/out.pdf", "--show-attachment=mykey"]), "hello attachment");
  assert.ok(volume.existsSync("/out.pdf"));
});
