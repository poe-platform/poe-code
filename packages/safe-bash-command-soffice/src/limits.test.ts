import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createSofficeCommand, createLibreofficeCommand, type SofficeCommandOptions } from "./index.js";

for (const factory of [createSofficeCommand, createLibreofficeCommand]) for (const limits of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }]) {
  it(`enforces configured ${Object.keys(limits)[0]} before publication`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/in.txt", "hello");
    const carrier = createCommandArguments(["--headless", "--convert-to", "pdf", "/in.txt"]);
    const context = { command: "soffice", args: carrier.args, argumentValues: carrier, cwd: "/", env: {},
      signal: new AbortController().signal, registerCleanup() {},
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} },
      fs: { async readFile(path: string) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
        async mkdir() {}, async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); } }
    } as unknown as CommandContext;
    await assert.rejects(async () => factory({ limits } as SofficeCommandOptions).execute(context), /limit/i);
    assert.equal(volume.existsSync("/in.pdf"), false);
  });
}
