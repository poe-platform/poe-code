import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  it.each([
    [["-page", "12x12+2+3", "/input.png"], { width: 12, height: 12, x: 2, y: 3 }],
    [["-page", "12x12-2-3", "/input.png"], { width: 12, height: 12, x: -2, y: -3 }],
    [["-page", "12x12+2+3", "+page", "/input.png"], undefined],
    [["/input.png", "-page", "12x12+2+3"], { width: 12, height: 12, x: 2, y: 3 }],
    [["-page", "12x12+2+3", "/input.png", "+page"], { width: 12, height: 12, x: 2, y: 3 }],
    [["-page", "+2+3", "/input.png"], { width: 5, height: 3, x: 2, y: 3 }],
  ] as const)(`${mode} saves page geometry without changing pixels: %j`, async (options, canvas) => {
    const input = await sharp({ create: { width: 5, height: 3, channels: 3, background: "red" } }).png().toBuffer();
    const files = new Map<string, Uint8Array>([["/input.png", input]]), fs = createMemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = [...options, "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([5, 3]);
    expect(output.virtualCanvas).toEqual(canvas);
    expect(output.data).toEqual(decodeImage(input).data);
  });
}

for (const retained of [false, true]) {
  it(`mogrify applies page settings before reading (retained=${retained})`, async () => {
    const input = await sharp({ create: { width: 5, height: 3, channels: 3, background: "red" } }).png().toBuffer();
    const files = new Map<string, Uint8Array>([["/input.png", input]]), filesystem = createMemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    expect(await runMagickCli(["mogrify", "-page", "12x12+2+3", "/input.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(retained ? await filesystem.readFile("/input.png") : files.get("/input.png")!);
    expect(output.virtualCanvas).toEqual({ width: 12, height: 12, x: 2, y: 3 });
    expect(output.data).toEqual(decodeImage(input).data);
  });
}
