import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled command descriptor close acknowledgement", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const acknowledge of [false, true]) {
    test(`public close failure recovery requires explicit acknowledgement: ${acknowledge}`, async () => {
      const published = await import("poe-code/safe-bash");
      const { createMemoryFileSystem, FsError } = await import("poe-code/safe-fs");
      const helpers = await import(new URL("../../dist/contracts/filesystem-descriptor.js", import.meta.url).href) as typeof import("../../src/contracts/filesystem-descriptor.js");
      const fs = createMemoryFileSystem();
      const open = fs.open.bind(fs);
      const failure = new FsError("EIO", { syscall: "close", path: "/output" });
      let closes = 0;
      fs.open = async (...args) => {
        const descriptor = await open(...args);
        const close = descriptor.close.bind(descriptor);
        descriptor.close = async () => { closes++; await close(); throw failure; };
        return descriptor;
      };
      const shell = new published.Shell({ fs }).use(published.agentCommands());
      shell.register({ name: "close-file", runtimeIdentity: published.commandRuntimeIdentity, async execute(context) {
        const descriptor = await helpers.openCommandFile(context, "/output", { access: "write", creation: "exclusive" });
        await descriptor.write(Uint8Array.of(255, 0), null);
        try { await descriptor.close(); }
        catch (error) {
          assert.equal(error, failure);
          await context.stderr.write(Buffer.from("close-file: close failed\n"));
          if (acknowledge) {
            assert.equal(descriptor.acknowledgeCloseFailure(error), true);
            await assert.rejects(descriptor.close(), rejected => rejected === failure);
          }
          return { exitCode: 1 };
        }
        throw new Error("fixture descriptor must fail to close");
      } });
      try {
        if (acknowledge) {
          const result = await shell.exec("close-file || printf recovered");
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, "recovered");
          assert.equal(result.stderr, "close-file: close failed\n");
        } else {
          await assert.rejects(shell.exec("close-file || printf recovered"), error => error === failure || error instanceof AggregateError && error.errors.includes(failure));
        }
        assert.deepEqual(await fs.readFile("/output"), Uint8Array.of(255, 0));
        assert.equal(closes, 1);
      } finally { await shell.dispose(); }
    });
  }
});
