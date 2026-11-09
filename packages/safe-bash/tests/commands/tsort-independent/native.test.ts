import "../../../src/shell/sync-extra-evaluators.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { printfCommand } from "../../../src/commands/basic.js";
import { tsortCommands } from "../../../src/commands/tsort/index.js";
import { nativeCases } from "./native-cases.js";

for (const fixture of [
  { name: "LF pairs", input: "a b\nb c\n", output: "a\nb\nc" },
  { name: "space and tab separators", input: " \ta\tb \n\tb\tc\t\n", output: "a\nb\nc" },
  { name: "CRLF pairs", input: "a b\r\nb c\r\n", output: "a\nb\nb\r\nc\r" },
  { name: "vertical tab and form feed in names", input: "a\vb c\fd\n", output: "a\vb\nc\fd" },
  ...["\r", "\v", "\f"].map(separator => ({
    name: `odd token with ${JSON.stringify(separator)}`,
    input: `a${separator}b\n`,
    output: "",
    odd: true,
  })),
]) {
  for (const command of ["tsort input", "tsort < input", "tsort - < input"]) {
    for (const saved of [false, true]) {
      test(`tsort substitution preserves tokens: ${fixture.name}, ${command}, saved=${saved}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        await fs.writeFile("/work/input", Buffer.from(fixture.input));
        const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(tsortCommands());
        shell.commands.register(printfCommand);
        const source = `value=$(${command}); status=$?; printf '%s:[%s]' "$status" "$value"; exit "$status"`;
        if (saved) await fs.writeFile("/work/order.sh", Buffer.from(source));
        try {
          const result = await shell.exec(saved ? "sh order.sh" : source);
          const status = "odd" in fixture ? 1 : 0;
          assert.equal(result.exitCode, status);
          assert.equal(result.stdout, `${status}:[${fixture.output}]`);
          assert.equal(result.stderr, status === 0 ? "" : `tsort: ${command === "tsort input" ? "input" : "-"}: input contains an odd number of tokens\n`);
        } finally { await shell.dispose(); }
      });
    }
  }
}

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
      // GNU 9.4 accepts --help before --; preserve the older capture as history.
      if (fixture.name === "help-with-end-marker") {
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "Usage: tsort [OPTION] [FILE]\nWrite a topological ordering of whitespace-separated node pairs.\nWith no FILE, or FILE -, read standard input.\nOptions: --help --version\n");
      } else if (["help-value", "help-prefix-empty-value", "help-unexpected-value", "version-value", "version-prefix-value"].includes(fixture.name)) {
        // GNU rejects values using the resolved option name; retain the older captures.
        const option = fixture.name.startsWith("help") ? "--help" : "--version";
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
          stdout: "", stderr: `tsort: option '${option}' doesn't allow an argument\nTry 'tsort --help' for more information.\n`, status: 1,
        });
      } else {
        assert.deepEqual({ stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex"), status: result.exitCode }, {
          stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex, status: fixture.status,
        });
      }
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
