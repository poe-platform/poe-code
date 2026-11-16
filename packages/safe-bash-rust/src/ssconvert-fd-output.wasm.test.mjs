import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} ssconvert uses command streams for fd output`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = runtime === "TypeScript" ? memory : shell.fs;
    try {
      await fs.writeFile("/input.csv", Buffer.from("4,99\n"));
      await fs.writeFile("/keep", Buffer.from("keep"));
      const csv = "ssconvert -T Gnumeric_stf:stf_csv /input.csv";
      for (const suffix of ["fd://1", "fd://1 | cat", "fd://1 > /captured.csv; cat /captured.csv"]) {
        const result = await shell.exec(`${csv} ${suffix}`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "4,99\n", ""], suffix);
      }
      const stderr = await shell.exec(`${csv} fd://2`);
      assert.deepEqual([stderr.exitCode, stderr.stdout, stderr.stderr], [0, "", "4,99\n"]);
      const redirectedError = await shell.exec(`${csv} fd://2 2> /error.csv; cat /error.csv`);
      assert.deepEqual([redirectedError.exitCode, redirectedError.stdout, redirectedError.stderr], [0, "4,99\n", ""]);
      const explicit = await shell.exec(`${csv} /text.xlsx; cat /text.xlsx`);
      assert.deepEqual([explicit.exitCode, explicit.stdout, explicit.stderr], [0, "4,99\n", ""]);
      const merged = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv -M fd://1 /input.csv /input.csv");
      assert.deepEqual([merged.exitCode, merged.stdout], [0, "4,99\n"], merged.stderr);
      const split = await shell.exec(`ssconvert -S -T Gnumeric_stf:stf_csv /input.csv fd://1`);
      assert.notEqual(split.exitCode, 0);
      assert.equal(split.stdout, "");
      for (const descriptor of [1, 2]) {
        await assert.rejects(shell.exec(`${csv} fd://${descriptor}`, {limits: {maxOutputBytes: 1}}),
          {name: "ShellLimitError", limit: "maxOutputBytes"});
      }
      const invalid = await shell.exec(`${csv} fd://3`);
      assert.notEqual(invalid.exitCode, 0);
      assert.equal(invalid.stdout, "");
      const missing = await shell.exec("ssconvert -T Gnumeric_stf:stf_csv /missing.csv fd://1");
      assert.notEqual(missing.exitCode, 0);
      assert.equal(missing.stdout, "");
      const binary = await shell.exec("ssconvert -T Gnumeric_Excel:xlsx /input.csv fd://1");
      assert.equal(binary.exitCode, 0, binary.stderr);
      assert.equal(binary.stderr, "");
      assert.deepEqual([...binary.stdoutBytes.slice(0, 4)], [80, 75, 3, 4]);
      const binaryError = await shell.exec("ssconvert -T Gnumeric_Excel:xlsx /input.csv fd://2");
      assert.equal(binaryError.exitCode, 0, binaryError.stderr);
      assert.equal(binaryError.stdout, "");
      assert.deepEqual(binaryError.stderrBytes, binary.stdoutBytes);
      await fs.writeFile("/round.xlsx", binary.stdoutBytes);
      const restored = await shell.exec("ssconvert /round.xlsx /round.csv; cat /round.csv");
      assert.deepEqual([restored.exitCode, restored.stdout, restored.stderr], [0, "4,99\n", ""]);
      const listing = await shell.exec("find / -type f");
      assert.doesNotMatch(listing.stdout, /fd:/);
      assert.equal(Buffer.from(await fs.readFile("/keep")).toString(), "keep");
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
