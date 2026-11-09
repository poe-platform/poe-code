import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "command"] as const) {
  it.each([
    { comment: "hi", png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEXRFWHRDb21tZW50AGhpAGhpZGRlbkHNeV0AAAAMSURBVHicYxBUMgYAAK4AZxUeoV8AAAAASUVORK5CYII=" },
    { comment: "hello", png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADXRFWHRDb21tZW50AGhlbGxv5v+uJAAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==" }
  ])(`preserves only the PNG tEXt comment before a NUL (${mode}, $comment)`, async ({ comment, png }) => {
    const files = new Map([["/input.png", Buffer.from(png, "base64")], ["/output.png", Buffer.from("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/input.png", "/output.png"];
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/output.png")! : await fs.readFile("/output.png");
    expect(new TextDecoder().decode(output)).not.toContain("hidden");
    const decoded = decodeImage(output);
    expect(decoded.properties?.Comment).toBe(comment);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
  });
}
