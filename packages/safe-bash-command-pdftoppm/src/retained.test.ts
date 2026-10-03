import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument, cosArray, cosNumber, dictSet } from "@poe-code/pdf-ast";
import { createPdftoppmCommand, runPdftoppmCli, createPdftocairoCommand, runPdftocairoCli } from "./index.js";
function pdf() {
  const doc = PdfDocument.create();
  for (const rotation of [0, 90]) {
    const page = doc.addPage(); dictSet(page.pageDict, "MediaBox", cosArray([0, 0, 17, 19].map(value => cosNumber(value))));
    dictSet(page.pageDict, "Rotate", cosNumber(rotation)); page.drawRect({ x: 2, y: 3, width: 7, height: 8, fill: { r: 0.2, g: 0.7, b: 0.4 } });
  }
  return doc.save();
}
async function fixture(input: Uint8Array, args: string[], stdin = false) {
  const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", input);
  let reads = 0, writes = 0, published = 0; const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const guarded = new Proxy(Object.create(fs) as typeof fs, { get(_target, key) {
    if (key === "readFile") return async () => { reads++; throw new Error("whole reads forbidden"); };
    if (key === "writeFile") return async () => { writes++; throw new Error("whole writes forbidden"); };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<typeof fs.publishStagedFile>>) => { published++; return fs.publishStagedFile!(...args); };
    const value = Reflect.get(fs, key); return typeof value === "function" ? value.bind(fs) : value;
  } });
  const carrier = createCommandArguments(args), controller = new AbortController();
  const context = { command: "pdftoppm", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: controller.signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array, void, unknown> { if (!stdin) return; const buffer = new Uint8Array(37); for (let at = 0; at < input.length; at += 37) { const size = Math.min(37, input.length - at); buffer.set(input.subarray(at, at + size)); yield buffer.subarray(0, size); } })(),
    stdout: { async write(bytes: Uint8Array) { await Promise.resolve(); stdout.push(bytes.slice()); } }, stderr: { async write(bytes: Uint8Array) { stderr.push(bytes.slice()); } },
  };
  return { fs, context, controller, stdout, stderr, counts: () => ({ reads, writes, published }), async clean() { assert.deepEqual(await fs.readdir("/scratch"), []); } };
}
for (const flags of [[], ["-gray"], ["-mono"], ["-png"], ["-jpeg"], ["-tiff"], ["-png", "-gray"], ["-tiff", "-tiffcompression", "lzw"], ["-rx", "90", "-ry", "47", "-x", "2", "-W", "9"]]) {
  test(`retained rendering matches bytes without whole input or output: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf", "out"], files = new Map([["in.pdf", input]]); const expected = await runPdftoppmCli(args, files);
    const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 2 }); await f.clean();
  });
}
test("retained rendering accepts reused stdin and streams multiple images to a slow sink", async () => {
  const input = pdf(), args = ["-png", "-", "-"]; const expected = await runPdftoppmCli(args, new Map([["-", input]])); const f = await fixture(input, args, true);
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 0); assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)), expected.stdoutBytes);
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
});
for (const flags of [["-f", "9"], ["-q", "-f", "9"], ["-f", "2", "-singlefile", "-forcenum", "-setpageno", "7", "-sep", "_", "-progress"], ["-e", "-singlefile", "-scale-to", "20"], ["-o", "-scale-to-x", "20", "-scale-to-y", "-1"]]) {
  test(`retained rendering preserves selection and diagnostics: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf", "out"], files = new Map([["in.pdf", input]]); const expected = await runPdftoppmCli(args, files);
    const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.equal(f.counts().reads, 0); await f.clean();
  });
}
test("retained renderer rejects input budget before payload reads and publication", async () => {
  const input = pdf(), f = await fixture(input, ["in.pdf", "out"]);
  await assert.rejects(async () => createPdftoppmCommand({ limits: { maxInputBytes: input.length - 1 } }).execute(f.context));
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: 0 }); await f.clean();
});
test("retained renderer propagates sink failures and cleans staged pages", async () => {
  const f = await fixture(pdf(), ["in.pdf", "-"]), reason = { reason: "sink closed" };
  f.context.stdout.write = async () => { throw reason; };
  await assert.rejects(async () => createPdftoppmCommand().execute(f.context), error => error === reason); await f.clean();
});
test("retained renderer cancels stdin with primary error identity and no publication", async () => {
  const input = pdf(), f = await fixture(input, ["-", "out"], true), reason = { reason: "input cancelled" }; let closed = false;
  f.context.stdin = (async function* () { try { yield input.subarray(0, 31); f.controller.abort(reason); yield input.subarray(31); } finally { closed = true; } })();
  await assert.rejects(async () => createPdftoppmCommand().execute(f.context), error => error === reason); assert.equal(closed, true);
  assert.equal(f.counts().published, 0); await f.clean();
});
test("retained renderer keeps an existing destination after a partially accepted publication write fails", async () => {
  const f = await fixture(pdf(), ["-singlefile", "in.pdf", "out"]); await f.fs.writeFile("/out.ppm", new TextEncoder().encode("old image"));
  const base = f.context.fs;
  f.context.fs = new Proxy(Object.create(base) as typeof base, { get(_target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<typeof base.createStagedFile>>) => {
      const staged = await base.createStagedFile!(...args); if (args[1] !== "output") return staged;
      return { ...staged, writer: { finish: staged.writer!.finish.bind(staged.writer), async write(...values: Parameters<NonNullable<typeof staged.writer>["write"]>) {
        await staged.writer!.write(...values); throw Object.assign(new Error("partial publication write"), { code: "EIO" });
      } } };
    };
    const value = Reflect.get(base, key); return typeof value === "function" ? value.bind(base) : value;
  } });
  assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, 1);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/out.ppm")), "old image"); assert.equal(f.counts().published, 0); await f.clean();
});
for (const quiet of [false, true]) test(`retained renderer preserves encrypted input diagnostics (quiet=${quiet})`, async () => {
  const doc = PdfDocument.create(); doc.addPage([8, 8]); const input = doc.save({ encrypt: { userPassword: "reader", ownerPassword: "owner" } });
  const args = [...(quiet ? ["-q"] : []), "-upw", "wrong", "in.pdf", "out"], expected = await runPdftoppmCli(args, new Map([["in.pdf", input]]));
  const f = await fixture(input, args); assert.equal((await createPdftoppmCommand().execute(f.context)).exitCode, expected.exitCode);
  assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), expected.stderr); assert.equal(f.counts().published, 0); await f.clean();
});
for (const flags of [[], ["-png"], ["-png", "-gray"], ["-png", "-mono"], ["-jpeg"], ["-tiff", "-mono"], ["-png", "-antialias", "none", "-transp"]]) {
  test(`retained Cairo preserves existing raster bytes and default output names: ${flags.join(" ")}`, async () => {
    const input = pdf(), args = [...flags, "in.pdf"], files = new Map([["in.pdf", input]]), expected = await runPdftocairoCli(args, files);
    const f = await fixture(input, args); f.context.command = "pdftocairo";
    assert.equal((await createPdftocairoCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, expected.exitCode);
    for (const [name, bytes] of files) if (name !== "in.pdf") assert.deepEqual(await f.fs.readFile("/" + name), bytes);
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, published: files.size - 1 }); await f.clean();
  });
}
test("retained Cairo keeps stdout grayscale semantics with reused input and a slow sink", async () => {
  const input = pdf(), args = ["-png", "-gray", "-", "-"], expected = await runPdftocairoCli(args, new Map([["-", input]]));
  const f = await fixture(input, args, true); f.context.command = "pdftocairo";
  assert.equal((await createPdftocairoCommand({ limits: { maxInputBytes: input.length } }).execute(f.context)).exitCode, 0);
  assert.deepEqual(new Uint8Array(Buffer.concat(f.stdout)), expected.stdoutBytes); assert.equal(f.counts().reads, 0); await f.clean();
});
test("retained Cairo preserves publication exit code and missing-parent diagnostic", async () => {
  const f = await fixture(pdf(), ["-png", "in.pdf", "/missing/out"]); f.context.command = "pdftocairo";
  assert.equal((await createPdftocairoCommand().execute(f.context)).exitCode, 2);
  assert.equal(new TextDecoder().decode(Buffer.concat(f.stderr)), "Error opening output file /missing/out-1.png\n");
  assert.equal(f.counts().published, 0); await f.clean();
});
