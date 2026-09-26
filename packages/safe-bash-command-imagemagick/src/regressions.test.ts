import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runCompareCli, runConvertCli, runMogrifyCli } from "./index.js";

it("applies mogrify read density before decoding and keeps resize after decoding", async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="red"/></svg>');
  const files = new Map([["test.svg", svg]]);
  expect((await runMogrifyCli(["-density", "144", "-format", "png", "test.svg"], files)).exitCode).toBe(0);
  expect(files.has("test.png")).toBe(true);
  expect(await sharp(files.get("test.png")!).metadata()).toMatchObject({ width: 20, height: 10 });
  expect((await runMogrifyCli(["-density", "144", "-resize", "5x3!", "-format", "png", "test.svg"], files)).exitCode).toBe(0);
  expect(files.has("test.png")).toBe(true);
  expect(await sharp(files.get("test.png")!).metadata()).toMatchObject({ width: 5, height: 3 });
});

it("tiles input pixels to the requested canvas dimensions", async () => {
  const pattern = await sharp(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const files = new Map([["pattern.png", pattern]]);
  expect((await runConvertCli(["-size", "5x3", "tile:pattern.png", "out.png"], files)).exitCode).toBe(0);
  expect(await sharp(files.get("out.png")!).metadata()).toMatchObject({ width: 5, height: 3 });
  const pixels = await sharp(files.get("out.png")!).raw().toBuffer();
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) expect([...pixels.slice((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]).toEqual(x % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
});

it("returns comparison status and emits metrics only on stderr", async () => {
  const files = new Map<string, Uint8Array>();
  await runConvertCli(["-size", "2x2", "xc:red", "a.png"], files);
  await runConvertCli(["-size", "2x2", "xc:blue", "b.png"], files);
  for (const output of ["null:", "diff.png", "png:-"]) {
    const different = await runCompareCli(["-metric", "AE", "a.png", "b.png", output], files);
    expect(different.exitCode).toBe(1);
    expect(different.stdout).toBe("");
    expect(different.stderr).toBe("4\n");
    const same = await runCompareCli(["-metric", "AE", "a.png", "a.png", output], files);
    expect(same.exitCode).toBe(0);
    expect(same.stdout).toBe("");
    expect(same.stderr).toBe("0\n");
  }
});

it.each(["png:-", "-", "out.png"])("does not drain stdin for file or tile input and output %s", async (output) => {
  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: "red" } }).png().toBuffer();
  for (const input of ["in.png", "tile:in.png"]) {
    let reads = 0;
    const args = createCommandArguments(["-size", "4x2", input, output]);
    const context = {
      command: "magick", args: args.args, argumentValues: args, cwd: "/vfs", env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { reads++; return { async next() { return { done: true, value: undefined }; } }; } },
      stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {},
      fs: { async readFile(path: string) { if (path !== "/vfs/in.png") throw new Error("missing"); return png.slice(); }, async writeFile() {}, async mkdir() {} }
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(reads).toBe(0);
  }
});

it.each(["-", "png:-"])("still reads genuine stdin input %s", async (input) => {
  const png = await sharp({ create: { width: 2, height: 1, channels: 4, background: "blue" } }).png().toBuffer();
  for (const argv of [[input, "png:-"], ["identify", input]]) {
    let reads = 0;
    const args = createCommandArguments(argv);
    const output: Uint8Array[] = [];
    const context = {
      command: "magick", args: args.args, argumentValues: args, cwd: "/vfs", env: {}, signal: new AbortController().signal,
      stdin: (async function* () { reads++; yield png; })(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write() {} }, registerCleanup() {},
      fs: { async readFile() { throw new Error("missing"); } }
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(reads).toBe(1);
    expect(output.length).toBeGreaterThan(0);
  }
});
