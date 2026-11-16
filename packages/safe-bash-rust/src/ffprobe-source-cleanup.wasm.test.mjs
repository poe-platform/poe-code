import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} ffprobe retires failed stdin and can probe again`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, FsError} = await import("@poe-platform/safe-bash");
    const {ffprobeCommands} = await import("safe-bash-command-ffprobe");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), cwd: "/"}).use(ffprobeCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    const bytes = Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex");
    let closed = 0, reads = 0;
    const stdin = { [Symbol.asyncIterator]() { return {
      async next() {
        if (reads++ === 0) return {done: false, value: bytes.subarray(0, 57)};
        throw new FsError("EIO", {syscall: "read", path: "/probe-source"});
      },
      async return() { closed++; throw new Error("cleanup failed"); }
    }; } };
    const command = "ffprobe -v error -show_entries format_tags=title -of json -";
    try {
      const failure = await shell.exec(command, {stdin}).catch(error => error);
      // The native Wasm stdin boundary intentionally hides host exception details.
      assert.match(failure instanceof Error ? failure.message : failure.stderr,
        runtime === "Rust" ? /ffprobe: internal error/ : /EIO.*probe-source/);
      if (!(failure instanceof Error)) assert.notEqual(failure.exitCode, 0);
      assert.equal(closed, 1);
      const good = await shell.exec(command, {stdin: bytes});
      assert.equal(good.exitCode, 0, good.stderr);
      assert.equal(good.stderr, "");
      assert.deepEqual(JSON.parse(good.stdout), {format: {tags: {title: "Title"}}});
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
