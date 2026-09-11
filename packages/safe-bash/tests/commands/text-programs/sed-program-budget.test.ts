import assert from "node:assert/strict";
import test from "node:test";
import { sedCommand } from "../../../src/commands/text-programs/sed.js";
import { textProgramCommands, type TextProgramOptions } from "../../../src/commands/text-programs/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { agentCommands as defaultCommands } from "../../../src/index.js";
import { Shell } from "../../../src/shell/index.js";
import { makeFileSystem, runVirtual } from "./helpers.js";

for (const value of [0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
  test(`sed rejects invalid program instruction limit ${String(value)} before reading scripts`, async () => {
    const result = await runVirtual("sed", { args: ["-f", "missing"] }, { maxProgramInstructions: value as number });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "sed: maxProgramInstructions must be a positive safe integer\n");
    assert.equal(result.stdout.length, 0);
  });
}

for (const count of [1, 2, 3, 20, 100]) {
  test(`sed admits ${count} substitutions against a two-instruction cap on empty input`, async () => {
    let consumed = false;
    const source = (async function* () { consumed = true; yield* []; })();
    const result = await runVirtual("sed", { args: ["s/a/b/;".repeat(count)] }, {
      maxProgramInstructions: 2, maxSteps: 1, maxBufferBytes: 1,
    }, source);
    assert.equal(result.exitCode, count <= 2 ? 0 : 2);
    assert.equal(result.stderr.toString(), count <= 2 ? "" : "sed: program instruction limit exceeded\n");
    assert.equal(result.stdout.length, 0);
    assert.equal(consumed, count <= 2);
  });
}

for (const count of [1024, 1025]) {
  test(`sed default program instruction limit admits exactly 1024, count ${count}`, async () => {
    const result = await runVirtual("sed", { args: ["p;".repeat(count)] });
    assert.equal(result.exitCode, count === 1024 ? 0 : 2);
    assert.equal(result.stderr.toString(), count === 1024 ? "" : "sed: program instruction limit exceeded\n");
  });
}

test("sed program instruction limit can be raised above the default", async () => {
  const result = await runVirtual("sed", { args: ["p;".repeat(1025)] }, { maxProgramInstructions: 1025 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
});

test("sed accepts the largest safe integer program instruction limit", async () => {
  const result = await runVirtual("sed", { args: ["s/a/b/"], stdin: "a\n" }, { maxProgramInstructions: Number.MAX_SAFE_INTEGER });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "b\n");
});

for (const [program, count] of [
  ["{}", 2],
  ["{{}}", 4],
  [":label;p", 2],
  ["p;p", 2],
] as const) {
  for (const limit of [count - 1, count]) {
    test(`sed counts every instruction in ${program} with limit ${limit}`, async () => {
      const result = await runVirtual("sed", { args: [program] }, { maxProgramInstructions: limit });
      assert.equal(result.exitCode, limit < count ? 2 : 0);
      assert.equal(result.stderr.toString(), limit < count ? "sed: program instruction limit exceeded\n" : "");
    });
  }
}

for (const program of ["", " \t;\n# comment\n", "# comment\n ;s/a/b/;# tail\n \t;", "s|a|b;c|", "a text;still text"]) {
  test(`sed does not count separators, comments or command payloads: ${JSON.stringify(program)}`, async () => {
    const result = await runVirtual("sed", { args: [program] }, { maxProgramInstructions: 1 });
    assert.equal(result.exitCode, 0, result.stderr.toString());
  });
}

for (const args of [
  ["-e", "s/a/b/", "-e", "s/b/c/"],
  ["-f", "first", "-f", "second"],
  ["-es/a/b/", "-fsecond"],
  ["-ffirst", "-es/b/c/"],
]) {
  for (const limit of [1, 2]) {
    test(`sed cumulative sources ${args.join(" ")} with limit ${limit}`, async () => {
      const result = await runVirtual("sed", {
        args, stdin: "a\n", files: { first: "s/a/b/", second: "s/b/c/" },
      }, { maxProgramInstructions: limit });
      assert.equal(result.exitCode, limit === 1 ? 2 : 0);
      assert.equal(result.stderr.toString(), limit === 1 ? "sed: program instruction limit exceeded\n" : "");
      assert.equal(result.stdout.toString(), limit === 1 ? "" : "c\n");
    });
  }
}

for (const instruction of ["s/[/b/", "/[/p", "/a/,/[/p"]) {
  for (const limit of [2, 3]) {
    test(`sed admission precedes regex compilation for ${instruction}, limit ${limit}`, async () => {
      const result = await runVirtual("sed", { args: [`p;p;${instruction}`] }, { maxProgramInstructions: limit });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr.toString(), limit === 2
        ? "sed: program instruction limit exceeded\n"
        : "sed: unterminated bracket expression\n");
      assert.equal(result.stdout.length, 0);
    });
  }
}

