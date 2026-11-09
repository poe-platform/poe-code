import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7: 7x5 white canvas, red fill, default antialiasing.
for (const mode of ["command", "map"] as const) {
  it.each([
    "polygon 1,1 3,1 3,3",
    "polygon 3,3 3,1 1,1",
    "path 'M 1,1 L 3,1 3,3 Z'",
  ])(`${mode}: includes polygon boundaries and diagonal coverage: %s`, async draw => {
    const fs = new MemoryFileSystem();
    const keep = new TextEncoder().encode("keep");
    const files = new Map([["/out.png", keep]]);
    await fs.writeFile("/out.png", keep);
    const args = ["-size", "7x5", "xc:white", "-fill", "red", "-draw", draw, "/out.png"];
    const result = mode === "map" ? await runConvertCli(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    const expected = Array.from({ length: 35 }, (_, index) => {
      const x = index % 7, y = Math.floor(index / 7);
      const green = y >= 1 && y <= 3 && x >= y && x <= 3 ? 0
        : (x === 1 && y === 2) || (x === 2 && y === 3) ? 233 : 255;
      return [255, green, green, 255];
    }).flat();
    expect(Array.from(output.data)).toEqual(expected);
  });
}

it("preserves the destination when a polygon is incomplete", async () => {
  const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("keep");
  await fs.writeFile("/out.png", keep);
  const result = await createMagickCommand().execute({
    command: "magick",
    args: createCommandArguments(["-size", "7x5", "xc:white", "-fill", "red", "-draw", "polygon 1,1 3,1", "/out.png"]).args,
    cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  });
  expect(result.exitCode).not.toBe(0);
  expect(await fs.readFile("/out.png")).toEqual(keep);
});
