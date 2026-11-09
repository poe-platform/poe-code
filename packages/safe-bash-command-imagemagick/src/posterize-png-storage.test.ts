import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: rgba.png -posterize 2 out.png; decoded with -depth 8 rgba:-.
const source = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NDQ6NTArMDA6MDD8O7+tAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjQ0OjUwKzAwOjAwjWYHEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo0NDo1MCswMDowMNpzJs4AAAAsSURBVAjXY/TaeolX2jgaK2Zkl/LPwCl5pP7MYZySjU885XBK2nkeq8QlCQDNJB50rUa03gAAAABJRU5ErkJggg==", "base64");
const expected = Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAAP8AAAD/AAAA/wAAAP8AAP///wAA////AP8AAP//AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA//8A//8=", "base64");

for (const mode of ["public", "memory", "sync"] as const) {
  it.each([false, true])(`preserves posterized RGBA pixels and PNG storage, mode=${mode}, PNG32=%s`, async explicit => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/rgba.png", source);
    const files = new Map([["/rgba.png", source as Uint8Array]]);
    const args = ["/rgba.png", "-posterize", "2", `${explicit ? "PNG32:" : ""}/out.png`];
    const result = mode === "public" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
    expect(result.exitCode).toBe(0);
    const output = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual(Array.from(expected));
    expect(Array.from(output.slice(24, 26))).toEqual(explicit ? [8, 6] : [4, 3]);
  });
}
