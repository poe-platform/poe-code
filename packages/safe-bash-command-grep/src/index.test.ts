import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createGrepCommands } from "./index.js";
import { createGrepAliases } from "./aliases.js";

for (const recursive of [["-r"], ["-R"], ["-d", "recurse"], []]) {
  for (const mode of [[], ["-l"], ["-c", "--include=*.txt"]]) {
    for (const operands of [[], ["."]]) {
      const name = recursive.length ? "grep" : "rgrep";
      const args = [...recursive, ...mode, "x", ...operands];
      test(`${name} ${args.join(" ")} preserves implicit versus explicit directory paths`, async () => {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/work/sub", { recursive: true });
        for (const file of ["a.txt", "sub/b.txt"]) {
          await fs.writeFile(`/work/${file}`, new TextEncoder().encode("x\n"));
        }
        const grep = createGrepCommands()[0]!;
        const command = name === "grep" ? grep : createGrepAliases(grep).find(command => command.name === name)!;
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = await command.execute({
          command: name, args: values.args, argumentValues: values, cwd: "/work", env: {},
          fs, stdin: toByteSource(""), stdinIsDefault: true,
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal,
        });
        const prefix = operands.length ? "./" : "";
        const suffix = mode.includes("-l") ? "" : mode.includes("-c") ? ":1" : ":x";
        assert.deepEqual({ ...result, stdout, stderr }, {
          exitCode: 0,
          stdout: `${prefix}a.txt${suffix}\n${prefix}sub/b.txt${suffix}\n`,
          stderr: "",
        });
      });
    }
  }
}

test("grep help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createGrepCommands()[0]!.execute({
  command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

test("grep reads each tenant's batched input without a global Buffer", async () => {
  const filesystems = await Promise.all(["first", "other"].map(async tenant => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode(`${tenant} line\n`.repeat(40)));
    return fs;
  }));
  const originalBuffer = globalThis.Buffer;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true, writable: true });
  try {
    const command = createGrepCommands()[0]!;
    for (const fs of [filesystems[0]!, filesystems[1]!, filesystems[0]!]) {
      const values = createCommandArguments(["^first", "/input"]);
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs, stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      const matches = fs === filesystems[0];
      assert.equal(result.exitCode, matches ? 0 : 1, stderr);
      assert.equal(stdout, matches ? "first line\n".repeat(40) : "");
    }
  } finally {
    Object.defineProperty(globalThis, "Buffer", { value: originalBuffer, configurable: true, writable: true });
  }
});

for (const flags of [["-n"], ["-n", "--line-buffered"]]) {
  test(`concurrent grep isolates large numbered batches (${flags.join(" ")})`, async () => {
    const command = createGrepCommands()[0]!;
    await Promise.all(["A", "B"].map(async tenant => {
      const fs = createMemoryFileSystem();
      const lines = Array.from({ length: 200 }, (_, i) => `TENANT_${tenant}_${i}_${tenant.repeat(600)}`);
      await fs.writeFile("/input", new TextEncoder().encode(lines.join("\n") + "\n"));
      let stdout = "", stderr = "";
      const values = createCommandArguments([...flags, "TENANT_", "/input"]);
      const result = await command.execute({
        command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
        stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { await Promise.resolve(); stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, lines.map((line, i) => `${i + 1}:${line}\n`).join(""));
    }));
  });
}

for (const [pattern, input, expected] of [
  [String.raw`version: \K.*`, "version: 1.2.3\n", "1.2.3\n"],
  [String.raw`\x61`, "a1\n", "a\n"],
  [String.raw`\Q.\E`, "a.b\n", ".\n"],
  [String.raw`(?:ab\Kc|ab)d`, "abd abcd\n", "abd\ncd\n"],
  [String.raw`a\Kb\Kc`, "abc abc\n", "c\nc\n"],
  [String.raw`[\x61-\x63]+`, "abc xyz\n", "abc\n"],
  [String.raw`\Q[a].*\E+`, "[a].**\n", "[a].**\n"],
  [String.raw`\Q.*`, "a.*b\n", ".*\n"],
] as const) test(`grep -oP supports ${pattern}`, async () => {
  let stdout = "", stderr = "";
  const result = await createGrepCommands()[0]!.execute({
    command: "grep", args: ["-oP", pattern], cwd: "/work", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input), stdinIsDefault: false,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
});

for (const [args, input, expected] of [
  [["-e", "-1"], "a-1\nb\n", "a-1\n"],
  [["-F", "-e", "-5"], "x -5 y\n", "x -5 y\n"],
  [["-m", "-1", "a"], "a\na\n", "a\na\n"],
  [["--regexp", "-1"], "a-1\nb\n", "a-1\n"],
  [["-Fe", "-5"], "x -5 y\n", "x -5 y\n"],
  [["--max-count=-1", "a"], "a\na\n", "a\na\n"],
  [["-1", "-e", "-1"], "before\na-1\nafter\nother\n", "before\na-1\nafter\n"],
  [["-e", "-1", "-1"], "before\na-1\nafter\nother\n", "before\na-1\nafter\n"],
  [["--", "-1"], "a-1\nb\n", "a-1\n"],
] as const) test(`grep preserves option values in ${args.join(" ")}`, async () => {
  let stdout = "", stderr = "";
  const result = await createGrepCommands()[0]!.execute({
    command: "grep", args, cwd: "/work", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input), stdinIsDefault: false,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
});

for (const [args, input, expected] of [
  [["café"], "café\n✓ done\n", "café\n"],
  [["-c", "✓"], "café\n✓ done\n", "1\n"],
  [["-E", "é|x"], "café\n✓ done\n", "café\n"],
  [["😀"], "😀\n", "😀\n"],
  [["-oE", "😀+|中文"], "😀😀 中文\n", "😀😀\n中文\n"],
  [["-w", "café"], "café cafétéria\n", "café cafétéria\n"],
  [["-x", "café"], "café\ncafé noir\n", "café\n"],
  [["-i", "CAFé"], "café\n", "café\n"],
  [["é"], "è\n", ""],
] as const) {
  test(`grep matches UTF-8 literals: ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/f", new TextEncoder().encode(input));
    const values = createCommandArguments([...args, "/f"]);
    let stdout = "", stderr = "";
    const result = await createGrepCommands()[0]!.execute({
      command: "grep", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs, stdin: toByteSource(""), stdinIsDefault: true,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: expected ? 0 : 1, stdout: expected, stderr: "" });
  });
}
