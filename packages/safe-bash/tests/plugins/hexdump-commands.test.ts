import assert from "node:assert/strict";
import test from "node:test";
import * as entry from "../../src/index.js";

for (const command of ["hexdump -C", "hd"]) {
  test(`${command} offers util-linux counts and preserves partial rows across files`, async () => {
    const fs = entry.createMemoryFileSystem();
    await fs.writeFile("/one", new TextEncoder().encode("abcdefghijklmnop"));
    await fs.writeFile("/two", new TextEncoder().encode("abc"));
    const shell = new entry.Shell({ fs }).use(entry.agentCommands({ hexdump: { dialect: "util-linux" } }));
    try {
      const full = "00000000  61 62 63 64 65 66 67 68  69 6a 6b 6c 6d 6e 6f 70  |abcdefghijklmnop|\n";
      const partial = "00000010  61 62 63                                          |abc|\n00000013\n";
      for (const count of ["1KiB", "1KB", "0x13", "023"]) {
        const result = await shell.exec(`${command} -n ${count} /one /two`);
        assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, full + partial, ""]);
      }
      const hex = await shell.exec(`${command} -n0x1 /one`);
      assert.deepEqual([hex.exitCode, hex.stdout, hex.stderr], [0, "00000000  61                                                |a|\n00000001\n", ""]);
      const skip = await shell.exec(`${command} -s1KiB /one /two`);
      assert.deepEqual([skip.exitCode, skip.stdout, skip.stderr], [0, "00000013\n", ""]);
      const repeat = await shell.exec(`printf '%s' abcdefghijklmnopabcdefghijklmnopabc | ${command}`);
      assert.equal(repeat.stdout, full + "*\n00000020  61 62 63                                          |abc|\n00000023\n");
      for (const value of ["1junk", "1m", "0x", "-1", "9007199254740992", "9007199254740991KiB"]) {
        assert.equal((await shell.exec(`${command} -n ${value} /one`)).exitCode, 1);
      }
    } finally { await shell.dispose(); }
  });
}

test("hexdump dialect selection preserves the default BSD profile", async () => {
  for (const options of [{}, { dialect: "bsd" as const }]) {
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.hexdumpCommands(options));
    try {
      assert.equal((await shell.exec("hexdump -C -n0x1", { stdin: "abc" })).stdout, "");
      const result = await shell.exec("hd", { stdin: "abcdefghijklmnopabc" });
      assert.equal(result.stdout, "00000000  61 62 63 64 65 66 67 68  69 6a 6b 6c 6d 6e 6f 70  |abcdefghijklmnop|\n*\n00000013\n");
    } finally { await shell.dispose(); }
  }
});

test("the standalone util-linux plugin distinguishes decimal and binary size suffixes", async () => {
  const fs = entry.createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(1100));
  const shell = new entry.Shell({ fs }).use(entry.hexdumpCommands({ dialect: "util-linux" }));
  try {
    for (const [suffix, address] of [["KB", "000003e8"], ["KiB", "00000400"], ["K", "00000400"], ["k", "00000400"], ["b", "00000200"]]) {
      const result = await shell.exec(`hd -s1${suffix} -n1 /input`);
      assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0,
        `${address}  00                                                |.|\n${(Number.parseInt(address!, 16) + 1).toString(16).padStart(8, "0")}\n`, ""]);
    }
    assert.equal((await shell.exec("hd -n0 /input")).stdout, "");
  } finally { await shell.dispose(); }
  assert.throws(() => entry.createHexdumpCommands({ dialect: "invalid" as "bsd" }), /Invalid hexdump dialect/);
});

test("the default preset appends hexdump and hd and exposes their public factories", () => {
  const names = entry.createAgentCommands().map(command => command.name);
  assert.equal(names.length, 110);
  assert.deepEqual(names.slice(-6), ["getopt", "hexdump", "hd", "iconv", "dos2unix", "unix2dos"]);
  assert.equal(new Set(names).size, 110);
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

for (const [flag, fields] of [["b", "101 102"], ["c", "  A   B"], ["d", "  16961"], ["o", " 041101"], ["x", "   4241"]]) {
  test(`agent commands stream stdin through hexdump -${flag}`, async () => {
    const shell = new entry.Shell({ fs: entry.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(entry.agentCommands());
    try {
      const result = await shell.exec(`printf AB | hexdump -${flag}`);
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        exitCode: 0, stdout: `0000000 ${fields}${" ".repeat(56)}\n0000002\n`, stderr: "",
      });
    } finally { await shell.dispose(); }
  });
}

for (const dialect of ["bsd", "util-linux"] as const) {
  for (const command of ["hexdump", "hd"]) {
    test(`${command} -o formats two-byte octal words in the ${dialect} dialect`, async () => {
      const shell = new entry.Shell({ fs: entry.createMemoryFileSystem() }).use(entry.agentCommands({ hexdump: { dialect } }));
      try {
        for (const [stdin, fields, canonical] of [
          [Uint8Array.of(65, 66, 67, 68), " 041101  042103", "00000000  41 42 43 44                                       |ABCD|\n"],
          [Uint8Array.of(255, 255, 1), " 177777  000001", "00000000  ff ff 01                                          |...|\n"],
          [Uint8Array.of(0, 0), " 000000", "00000000  00 00                                             |..|\n"],
        ] as const) {
          const result = await shell.exec(`${command} -ov`, { stdin });
          const octal = `0000000 ${fields}${" ".repeat(stdin.length > 2 ? 48 : 56)}\n`;
          const address = stdin.length.toString(16).padStart(7, "0");
          assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, (command === "hd" ? canonical : "") + octal + address + "\n", ""]);
        }
        const empty = await shell.exec(`${command} -o`, { stdin: "" });
        assert.deepEqual([empty.exitCode, empty.stdout, empty.stderr], [0, "", ""]);
      } finally { await shell.dispose(); }
    });
  }
}
