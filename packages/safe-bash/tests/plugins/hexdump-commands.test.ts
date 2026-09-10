import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

test("the default preset appends hexdump and hd and exposes their public factories", () => {
  const names = entry.createAgentCommands().map(command => command.name);
  assert.equal(names.length, 107);
  assert.deepEqual(names.slice(-3), ["getopt", "hexdump", "hd"]);
  assert.equal(new Set(names).size, 107);
  for (const name of ["createHexdumpCommand", "createHdCommand", "createHexdumpCommands", "hexdumpCommands"]) {
    assert.ok(name in entry, `Missing public export: ${name}`);
  }
});

for (const command of ["hexdump -C", "hd"]) {
  test(`a saved VFS workflow executes ${command} with exact binary-file output`, async () => {
    const fs = entry.createMemoryFileSystem();
    const encoder = new TextEncoder();
    const source = `${command} "$1" > "$2"\n`;
    const input = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    const expected = encoder.encode("00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|\n00000010\n");
    await fs.mkdir("/work");
    await fs.writeFile("/work/saved.sh", encoder.encode(source));
    await fs.writeFile("/work/input.bin", input);
    const shell = new entry.Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(entry.agentCommands());
    try {
      const result = await shell.exec("sh saved.sh input.bin output.txt");
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "", stderr: "" });
      assert.deepEqual(await fs.readFile("/work/output.txt"), expected);
      assert.deepEqual(await fs.readFile("/work/input.bin"), input);
      assert.deepEqual(await fs.readFile("/work/saved.sh"), encoder.encode(source));
    } finally { await shell.dispose(); }
  });
}

for (const command of ["hexdump", "hd"]) {
  test(`the aggregate forwards ${command} limits without consulting nested replacement`, async () => {
    const options = { limits: { maxArguments: 1 } };
    Object.defineProperty(options, "replace", { enumerable: true, get() { throw new Error("Unexpected nested replace"); } });
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } })
      .use(entry.agentCommands({ hexdump: options }));
    try {
      const result = await shell.exec(`${command} -v absent`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 1, stdout: "", stderr: `${command}: argument count limit exceeded\n`,
      });
    } finally { await shell.dispose(); }
  });
}
