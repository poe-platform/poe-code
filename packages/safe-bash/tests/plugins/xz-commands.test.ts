import assert from "node:assert/strict";
import test from "node:test";
import {
  Shell, createMemoryFileSystem, standardCommands,
  createXzCommand, createXzCommands, xzCommands, type XzCommandsOptions,
} from "../../src/index.js";

// Native `xz -0c` and `xz --format=lzma -0c` output for "hello".
const helloXz = Buffer.from("/Td6WFoAAATm1rRGAgAhAQwAAACPmEGcAQAEaGVsbG8AAAAAsTe52+XaHpsAAR0FuC2Arx+2830BAAAAAARZWg==", "base64");
const helloLzma = Buffer.from("XQAABAD//////////wA0GUnbhWTxk7H/+4/AAA==", "base64");

for (const registration of ["command", "collection", "plugin"]) {
  for (const [label, options, allowed] of [
    ["omitted limits", undefined, true],
    ["flat Infinity", { maxDecodedBytes: Infinity }, true],
    ["nested Infinity", { limits: { maxDecodedBytes: Infinity } }, true],
    ["exact quota", { limits: { maxDecodedBytes: 5 } }, true],
    ["flat quota", { maxDecodedBytes: 4 }, false],
    ["nested quota", { limits: { maxDecodedBytes: 4 } }, false],
    ["zero quota", { limits: { maxDecodedBytes: 0 } }, false],
    ["nested quota overriding Infinity", { maxDecodedBytes: Infinity, limits: { maxDecodedBytes: 4 } }, false],
    ["nested Infinity overriding quota", { maxDecodedBytes: 4, limits: { maxDecodedBytes: Infinity } }, true],
  ] satisfies [string, XzCommandsOptions | undefined, boolean][]) {
    test(`public XZ ${registration} honors ${label} in commands and substitutions`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/hello.xz", helloXz);
      const shell = new Shell({ fs }).use(standardCommands());
      if (registration === "plugin") shell.use(xzCommands(options));
      else {
        const commands = registration === "command" ? [createXzCommand(options)] : createXzCommands(options);
        for (const command of commands) shell.commands.register(command);
      }
      try {
        for (const script of ["xz -dc /hello.xz", 'value=$(xz -dc /hello.xz)', 'printf "%s" "$(xz -dc /hello.xz)"']) {
          const result = await shell.exec(script);
          assert.equal(result.stdout, allowed && !script.startsWith("value=") ? "hello" : "", script);
          assert.equal(result.exitCode, allowed || script.startsWith("printf") ? 0 : 1, script);
          if (allowed) assert.equal(result.stderr, "", script);
          else assert.ok(result.stderr.includes("decoded byte limit exceeded"), `${script}: ${result.stderr}`);
        }
      } finally { await shell.dispose(); }
    });
  }
}

test("XZ plugin registers legacy aliases with their file and stdout defaults", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(xzCommands({ maxDecodedBytes: Infinity }));
  try {
    await fs.writeFile("/hello.lzma", helloLzma);
    const cat = await shell.exec("lzcat /hello.lzma");
    assert.deepEqual(shell.commands.list().map(command => command.name), ["xz", "unxz", "xzcat", "lzma", "unlzma", "lzcat"]);
    assert.equal(cat.exitCode, 0, cat.stderr);
    assert.equal(cat.stdout, "hello");
    assert.deepEqual(Buffer.from(await fs.readFile("/hello.lzma")), helloLzma);
    await assert.rejects(fs.stat("/hello"), { code: "ENOENT" });

    const decoded = await shell.exec("unlzma /hello.lzma");
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.equal(decoded.stdout, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/hello")), "hello");
    await assert.rejects(fs.stat("/hello.lzma"), { code: "ENOENT" });

    const encoded = await shell.exec("lzma -0 /hello");
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout, "");
    assert.deepEqual(Buffer.from(await fs.readFile("/hello.lzma")), helloLzma);
    await assert.rejects(fs.stat("/hello"), { code: "ENOENT" });

    await fs.writeFile("/hello.xz", helloXz);
    const overridden = await shell.exec("lzcat --format=xz /hello.xz");
    assert.equal(overridden.exitCode, 0, overridden.stderr);
    assert.equal(overridden.stdout, "hello");
  } finally { await shell.dispose(); }
});
