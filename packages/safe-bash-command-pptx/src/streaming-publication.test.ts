import { expect, it } from "vitest";
import { createMemoryFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPptxCommand, type PptxCommandEngine } from "./index.js";

for (const mode of ["success", "failure", "changed", "cancel", "dry-run"] as const) it(`stages retained input publication atomically: ${mode}`, async () => {
  const owner = createMemoryFileSystem();
  const controller = new AbortController();
  const cancelled = new Error("cancel publication");
  let outstanding = 0, peak = 0, staged = 0;
  const fs = new Proxy(owner, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const staging = await owner.createStagedFile!(...args);
      return { ...staging, writer: { async write(bytes: Uint8Array, options: Parameters<NonNullable<typeof staging.writer>["write"]>[1]) {
        outstanding += bytes.length; peak = Math.max(peak, outstanding);
        expect(bytes.length).toBeLessThanOrEqual(16384);
        await Promise.resolve();
        try { await staging.writer!.write(bytes, options); staged += bytes.length; }
        finally { outstanding -= bytes.length; }
      }, finish: staging.writer!.finish.bind(staging.writer) } };
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await fs.writeFile("/deck", new Uint8Array([1, 2, 3]), { mode: 0o600 });
  let pulls = 0;
  const engine: PptxCommandEngine = { async execute(request) {
    const originalBytes = await request.streaming.openInput("deck", Infinity);
    const bytes = (async function* () {
      const chunk = new Uint8Array(16384);
      for (let n = 0; n < 80; n++) {
        expect(outstanding).toBe(0);
        pulls++;
        if (n === 1 && mode === "cancel") controller.abort(cancelled);
        if (n === 1 && mode === "failure") throw new Error("source failed");
        if (n === 1 && mode === "changed") await fs.writeFile("/deck", new Uint8Array([7]));
        chunk.fill(n);
        yield chunk;
      }
    })();
    await request.publishOutput!({ inputPath: "deck", outputPath: "deck", originalBytes, bytes,
      inPlace: true, force: false, dryRun: mode === "dry-run" });
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const run = Promise.resolve(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args,
    cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: controller.signal,
    stdout: { async write() {} }, stderr: { async write() {} } }));
  if (mode === "cancel") await expect(run).rejects.toBe(cancelled);
  else if (mode === "failure" || mode === "changed") await expect(run).rejects.toMatchObject({ code: mode === "changed" ? "stale-input" : "io-failure" });
  else expect((await run).exitCode).toBe(0);
  const output = await fs.readFile("/deck");
  if (mode === "success") {
    expect((await fs.stat("/deck")).mode & 0o777).toBe(0o600);
    expect(output.length).toBe(80 * 16384);
    expect(staged).toBe(output.length);
    expect(peak).toBe(16384);
    for (let n = 0; n < 80; n++) expect(output.subarray(n * 16384, (n + 1) * 16384).every(byte => byte === n)).toBe(true);
  } else expect(output).toEqual(new Uint8Array(mode === "changed" ? [7] : [1, 2, 3]));
  if (mode === "dry-run") expect(pulls).toBe(0);
  expect(await fs.readdir("/")).toEqual([{ name: "deck", type: "file" }]);
});

for (const mode of ["new", "force", "exists", "protected"] as const) it(`preserves streamed output destination policy: ${mode}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array([1]));
  if (mode !== "new") await fs.writeFile("/output", new Uint8Array([2]));
  let pulled = false;
  const engine: PptxCommandEngine = { async execute(request) {
    const originalBytes = await request.streaming.openInput("input", Infinity);
    if (mode === "protected") await request.streaming.openInput("output", Infinity);
    await request.publishOutput!({ inputPath: "input", outputPath: "output", originalBytes,
      bytes: (async function* () { pulled = true; yield new Uint8Array([3]); })(),
      inPlace: false, force: mode !== "exists", dryRun: false });
    return { exitCode: 0 };
  } };
  const args = createCommandArguments([]);
  const run = Promise.resolve(createPptxCommand({ engine }).execute({ command: "pptx", args: args.args, argumentValues: args,
    cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} } }));
  const rejected = mode === "exists" || mode === "protected";
  if (rejected) await expect(run).rejects.toMatchObject({ code: "io-failure" });
  else await run;
  expect(pulled).toBe(!rejected);
  expect(await fs.readFile("/output")).toEqual(new Uint8Array([rejected ? 2 : 3]));
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "output"]);
});
