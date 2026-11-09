import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI (also reported on 7.1.2-35)
// reads and rewrites the translated fixture's comment as "itle". We
// intentionally preserve the PNG text "hello", not the translation "Title".
it.each([
  ["translated keyword", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAFmlUWHRDb21tZW50AAAAAFRpdGxlAGhlbGxvBpZnzAAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg=="],
  ["no language or translation", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEWlUWHRDb21tZW50AAAAAABoZWxsb8br9CgAAAAMSURBVHicYxBUMgYAAK4AZxUeoV8AAAAASUVORK5CYII="],
  ["language only", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAE2lUWHRDb21tZW50AAAAZnIAAGhlbGxvGbOxYgAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg=="]
])("preserves the actual PNG iTXt comment with %s", async (_name, base64) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", Buffer.from(base64, "base64"));
  await fs.writeFile("/output.png", new TextEncoder().encode("keep"));
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(["/input.png", "/output.png"]).args,
    fs, cwd: "/", env: {}, stdin: (async function* () {})(),
    signal: new AbortController().signal,
    stdout: {write: async () => {}}, stderr: {write: async () => {}}
  });
  expect(result.exitCode).toBe(0);
  for (const path of ["/input.png", "/output.png"]) {
    const decoded = decodeImage(await fs.readFile(path));
    expect(decoded.properties?.Comment).toBe("hello");
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.decodeWarnings).toBeUndefined();
  }
});
