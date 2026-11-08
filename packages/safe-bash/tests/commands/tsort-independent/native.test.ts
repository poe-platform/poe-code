import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { tsortCommands } from "../../../src/commands/tsort/index.js";
import { nativeCases } from "./native-cases.js";

for (const shadowed of [false, true]) {
  test(`tsort follows a VFS null-device symlink without reading stdin or backing shadow, shadowed=${shadowed}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.symlink("/dev/null", "/work/null-link");
    if (shadowed) {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/null", Buffer.from("foreign shadow must remain"));
    }
    let pulls = 0;
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(tsortCommands());
    try {
      const result = await shell.exec("tsort null-link", { stdin: { [Symbol.asyncIterator]() { return {
        async next() { pulls++; assert.fail("explicit null-device input must not consume stdin"); },
      }; } } });
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "", stderr: "" });
      assert.equal(pulls, 0);
      assert.equal(await fs.readlink("/work/null-link"), "/dev/null");
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["null-link"]);
      if (shadowed) assert.equal(Buffer.from(await fs.readFile("/dev/null")).toString(), "foreign shadow must remain");
    } finally { await shell.dispose(); }
  });
}

for (const fixture of nativeCases) {
  test(`tsort independent native exact bytes: ${fixture.name}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const [name, hex] of Object.entries(fixture.files)) await fs.writeFile(`/work/${name}`, Buffer.from(hex, "hex"));
    const shell = new Shell({ fs, cwd: "/work", env: fixture.env }).use(tsortCommands());
    try {
      const words = fixture.args.map(value => `'${value.split("'").join("'\\''")}'`);
      const result = await shell.exec(`tsort ${words.join(" ")}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
      assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, {
        stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex, status: fixture.status,
      });
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(fixture.files).sort());
      for (const [name, hex] of Object.entries(fixture.files)) assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex"), hex);
    } finally { await shell.dispose(); }
  });
}

for (const name of ["roots-before-newly-freed", "cyclic-raw-high-byte-diagnostics"]) {
  test(`tsort actual saved sh pipeline preserves native bytes and status: ${name}`, async () => {
    const fixture = nativeCases.find(candidate => candidate.name === name)!;
    const input = Buffer.from(fixture.inputHex, "hex");
    const escaped = [...input].map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
    const script = `printf '%b' '${escaped}' | tsort\n`;
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/order.sh", Buffer.from(script));
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(tsortCommands());
    shell.commands.register(printfCommand);
    try {
      const result = await shell.exec("sh order.sh");
      assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
        status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
      });
      assert.equal(Buffer.from(await fs.readFile("/work/order.sh")).toString(), script);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["order.sh"]);
    } finally { await shell.dispose(); }
  });
}
