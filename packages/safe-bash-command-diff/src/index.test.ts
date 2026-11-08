import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createDiffCommand, createDiffCommands, diffCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", files: Record<string, string> = { "/file": "old\n" }) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const fs = createMemoryFileSystem();
  for (const [path, contents] of Object.entries(files)) {
    await fs.writeFile(path, new TextEncoder().encode(contents));
  }
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone diff works with only portable filesystem and command contracts", async () => {
  assert.equal(createDiffCommand().name, "diff");
  assert.ok(createDiffCommands().some(command => command.name === "diff"));
  assert.equal(diffCommands().name, "diff-commands");
  const result = await run(createDiffCommand(), ["/file", "/file"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("forced text side-by-side preserves UTF-8 column boundaries", async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/left", new TextEncoder().encode("éééééééé\n"));
 await fs.writeFile("/right", new TextEncoder().encode("øøøøøøøø\n"));
 const render = async (text: boolean) => {
  const output: Uint8Array[] = [];
  const result = await createDiffCommand().execute({
   command: "diff", args: [...(text ? ["-a"] : []), "-y", "-W", "15", "/left", "/right"], cwd: "/", env: {}, fs,
   stdin: toByteSource(""), signal: new AbortController().signal,
   stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 1);
  return Buffer.concat(output);
 };
 assert.deepEqual(await render(true), await render(false));
});

for (const [name, args, left, right] of [
  ["computation", ["-u"], Array.from({ length: 1200 }, (_, i) => `old${i}\n`).join(""), Array.from({ length: 1200 }, (_, i) => `new${i}\n`).join("")],
  ["normal comparison", [], "old\n".repeat(800), "new\n".repeat(800)],
  ["whitespace normalization", ["-wc"], "a b\n".repeat(10_000), "ab\n".repeat(10_000)],
] as const) {
  test(`queued cancellation interrupts ${name} without stdout or stderr`, async t => {
    t.mock.method(performance, "now", () => 0);
    const controller = new AbortController();
    const reason = { cancellation: name };
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", new TextEncoder().encode(left));
    await fs.writeFile("/right", new TextEncoder().encode(right));
    const values = createCommandArguments([...args, "/left", "/right"]);
    let stdoutWrites = 0, stderrWrites = 0;
    const turn = setImmediate(() => controller.abort(reason));
    try {
      await assert.rejects(async () => createDiffCommand({ maxWork: 100_000_000 }).execute({
        command: "diff", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs, stdin: toByteSource(""), signal: controller.signal,
        stdout: { async write() { stdoutWrites++; } },
        stderr: { async write() { stderrWrites++; } },
      }), error => error === reason);
      assert.equal(stdoutWrites, 0);
      assert.equal(stderrWrites, 0);
    } finally { clearImmediate(turn); }
  });
}

for (const [name, left, right, script] of [
  ["left incomplete", "hello", "hello\n", ""],
  ["right incomplete", "hello\n", "hello", ""],
  ["both incomplete and equal", "hello", "hello", ""],
  ["both incomplete and different", "hello", "world", "1c\nworld\n.\n"],
  ["complete and equal", "hello\n", "hello\n", ""],
] as const) {
  for (const text of [false, true]) {
    test(`ed report-identical: ${name}, forced text ${text}`, async () => {
      const incomplete = !left.endsWith("\n") || !right.endsWith("\n");
      const result = await run(createDiffCommand(), [...(text ? ["-a"] : []), "-e", "-s", "/left", "/right"], "", { "/left": left, "/right": right });
      assert.deepEqual(result, {
        exitCode: incomplete ? 2 : 0,
        stdout: incomplete ? script : "Files /left and /right are identical\n",
        stderr: [["/left", left], ["/right", right]].filter(([, contents]) => !contents!.endsWith("\n")).map(([path]) => `diff: ${path}: No newline at end of file\n\n`).join(""),
      });
    });
    for (const brief of ["-q", "--brief"]) {
      test(`ed ${brief}: ${name}, forced text ${text}`, async () => {
        const result = await run(createDiffCommand(), [...(text ? ["-a"] : []), "-e", brief, "/left", "/right"], "", { "/left": left, "/right": right });
        assert.deepEqual(result, {
          exitCode: left === right ? 0 : 1,
          stdout: left === right ? "" : "Files /left and /right differ\n",
          stderr: "",
        });
      });
    }
  }
}
