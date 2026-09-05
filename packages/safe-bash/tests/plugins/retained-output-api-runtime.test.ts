import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled retained output API", { skip: selected === undefined ? "Requires a current build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("explicit output API retains the renamed open file", async context => {
    const { Shell } = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const { openFileOutput } = await import("poe-code/safe-bash/contracts/filesystem-output");
    const fs = createMemoryFileSystem();
    const shell = new Shell({ fs });
    context.after(() => shell.dispose());
    shell.register({ name: "retained", async execute(invocation) {
      const output = await openFileOutput(invocation, "/out", { flag: "w", descriptor: true });
      await output.sink.write(Uint8Array.of(97));
      await fs.rename("/out", "/moved");
      await output.sink.write(Uint8Array.of(98));
      await output.finish();
      await invocation.stdout.write(await fs.readFile("/moved"));
      return { exitCode: 0 };
    } });
    const result = await shell.exec("retained");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(97, 98));
    assert.deepEqual(await fs.readFile("/moved"), Uint8Array.of(97, 98));
    await assert.rejects(fs.stat("/out"), { code: "ENOENT" });
  });

  for (const reason of [false, 0, "", null]) {
    for (const method of ["stat", "read", "write", "truncate", "sync", "data-sync", "position"] as const) {
      test(`closed public descriptor preserves operation cancellation: ${method} ${String(reason)}`, async () => {
        const { createMemoryFileSystem } = await import("poe-code/safe-fs");
        const { openFileOutput } = await import("poe-code/safe-bash/contracts/filesystem-output");
        const output = await openFileOutput({ fs: createMemoryFileSystem(), signal: new AbortController().signal }, "/out", { flag: "w", descriptor: true });
        const descriptor = output.descriptor;
        assert.ok(descriptor);
        await output.finish();
        const options = { signal: AbortSignal.abort(reason) };
        const operation = () => {
          switch (method) {
            case "stat": return descriptor.stat(options);
            case "read": return descriptor.read(new Uint8Array(1), null, options);
            case "write": return descriptor.write(Uint8Array.of(97), null, options);
            case "truncate": return descriptor.truncate(0, options);
            case "sync": return descriptor.sync(false, options);
            case "data-sync": return descriptor.sync(true, options);
            case "position": {
              assert.ok(descriptor.getPosition);
              return descriptor.getPosition(options);
            }
          }
        };
        await assert.rejects(operation, actual => Object.is(actual, reason));
      });
    }
  }
});
