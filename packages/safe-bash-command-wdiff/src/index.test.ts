import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type ByteSource } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createWdiffCommand, type WdiffCommandsOptions } from "./index.js";

async function compare(old: string | Uint8Array, next: string | Uint8Array, options: WdiffCommandsOptions = {}, args = ["old", "new"], stdin: ByteSource = (async function* () {})(), signal = new AbortController().signal) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/old", typeof old === "string" ? new TextEncoder().encode(old) : old);
  await fs.writeFile("/new", typeof next === "string" ? new TextEncoder().encode(next) : next);
  const bytes: number[] = [];
  let stderr = "";
  const result = await createWdiffCommand(options).execute({
    command: "wdiff", args: createCommandArguments(args).args,
    cwd: "/", env: {}, fs, signal, stdin,
    stdout: { async write(chunk) { bytes.push(...chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { code: result.exitCode, bytes, stdout: new TextDecoder().decode(Uint8Array.from(bytes)), stderr };
}

test("compares and preserves distinct non-UTF-8 words", async () => {
  const result = await compare(Uint8Array.of(0xff), Uint8Array.of(0xfe));
  expect(result.code).toBe(1);
  expect(result.bytes).toEqual([91, 45, 255, 45, 93, 32, 123, 43, 254, 43, 125]);
});

test("preserves unchanged invalid bytes and embedded NUL", async () => {
  const bytes = Uint8Array.of(0xff, 0, 0xfe, 10);
  const result = await compare(bytes, bytes);
  expect(result.code).toBe(0);
  expect(result.bytes).toEqual([...bytes]);
});

test.each([
  ["a b a", "a a", "a [-b-] a", 1],
  ["", "one two", "{+one two+}", 1],
  ["one two", "", "[-one two-]", 1],
  [" a\t b\n", "\ta  b\r\n", "\ta  b\r\n", 0],
  ["", " \n", " \n", 0],
  ["a\u00a0b", "a b", "[-a\u00a0b-] {+a b+}", 1],
])("handles word edits and whitespace: %j to %j", async (old, next, stdout, code) => {
  expect(await compare(old, next)).toMatchObject({ stdout, code });
});

test("consumes stdin as either operand", async () => {
  const source = async function* () { yield new TextEncoder().encode("a b"); };
  expect(await compare("", "a c", {}, ["-", "new"], source())).toMatchObject({ code: 1, stdout: "a [-b-] {+c+}" });
  expect(await compare("a c", "", {}, ["old", "-"], source())).toMatchObject({ code: 1, stdout: "a [-c-] {+b+}" });
});

test("rejects two stdin operands", async () => {
  expect(await compare("", "", {}, ["-", "-"])).toMatchObject({ code: 2, stdout: "" });
});

test("bounds combined file and stdin bytes and matrix allocation", async () => {
  await expect(compare("ab", "cd", { limits: { maxInputBytes: 3 } })).rejects.toThrow("input byte limit");
  await expect(compare("a b", "a c", { limits: { maxMatrixCells: 8 } })).rejects.toThrow("matrix cell limit");
  await expect(compare("ab", "", { limits: { maxInputBytes: 3 } }, ["old", "-"], (async function* () { yield Uint8Array.of(99, 100); })())).rejects.toThrow("input byte limit");
});

test("stops matrix work on cancellation without output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel comparison");
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { if (++checkpoints === 3) controller.abort(reason); });
  await expect(compare("a b", "a c", {}, undefined, undefined, controller.signal)).rejects.toBe(reason);
});

test("allows cancellation while scanning a single large word", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel scan");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await expect(compare("x".repeat(32768), "", {}, undefined, undefined, controller.signal)).rejects.toBe(reason);
});

test("marks changed words and preserves unchanged prose", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/old", new TextEncoder().encode("The old contract ends today.\n"));
  await fs.writeFile("/new", new TextEncoder().encode("The new contract ends tomorrow.\n"));
  let stdout = "";
  const result = await createWdiffCommand().execute({
    command: "wdiff", args: createCommandArguments(["old", "new"]).args,
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write() {} },
  });
  expect(result.exitCode).toBe(1);
  expect(stdout).toBe("The [-old-] {+new+} contract ends [-today.-] {+tomorrow.+}\n");
});
