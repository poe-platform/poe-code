import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI (also reported on 7.1.2-35)
// rewrites Latin-1 tEXt as iTXt with the original e9 byte, invalid UTF-8.
// Keep valid UTF-8 c3 a9 deliberately: this is an encoding difference,
// not character loss. Native ASCII comment bytes agree (it uses tEXt).
it.each([
  {
    name: "Latin-1",
    png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADHRFWHRDb21tZW50AGNhZukkreX+AAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC",
    comment: "café", hex: "636166c3a9"
  },
  {
    name: "ASCII",
    png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADXRFWHRDb21tZW50AGhlbGxv5v+uJAAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==",
    comment: "hello", hex: "68656c6c6f"
  }
])("rewrites $name PNG comments as valid UTF-8 through the public command", async ({ png, comment, hex }) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", Buffer.from(png, "base64"));
  const command = createMagickCommand();
  for (const [input, output] of [["/input.png", "/output.png"], ["/output.png", "/rewritten.png"]] as const) {
    await fs.writeFile(output, new TextEncoder().encode("keep"));
    let stderr = "";
    const result = await command.execute({
      command: "magick", args: createCommandArguments([input, output]).args,
      fs, cwd: "/", env: {}, stdin: (async function* () {})(),
      signal: new AbortController().signal,
      stdout: { write: async () => {} },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const bytes = await fs.readFile(output);
    const decoded = decodeImage(bytes);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.properties?.Comment).toBe(comment);
    expect(decoded.decodeWarnings).toBeUndefined();
    const comments: Uint8Array[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)) === "iTXt") {
        const payload = bytes.subarray(offset + 8, offset + 8 + length);
        if (new TextDecoder().decode(payload.subarray(0, 7)) === "Comment") {
          expect(Array.from(payload.subarray(7, 12))).toEqual([0, 0, 0, 0, 0]);
          comments.push(payload.subarray(12));
        }
      }
      offset += length + 12;
    }
    expect(comments).toHaveLength(1);
    expect(Buffer.from(comments[0]!).toString("hex")).toBe(hex);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(comments[0])).toBe(comment);
  }
});
