import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { nativeCases } from "./fixtures.js";
import { lineEndingCommands } from "../../../src/commands/line-endings/index.js";

// Option outputs independently checked with dos2unix/unix2dos 7.5.2, LC_ALL=C.
for (const command of ["dos2unix", "unix2dos"]) {
  const eol = command === "dos2unix" ? "\n" : "\r\n";
  test(`${command} help keeps supported options readable in a terminal`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
    try {
      const result = await shell.exec(`${command} --help`);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("-O"));
      assert.ok(result.stdout.includes("-i[FLAGS]"));
      assert.ok(result.stdout.includes("--no-add-eol"));
      for (const line of result.stdout.split("\n")) assert.ok(line.length <= 100, line);
    } finally { await shell.dispose(); }
  });
  for (const options of ["-O -o input", "-i -n input output", "-n -i input output", "-O -n input output"]) {
    test(`${command} file mode ordering ${options}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", Buffer.from("a\r\nlast"));
      const shell = new Shell({ fs }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} ${options}`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
        const newFile = options.includes("-n");
        assert.equal(Buffer.from(await fs.readFile(newFile ? "/output" : "/input")).toString(), `a${eol}last`);
        if (newFile) assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "a\r\nlast");
      } finally { await shell.dispose(); }
    });
  }
  for (const options of ["--allow-chown", "--allow-chown --no-allow-chown"]) {
    test(`${command} ownership permission ${options}`, async () => {
      const memory = new MemoryFileSystem();
      await memory.writeFile("/input", Buffer.from("a\r\nlast"));
      const fs = new Proxy(memory, { get(target, key) {
        if (key === "lstat") return async (...args: Parameters<typeof memory.lstat>) => {
          const stat = await memory.lstat(...args);
          return args[0] === "/input" ? { ...stat, uid: 12345 } : stat;
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const shell = new Shell({ fs }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} ${options} input`);
        const allowed = options === "--allow-chown";
        assert.equal(result.exitCode, allowed ? 0 : 1);
        assert.equal(Buffer.from(await memory.readFile("/input")).toString(), allowed ? `a${eol}last` : "a\r\nlast");
        if (!allowed) assert.ok(result.stderr.includes("filesystem cannot preserve input user/group ownership"));
        assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
      } finally { await shell.dispose(); }
    });
  }
  for (const [hex, bom] of [["efbbbf610d0a62", "UTF-8"], ["fffe61000d000a006200", "UTF-16LE"], ["feff0061000d000a0062", "UTF-16BE"]]) {
    test(`${command} verbose BOM and final-line conversion ${bom}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} -v -e`, { stdin: Buffer.from(hex!, "hex") });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `${command === "unix2dos" ? "\ufeff" : ""}a${eol}b${eol}`);
        assert.equal(result.stderr, `${command}: Input file stdin has ${bom} BOM.\n${command === "unix2dos" ? `${command}: Writing UTF-8 BOM.\n` : ""}${command}: Added line break to last line.\n${command}: Converted ${command === "dos2unix" ? 1 : 0} out of 1 line breaks.\n`);
        const info = await shell.exec(`${command} -i`, { stdin: Buffer.from(hex!, "hex") });
        assert.equal(info.stdout, `       1       0       0  ${bom!.padEnd(8)}  text  \n`);
        assert.equal(info.stderr, "");
      } finally { await shell.dispose(); }
    });
  }
  test(`${command} info refuses truncated BOM without an information record`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
    try {
      const result = await shell.exec(`${command} -i`, { stdin: Uint8Array.of(239) });
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${command}: can not read from input file: Success\n`);
    } finally { await shell.dispose(); }
  });
  for (const option of ["-e", "--add-eol", "--add-eol --no-add-eol", "--allow-chown", "--no-allow-chown", "-v", "--verbose"]) {
    test(`${command} stdin option ${option}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} ${option}`, { stdin: Buffer.from("a\r\nlast") });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, `a${eol}last${option === "-e" || option === "--add-eol" ? eol : ""}`);
        assert.equal(result.stderr, option === "-v" || option === "--verbose" ? `${command}: Converted ${command === "dos2unix" ? 1 : 0} out of 1 line breaks.\n` : "");
      } finally { await shell.dispose(); }
    });
  }
  for (const option of ["-O", "--to-stdout", "-i", "--info", "--info=du", "-ic0", "-ih", "-ie"]) {
    test(`${command} read-only file option ${option}`, async () => {
      const memory = new MemoryFileSystem();
      await memory.writeFile("/input", Buffer.from("a\r\nlast"));
      // Reading must work without staging, ownership or publication capabilities.
      const fs = new Proxy(memory, { get(target, key) {
        if (["writeFile", "appendFile", "rename", "chmod", "rm"].includes(String(key))) return () => { assert.fail(`unexpected mutation: ${String(key)}`); };
        if (key === "capabilitiesFor") return undefined;
        if (key === "capabilities") return { ...target.capabilities, atomicRename: false, permissions: false };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} ${option} input`);
        assert.equal(result.exitCode, 0);
        const info = "       1       0       0  no_bom    text    input\n";
        const expected = option === "-O" || option === "--to-stdout" ? `a${eol}last`
          : option === "--info=du" ? "       1       0  input\n"
          : option === "-ic0" ? command === "dos2unix" ? "input\0" : ""
          : option === "-ih" ? `     DOS    UNIX     MAC  BOM       TXTBIN  FILE\n${info}`
          : option === "-ie" ? " noeol   input\n" : info;
        assert.equal(result.stdout, expected);
        assert.equal(result.stderr, option === "-O" || option === "--to-stdout" ? `${command}: converting file input to ${command === "dos2unix" ? "Unix" : "DOS"} format...\n` : "");
        assert.equal(Buffer.from(await memory.readFile("/input")).toString(), "a\r\nlast");
        assert.deepEqual((await memory.readdir("/")).map(entry => entry.name), ["input"]);
      } finally { await shell.dispose(); }
    });
  }
  for (const input of ["", "last", "last\n", "last\r\n", "last\r"]) {
    test(`${command} add-eol respects final terminator ${JSON.stringify(input)}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(lineEndingCommands());
      try {
        const result = await shell.exec(`${command} -e`, { stdin: Buffer.from(input) });
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, input === "" ? "" : input === "last\r" ? `last\r${eol}` : `last${eol}`);
      } finally { await shell.dispose(); }
    });
  }
}

