import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Indexed PNG: red, green, blue, yellow, in that palette and pixel order.
const indexedPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64"));
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { operations: ["-negate", "-cycle", "1"], expected: [255, 0, 255, 255, 255, 255, 0, 255, 0, 0, 255, 255, 0, 255, 255, 255] },
    { operations: ["-cycle", "1", "-negate"], expected: [255, 0, 255, 255, 255, 255, 0, 255, 0, 0, 255, 255, 0, 255, 255, 255] },
    { operations: ["-negate", "-cycle", "1", "-negate", "-cycle", "-1"], expected: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255] },
    { operations: ["-channel", "R", "-negate", "-cycle", "1"], expected: [255, 255, 0, 255, 255, 0, 255, 255, 0, 255, 0, 255, 0, 0, 0, 255] },
    { operations: ["+negate", "-cycle", "1"], expected: [0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 0, 255] }
  ])(`preserves indexed PNG palette order through negation (${mode}): $operations`, async ({ operations, expected }) => {
    const input = Buffer.from(indexedPng);
    const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["in.png", ...operations, "out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(Array.from(input)).toEqual(Array.from(indexedPng));
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(expected);
  });
}

// Palette: translucent gray, red, unused gray, blue. Pixels: 0, 1, 0, 3.
// tRNS stores only the first alpha; all remaining entries are implicitly opaque.
const transparentPng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEUUFBT/AABQUFAAAP+RQFyWAAAAAXRSTlNANjqZ9gAAAA1JREFUeJxjYGBkYAYAAAsABfoWQbQAAAAASUVORK5CYII=", "base64"));
for (const retained of [false, true]) {
  it.each([
    { operations: ["-negate"], expected: [0, 255, 255, 255, 175, 175, 175, 255, 0, 255, 255, 255, 235, 235, 235, 64] },
    { operations: ["+negate"], expected: [255, 0, 0, 255, 175, 175, 175, 255, 255, 0, 0, 255, 235, 235, 235, 64] },
    { operations: ["-channel", "RGB", "-negate"], expected: [0, 255, 255, 255, 175, 175, 175, 255, 0, 255, 255, 255, 235, 235, 235, 64] },
    { operations: ["-channel", "A", "-negate"], expected: [255, 0, 0, 255, 80, 80, 80, 255, 255, 0, 0, 255, 20, 20, 20, 64] }
  ])(`negates unused palette colors while preserving implicit alpha (retained=${retained}): $operations`, async ({ operations, expected }) => {
    const files = new Map([["in.png", transparentPng]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", transparentPng);
    expect(await runConvertCli(["in.png", ...operations, "-cycle", "1", "PNG32:out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(expected);
  });

  it(`negates GIF palette colors and transparency before cycling (retained=${retained})`, async () => {
    const opaque = Uint8Array.from(Buffer.from("R0lGODdhCQALAIEAABEhMf8AAADIAAAA3CwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBADs=", "base64"));
    const input = new Uint8Array(opaque.length + 8);
    input.set(opaque.subarray(0, 25));
    input.set([33, 249, 4, 1, 0, 0, 1, 0], 25);
    input.set(opaque.subarray(25), 33);
    const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    expect(await runConvertCli(["in.gif", "-negate", "-cycle", "1", "PNG32:out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data.subarray(0, 16))).toEqual([0, 255, 255, 255, 255, 55, 255, 0, 255, 255, 35, 0, 238, 222, 206, 0]);
  });
}

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves colormap alpha during negation.
const cycleAlphaPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAABHRSTlMowP+AOSYJWQAAAA1JREFUeJxjYGBkYgYAAA8AB4SOmW0AAAAASUVORK5CYII=", "base64");
const cycleOpaquePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64");
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { input: cycleAlphaPng, operations: ["-negate", "-cycle", "1"], expected: "cb33acc0dfac15ff0432df800ff5de28" },
    { input: cycleAlphaPng, operations: ["-negate", "-cycle", "1", "-cycle", "-1"], expected: "0ff5de28cb33acc0dfac15ff0432df80" },
    { input: cycleAlphaPng, operations: ["-negate"], expected: "0ff5ded7cb33ac3fdfac15000432df7f" },
    { input: cycleOpaquePng, operations: ["-negate", "-cycle", "1"], expected: "cb33acffdfac15ff0432dfff0ff5deff" },
  ])(`uses original palette alpha after negation and cycling (${mode}): $operations $expected`, async ({ input, operations, expected }) => {
    const files = new Map<string, Uint8Array>([["in.png", input], ["out", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    await filesystem.writeFile("/out", Buffer.from("KEEP"));
    const args = ["in.png", ...operations, "-depth", "8", "rgba:out"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
