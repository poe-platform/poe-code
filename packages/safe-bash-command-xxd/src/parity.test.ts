import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXxdCommand } from "./index.js";

async function run(args: string[], input: string | Uint8Array = "", fs = createMemoryFileSystem(), context: Partial<Pick<CommandContext, "shellPredicates">> = {}) {
  const values = createCommandArguments(args);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createXxdCommand().execute({
    ...context,
    command: "xxd", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  const bytes = Buffer.concat(chunks);
  return { ...result, bytes, stdout: bytes.toString(), stderr };
}

test("seek past EOF succeeds with empty output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", Buffer.from("abc"));
  const result = await run(["-s", "100", "/data"], "", fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("negative file seeks use EOF and preserve addresses", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", Buffer.from("abcdef"));
  for (const seek of ["-2", "+-2"]) {
    const result = await run(["-s", seek, "/data"], "", fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "00000004: 6566                                     ef\n");
  }
  assert.equal((await run(["-s", "-7", "/data"], "", fs)).exitCode, 4);
});

test("autoskip collapses zero runs, preserves final line, and toggles", async () => {
  const input = new Uint8Array(80);
  for (const flag of ["-a", "-autoskip"]) {
    const result = await run([flag], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "00000000: 0000 0000 0000 0000 0000 0000 0000 0000  ................\n*\n00000040: 0000 0000 0000 0000 0000 0000 0000 0000  ................\n");
    const reversed = await run(["-r"], result.stdout);
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.deepEqual(reversed.bytes, Buffer.from(input));
  }
  for (const args of [["-a", "-a"], ["-a", "-autoskip"], ["-autoskip", "-autoskip"], ["-a", "-a", "-a"]]) {
    const result = await run(args, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, execFileSync("/usr/bin/xxd", args, { input }).toString());
  }
});

test("capitalize affects include identifiers and length suffix only", async () => {
  for (const flag of ["-C", "-capitalize"]) {
    const result = await run(["-i", flag, "-n", "a-b"], "z");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "unsigned char A_B[] = {\n  0x7a\n};\nunsigned int A_B_LEN = 1;\n");
  }
});

test("reverse pads initial and interior sparse addresses", async () => {
  const result = await run(["-r"], "00000004: 4142  AB\n00000008: 43  C\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.bytes, Buffer.from([0, 0, 0, 0, 65, 66, 0, 0, 67]));
});

test("file operands write forward and reversed bytes with empty stdout", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("AB"));
  const forward = await run(["-p", "/input", "/dump"], "", fs);
  assert.equal(forward.exitCode, 0, forward.stderr);
  assert.equal(forward.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/dump")), "4142\n");
  const reverse = await run(["-r", "-p", "/dump", "/output"], "", fs);
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(reverse.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "AB");
});

for (const flag of ["-seek", "-skip"]) {
  test(`${flag} accepts a seek followed by a long length option`, async () => {
    const result = await run([flag, "2", "-len", "3"], "abcdefgh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "00000002: 6364 65                                  cde\n");
  });
}

for (const when of ["never", "auto"]) {
  test(`-R ${when} produces plain output on a nonterminal stream`, async () => {
    const result = await run(["-R", when, "-l", "4"], "abcdefgh");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "00000000: 6162 6364                                abcd\n");
  });
}

test("-E displays the EBCDIC character column", async () => {
  const result = await run(["-E"], "abcd");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "00000000: 6162 6364                                /...\n");
});

test("EBCDIC matches native for every byte across full and partial display rows", async () => {
  const input = Uint8Array.from({ length: 256 }, (_, byte) => byte);
  for (const args of [["-E"], ["-E", "-c", "13"], ["-E", "-b"], ["-E", "-e"], ["-E", "-p"], ["-E", "-i"]]) {
    const result = await run(args, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, execFileSync("/usr/bin/xxd", args, { input }).toString());
  }
});

test("-R always colors byte classes in hex, binary, little-endian and EBCDIC dumps", async () => {
  const input = Uint8Array.from({ length: 256 }, (_, byte) => byte);
  for (const mode of [[], ["-b"], ["-e"], ["-E"], ["-p"], ["-i"]]) {
    const args = ["-Ralways", "-c", "16", ...mode];
    const result = await run(args, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, execFileSync("/usr/bin/xxd", args, { input }).toString());
  }
});

test("color escapes preserve partial row alignment", async () => {
  for (const mode of [[], ["-b"], ["-e"], ["-E"]]) {
    const result = await run(["-R", "always", ...mode], "abcd");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.replaceAll(/\x1b\[[0-9;]*m/gu, ""), (await run(mode, "abcd")).stdout);
    assert.ok(result.stdout.includes("\x1b["));
  }
});

test("-R auto uses the command's terminal capability and never overrides it", async () => {
  const context = { shellPredicates: {
    variable: () => false, reference: () => false, option: () => false,
    terminal: (descriptor: number) => descriptor === 1,
  } };
  for (const when of ["auto", "never"]) {
    const result = await run(["-R", when], "abcd", undefined, context);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.includes("\x1b["), when === "auto");
  }
});

test("invalid color policies fail before opening output files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/output", Buffer.from("keep me"));
  const result = await run(["-R", "invalid", "-", "/output"], "abcd", fs);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "xxd: invalid color mode 'invalid'\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/output")), "keep me");
});
