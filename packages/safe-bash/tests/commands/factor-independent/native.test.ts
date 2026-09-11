import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { factorCommands } from "../../../src/commands/factor/index.js";
import { createCommandArguments, type ByteSource } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { nativeCases } from "./native-cases.js";

for (const fixture of nativeCases) for (const mode of ["string", "raw"] as const) {
  test(`native exact ${fixture.name}, ${mode} arguments`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/sentinel", Uint8Array.of(255, 0, 17));
    const shell = new Shell({ fs, cwd: "/work", env: fixture.env }).use(factorCommands());
    const input = Buffer.from(fixture.inputHex, "hex");
    const reused = new Uint8Array(1);
    const fragmented: ByteSource = { async *[Symbol.asyncIterator]() {
      try { for (const byte of input) { reused[0] = byte; yield reused; } }
      finally { reused[0] = 88; }
    } };
    shell.commands.register({ name: "forward", execute(context) {
      const values = createCommandArguments(fixture.args.map(argument => shellValueFromBytes(Buffer.from(argument))));
      return context.invoke!("factor", values.args, { argumentValues: values });
    } });
    try {
      const command = mode === "raw" ? "forward" : `factor ${fixture.args.map(argument => `'${argument.split("'").join("'\\''")}'`).join(" ")}`;
      const result = await shell.exec(command, { stdin: mode === "raw" ? fragmented : input });
      assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
        status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
      });
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["sentinel"]);
      assert.deepEqual(await fs.readFile("/work/sentinel"), Uint8Array.of(255, 0, 17));
    } finally { await shell.dispose(); }
  });
}

for (const mode of ["pipeline", "redirect"] as const) {
  test(`saved VFS script ${mode} preserves native raw/NUL bytes and namespace`, async () => {
    const fixture = nativeCases.find(row => row.name === "raw-quote-NUL-truncation")!;
    const input = Buffer.from(fixture.inputHex, "hex");
    const encoded = [...input].map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
    const script = mode === "pipeline" ? `printf '%b' '${encoded}' | factor\n` : "factor < input.bin\n";
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/input.bin", input);
    await fs.writeFile("/work/run.sh", Buffer.from(script));
    const shell = new Shell({ fs, cwd: "/work", env: fixture.env }).use(factorCommands());
    shell.commands.register(printfCommand);
    try {
      const result = await shell.exec("sh run.sh");
      assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
        status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
      });
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["input.bin", "run.sh"]);
      assert.deepEqual(Buffer.from(await fs.readFile("/work/input.bin")), input);
      assert.equal(Buffer.from(await fs.readFile("/work/run.sh")).toString(), script);
    } finally { await shell.dispose(); }
  });
}
