import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand } from "./index.js";

// Fixed 1×1 RGB PNGs with valid CRCs and empty language/translated-keyword fields.
// Native ImageMagick 7.1.2-35 Q16-HDRI (also reproduced with 7.1.2-31):
// `magick input.png output.png` succeeds and preserves RGB 112233 for both.
// `magick identify -format '%c' input.png` and output.png return an empty
// comment for compressed iTXt, but "hello" for the uncompressed control.
// Preserve valid metadata deliberately instead of copying that native omission.
const fixtures = [
  { name: "compressed", png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAGWlUWHRDb21tZW50AAEAAAB4nMtIzcnJBwAGLAIVEc+BoAAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==" },
  { name: "uncompressed", png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAEWlUWHRDb21tZW50AAAAAABoZWxsb8br9CgAAAAMSURBVHicYxBUMgYAAK4AZxUeoV8AAAAASUVORK5CYII=" }
];

it.each(fixtures)("retains valid $name iTXt comments through the public command", async ({ png }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", Buffer.from(png, "base64"));
  await fs.writeFile("/output.png", new TextEncoder().encode("keep"));
  const command = createMagickCommand();
  for (const [input, output] of [["/input.png", "/output.png"], ["/output.png", "/rewritten.png"]]) {
    let stderr = "";
    const result = await command.execute({
      command: "magick", args: createCommandArguments([input!, output!]).args,
      fs, cwd: "/", env: {}, stdin: (async function* () {})(),
      signal: new AbortController().signal,
      stdout: { write: async () => {} },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const decoded = decodeImage(await fs.readFile(output!));
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.properties?.Comment).toBe("hello");
  }
});
