import assert from "node:assert/strict";
import test from "node:test";
import { createPrCommand } from "../../../src/commands/pr/index.js";
import { createTsortCommand } from "../../../src/commands/tsort/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type FileSystem } from "../../../src/contracts/index.js";

for (const [name, create, args] of [["pr", createPrCommand, ["-t", "input"]], ["tsort", createTsortCommand, ["input"]]] as const) {
  for (const family of ["stat", "readStream", "readFile", "capabilitiesFor"] as const) {
    for (const reason of [false, 0, "", null]) {
      test(`${name} ${family} accessor cancellation blocks method admission ${JSON.stringify(reason)}`, async () => {
        const fs: FileSystem = new MemoryFileSystem();
        await fs.writeFile("/input", Buffer.from("12 18\n"));
        fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: family !== "readFile" });
        const method = fs[family]!;
        const caller = new AbortController();
        let getters = 0, calls = 0, writes = 0;
        Object.defineProperty(fs, family, {
          configurable: true,
          get() {
            getters++;
            caller.abort(reason);
            return function (this: FileSystem, ...parameters: unknown[]) {
              calls++;
              return Reflect.apply(method, this, parameters);
            };
          },
        });
        await assert.rejects(async () => create().execute({
          command: name, args, cwd: "/", env: { LC_ALL: "C", TZ: "UTC" }, fs,
          signal: caller.signal, stdin: toByteSource(""),
          stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } },
        }), error => Object.is(error, reason));
        assert.ok(getters > 0, "the requested method accessor must be reached");
        assert.deepEqual({ calls, writes }, { calls: 0, writes: 0 });
      });
    }
  }
}
