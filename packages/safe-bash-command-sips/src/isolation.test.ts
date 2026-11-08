import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createSipsCommand, runSipsCli } from "./index.js";

it.each(["png", "jpeg"] as const)("isolates %s metadata from identical files and survives byte copies", async format => {
  const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).toFormat(format).toBuffer();
  const files = new Map([["a", original], ["b", original.slice()]]);
  const tenant = new Map([["a", original.slice()]]);
  expect((await runSipsCli(["-s", "copyright", "CONFIDENTIAL", "a"], files)).exitCode).toBe(0);
  expect((await runSipsCli(["-g", "copyright", "b"], files)).stdout).toContain("copyright: <nil>");
  expect((await runSipsCli(["-g", "copyright", "a"], tenant)).stdout).toContain("copyright: <nil>");
  const copied = new Map([["copy", files.get("a")!.slice()]]);
  expect((await runSipsCli(["-g", "copyright", "copy"], copied)).stdout).toContain("copyright: CONFIDENTIAL");
});

it("refuses missing output parents without creating directories", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.png", await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer());
  const args = createCommandArguments(["-r", "90", "in.png", "-o", "missing/out.png"]);
  const context = { command: "sips", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} }
  } as CommandContext;
  expect(await createSipsCommand().execute(context)).toEqual({ exitCode: 1 });
  await expect(fs.stat("/missing")).rejects.toThrow();
});

it.each(["png", "jpeg"] as const)("replaces %s metadata without accumulating history and rejects oversized values", async format => {
  const original = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).toFormat(format).toBuffer();
  const files = new Map([["in", original]]);
  for (const value of ["first", "other", "final"]) {
    expect((await runSipsCli(["-s", "description", value, "in"], files)).exitCode).toBe(0);
    expect(files.get("in")!.length).toBeLessThan(original.length + 200);
  }
  const before = files.get("in");
  const result = await runSipsCli(["-s", "description", "x".repeat(65501), "in"], files);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("metadata byte limit");
  expect(files.get("in")).toBe(before);
  expect((await runSipsCli(["-d", "description", "in"], files)).exitCode).toBe(0);
  expect((await runSipsCli(["-g", "description", "in"], new Map([["in", files.get("in")!.slice()]]))).stdout).toContain("description: <nil>");
});

it("normalizes relative VFS paths and preserves metadata across independent filesystems", async () => {
  const fs = createMemoryFileSystem();
  const other = createMemoryFileSystem();
  await fs.mkdir("/work");
  const original = await sharp({ create: { width: 1, height: 1, channels: 3, background: "green" } }).png().toBuffer();
  await fs.writeFile("/in.png", original);
  await other.writeFile("/in.png", original);
  const execute = async (filesystem: typeof fs, cwd: string, argv: string[]) => {
    const output: string[] = [];
    const args = createCommandArguments(argv);
    const context = { command: "sips", args: args.args, argumentValues: args, cwd, env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes: Uint8Array) { output.push(new TextDecoder().decode(bytes)); } }, stderr: { async write() {} }
    } as CommandContext;
    expect((await createSipsCommand().execute(context)).exitCode).toBe(0);
    return output.join("");
  };
  await execute(fs, "/work", ["-s", "description", "tenant A", "../in.png", "-o", "./../out.png"]);
  expect(await execute(fs, "/", ["-g", "description", "out.png"])).toContain("description: tenant A");
  expect(await execute(other, "/", ["-g", "description", "in.png"])).toContain("description: <nil>");
  await other.writeFile("/copy.png", (await fs.readFile("/out.png")).slice());
  expect(await execute(other, "/", ["-g", "description", "copy.png"])).toContain("description: tenant A");
});

it("charges serialized metadata to file output and subsequent input budgets", async () => {
  const fs = createMemoryFileSystem();
  const original = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await fs.writeFile("/in.png", original);
  const args = createCommandArguments(["-s", "description", "budgeted metadata", "in.png"]);
  const context = { command: "sips", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal, registerCleanup() {},
    stdout: { async write() {} }, stderr: { async write() {} }
  } as CommandContext;
  const failure = new Error("file output limit");
  let charged = 0;
  bindFileOutputBudget(context, sink => ({ async write(bytes) {
    charged += bytes.length;
    if (charged > original.length) throw failure;
    await sink.write(bytes);
  } }));
  await expect(createSipsCommand().execute(context)).rejects.toBe(failure);
  expect(charged).toBeGreaterThan(original.length);
  expect(await fs.readFile("/in.png")).toEqual(original);
  bindFileOutputBudget(context, sink => sink);
  expect((await createSipsCommand().execute(context)).exitCode).toBe(0);
  await expect(createSipsCommand({ limits: { maxInputBytes: original.length } }).execute(context)).rejects.toThrow("input byte limit");
});

it("rejects unsupported metadata output without publishing an unannotated file", async () => {
  const files = new Map([["in", await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer()]]);
  const result = await runSipsCli(["-s", "description", "keep me", "-s", "format", "gif", "in", "-o", "out"], files);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("property persistence is not supported for gif");
  expect(files.has("out")).toBe(false);
});