for (const fixture of nativeCases) test(`native ${fixture.command}: ${fixture.name}`, async () => {
  const { lineEndingCommands } = await import("../../../src/commands/line-endings/index.js");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const identities = new Map<string, string>();
  for (const [name, file] of Object.entries(fixture.before)) {
    const path = `/work/${name}`;
    const alias = identities.get(file.inode);
    if (alias) await fs.link!(alias, path);
    else {
      await fs.writeFile(path, Buffer.from(file.hex, "hex"));
      await fs.chmod!(path, file.mode);
      await fs.utimes!(path, file.mtimeMs, file.mtimeMs);
      identities.set(file.inode, path);
    }
  }
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: fixture.locale } }).use(lineEndingCommands());
  try {
    const args = fixture.args.map(argument => `'${argument.split("'").join("'\\''")}'`).join(" ");
    const result = await shell.exec(`${fixture.command} ${args}`, { stdin: Buffer.from(fixture.inputHex, "hex") });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex,
    });
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(fixture.after).sort());
    for (const [name, file] of Object.entries(fixture.after)) {
      assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString("hex"), file.hex, name);
      assert.equal((await fs.stat(`/work/${name}`)).mode & 0o777, file.mode & 0o777, `${name} mode`);
      if (fixture.args.includes("-k" as never)) assert.equal((await fs.stat(`/work/${name}`)).mtimeMs, file.mtimeMs, `${name} date`);
    }
  } finally { await shell.dispose(); }
});
