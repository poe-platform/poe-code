import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const counts = ["4294967295", "4294967296", "9007199254740992", "9007199254740993", "18446744073709551616", "340282366920938463463374607431768211456"];
for (const runtime of ["TypeScript", "Rust"]) {
  for (const option of ["-b", "-l", "-C"]) for (const count of [...counts, ...(option === "-l" ? [] : ["1P", "1Q", "9007199254740993kB"])]) {
    test(`${runtime}: split ${option}${count} uses actual input size`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, agentCommands, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
      const fs = createMemoryFileSystem();
      const shell = runtime === "TypeScript" ? new Shell({fs, cwd: "/"}).use(agentCommands()) : new RustWasmBash({fs, cwd: "/", forceNative: true});
      try {
        for (const input of ["", "a\nb\nc"]) {
          const result = await shell.exec(`split ${option}${count}`, {stdin: input, limits: {commandLimits: {split: {maxFiles: 1}}}});
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.deepEqual(await fs.readdir("/"), input ? [{name: "xaa", type: "file"}] : []);
          if (input) assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), input);
        }
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally { await shell.dispose(); }
    });
  }
  for (const option of ["-b9007199254740993.5", "-b0E", "-b1EX", "-l1E", "-l-9007199254740993", "-a4294967296", "-n4294967296"]) {
    test(`${runtime}: split rejects ${option} before replacing output`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, agentCommands, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
      const fs = createMemoryFileSystem();
      await fs.writeFile("/xaa", Buffer.from("KEEP"));
      const shell = runtime === "TypeScript" ? new Shell({fs, cwd: "/"}).use(agentCommands()) : new RustWasmBash({fs, cwd: "/", forceNative: true});
      try {
        const result = await shell.exec(`split ${option}`, {stdin: "abc", limits: {commandLimits: {split: {maxFiles: 1}}}});
        assert.equal(result.exitCode, 1);
        assert.equal(Buffer.from(await fs.readFile("/xaa")).toString(), "KEEP");
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally { await shell.dispose(); }
    });
  }
}
