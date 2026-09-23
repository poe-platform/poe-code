import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "../../../src/index.js";
import { archive, direct, wrapped } from "./helpers.js";

for (const mode of ["c", "r", "u"]) {
  for (const attack of ["stream", "acquisition", "retained"]) {
    test(`tar ${mode} binds source bytes to checked identity during ${attack} ancestor swap`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/work/sub", { recursive: true });
      await fs.mkdir("/private");
      const safe = Buffer.from("safe-safe-safe\n");
      const secret = Buffer.from("SECRET-SECRET!\n");
      await fs.writeFile("/work/sub/a", safe);
      await fs.writeFile("/private/a", secret);
      if (mode !== "c") await fs.writeFile("/work/archive.tar", archive());
      let swaps = 0;
      let closes = 0;
      let reads = 0;
      const swap = async <T>(action: () => Promise<T>): Promise<T> => {
        swaps++;
        await fs.rename("/work/sub", "/work/original");
        await fs.symlink!("/private", "/work/sub");
        try { return await action(); }
        finally {
          await fs.rm("/work/sub");
          await fs.rename("/work/original", "/work/sub");
        }
      };
      const view = wrapped(fs, {
        readStream(path, options) {
          if (path !== "/work/sub/a" || attack !== "stream") return fs.readStream!(path, options);
          return { async *[Symbol.asyncIterator]() {
            yield await swap(() => fs.readFile(path));
          } };
        },
        async openReadFile(path, options) {
          if (path !== "/work/sub/a") return fs.openReadFile!(path, options);
          const handle = attack === "acquisition"
            ? await swap(() => fs.openReadFile!(path, options)) : await fs.openReadFile!(path, options);
          return { stat: handle.stat.bind(handle), async close() { closes++; await handle.close(); },
            read(position, size, readOptions) {
              reads++;
              return attack === "retained" ? swap(() => handle.read(position, size, readOptions)) : handle.read(position, size, readOptions);
            } };
        },
      });
      const result = await direct([`${mode}f`, "archive.tar", "sub/a"], view);
      const bytes = await fs.readFile("/work/archive.tar").catch(() => new Uint8Array());
      assert.equal(Buffer.from(bytes).includes(secret), false, "archive disclosed swapped source bytes");
      assert.equal(closes, 1);
      if (attack === "acquisition") {
        assert.equal(reads, 0, "mismatched retained object must never supply payload");
        assert.equal(swaps, 1);
        assert.equal(result.exitCode, 2);
        assert.match(result.stderr, /source changed/u);
      } else {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(Buffer.from(bytes).includes(safe), true);
        assert.equal(swaps > 0, attack === "retained");
      }
    });
  }
}

for (const missing of ["handle", "identity"]) {
  test(`tar fails before publication when source ${missing} is unavailable`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/a", Buffer.from("safe"));
    const view = wrapped(fs, missing === "handle" ? { openReadFile: undefined } as unknown as Partial<FileSystem> : {
      async lstat(path, options) {
        const { identityScope: ignoredScope, ...stat } = await fs.lstat(path, options);
        return stat;
      },
    });
    const result = await direct(["cf", "archive.tar", "a"], view);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /retained backing identity/u);
    await assert.rejects(fs.lstat("/work/archive.tar"), { code: "ENOENT" });
  });
}
