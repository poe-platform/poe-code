import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "retained", "command"] as const) {
  // ImageMagick 7 Difference blends RGB by opacity and subtracts alpha only
  // when the destination has alpha; transparent source pixels leave it intact.
  it.each([
    { base: [20, 40, 80], overlay: [29, 51, 103, 0], expected: [20, 40, 80, 255] },
    { base: [51, 87, 141], overlay: [84, 66, 76, 64], expected: [46, 70, 122, 255] },
    { base: [51, 87, 141], overlay: [84, 66, 76, 255], expected: [33, 21, 65, 255] },
    { base: [51, 87, 141, 128], overlay: [84, 66, 76, 0], expected: [51, 87, 141, 128] },
    { base: [51, 87, 141, 255], overlay: [84, 66, 76, 64], expected: [46, 70, 122, 191] },
  ])(`${mode}: Difference $base with $overlay matches native RGBA`, async ({ base, overlay, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = createMemoryFileSystem();
    for (const [path, pixels] of [["/base.png", base], ["/overlay.png", overlay]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: pixels.length as 3 | 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["/base.png", "/overlay.png", "-compose", "Difference", "-composite", "/out.png"];
    const result = mode === "command"
      ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect(Array.from(output.data)).toEqual(expected);
    expect(output.hasAlpha).toBe(base.length === 4);
  });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
for (const mode of ["command", "map", "retained", "sync"] as const) {
  for (const depth of [8, 16]) {
    it.each([
      { compose: "Difference", alpha: "80", expected: "183858ff" },
      { compose: "Difference", alpha: "ff", expected: "101080ff" },
      { compose: "Difference", alpha: "00", expected: "206030ff" },
      { compose: "Multiply", alpha: "80", expected: "134529ff" }
    ])(`${mode}: ${depth}-bit $compose with source alpha $alpha matches native RGBA`, async ({ compose, alpha, expected }) => {
      const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
      const fs = createMemoryFileSystem();
      await fs.writeFile("/out", files.get("/out")!);
      const base = depth === 8 ? "#206030" : "#202060603030";
      const overlay = depth === 8 ? `#3070b0${alpha}` : `#30307070b0b0${alpha}${alpha}`;
      const argv = [`xc:${base}`, `xc:${overlay}`, "-background", "#206030", "-compose", compose,
        "-composite", "-depth", "8", "rgba:/out"];
      const args = createCommandArguments(argv);
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
      }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
      expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
  }
}