for (const [instruction, patterns] of [["s/a/b/", 1], ["/a/p", 1], ["/a/,/b/s/c/d/", 3]] as const) {
  test(`sed compiles only admitted patterns for ${instruction}`, async () => {
    const original = Array.prototype.push;
    let compiled = 0;
    Array.prototype.push = function <Value>(this: Value[], ...items: Value[]): number {
      const result = original.apply(this, items);
      const item = items[0];
      if (items.length === 1 && typeof item === "object" && item !== null && "kind" in item && item.kind === "match") compiled++;
      return result;
    };
    let result;
    try {
      result = await runVirtual("sed", { args: [`${instruction};`.repeat(3)] }, { maxProgramInstructions: 2 });
    } finally { Array.prototype.push = original; }
    assert.equal(compiled, patterns * 2);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), "sed: program instruction limit exceeded\n");
  });
}

test("sed program rejection precedes stdout, output file creation and truncation", async () => {
  const result = await runVirtual("sed", {
    args: ["-e", "w existing", "-e", "w created", "-e", "p"], stdin: "a\n", files: { existing: "untouched\n" },
  }, { maxProgramInstructions: 2 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "sed: program instruction limit exceeded\n");
  assert.equal(result.stdout.length, 0);
  assert.deepEqual(result.files, { existing: Buffer.from("untouched\n") });
});

test("sed program rejection precedes in-place changes and backups", async () => {
  const result = await runVirtual("sed", {
    args: ["-i.bak", "s/a/b/;p", "input"], files: { input: "a\n" },
  }, { maxProgramInstructions: 1 });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr.toString(), "sed: program instruction limit exceeded\n");
  assert.equal(result.stdout.length, 0);
  assert.deepEqual(result.files, { input: Buffer.from("a\n") });
});

test("sed admitted output and in-place programs retain their effects", async () => {
  const result = await runVirtual("sed", {
    args: ["-i.bak", "-e", "s/a/b/", "-e", "w output", "input"], files: { input: "a\n" },
  }, { maxProgramInstructions: 2 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.files, { input: Buffer.from("b\n"), "input.bak": Buffer.from("a\n"), output: Buffer.from("b\n") });
});

test("direct sed definition enforces program admission before input reads", async () => {
  const fs = await makeFileSystem();
  const errors: Uint8Array[] = [];
  const definition = sedCommand({ maxProgramInstructions: 1 });
  const result = await definition.execute({
    command: "sed", args: ["s/a/b/;p"], cwd: "/work", env: {}, fs, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { assert.fail("rejected program must not acquire stdin"); } },
    stdout: { async write() { assert.fail("rejected program must not write stdout"); } },
    stderr: { async write(chunk) { errors.push(chunk.slice()); } },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(Buffer.concat(errors).toString(), "sed: program instruction limit exceeded\n");
});

for (const route of ["text", "aggregate", "default"] as const) {
  test(`sed shell command and subsequent invocations honor the ${route} family configuration`, async () => {
    const options: TextProgramOptions = { maxProgramInstructions: 1 };
    const plugin = route === "text" ? textProgramCommands(options) : route === "aggregate" ? agentCommands({ text: options })
      : defaultCommands({ text: options, regexExecutor: { createWorker() { throw new Error("sed must not create a worker"); } } });
    const shell = new Shell({ fs: await makeFileSystem(), cwd: "/work" }).use(plugin);
    try {
      const rejected = await shell.exec("sed 's/a/b/;s/b/c/'", { stdin: "a\n" });
      assert.equal(rejected.exitCode, 2);
      assert.equal(rejected.stderr, "sed: program instruction limit exceeded\n");
      assert.equal(rejected.stdout, "");
      for (let invocation = 0; invocation < 2; invocation++) {
        const admitted = await shell.exec("sed 's/a/b/'", { stdin: "a\n" });
        assert.equal(admitted.exitCode, 0, admitted.stderr);
        assert.equal(admitted.stdout, "b\n");
      }
    } finally { await shell.dispose(); }
  });
}
