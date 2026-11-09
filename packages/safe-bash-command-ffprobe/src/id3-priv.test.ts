import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import fixtures from "./fixtures/id3-priv.json" with { type: "json" };

// Native FFmpeg fixtures contain real PRIV frames, not TXXX text tags.
const privateTags = {
  "id3v2_priv.com.example.take": "A\\x00\\x01\\x5c\\x7f\\x80\\xffZ",
  "id3v2_priv.com.example.mic": "left"
};
for (const [name, hex] of Object.entries(fixtures)) {
  for (const stdin of [false, true]) {
    it(`reads native PRIV format tags from ${name}, stdin=${stdin}`, async () => {
      const bytes = Buffer.from(hex, "hex"), fs = new MemoryFileSystem();
      await fs.writeFile("/" + name, bytes);
      const args = ["-v", "error",
        "-show_format", "-of", "json", stdin ? "-" : "/" + name];
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      for (const text of [output, evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!]) {
        const tags = JSON.parse(text).format.tags ?? {};
        if (name.startsWith("private")) {
          expect(tags).toMatchObject({ title: "Recording", ...privateTags });
        } else {
          expect(Object.keys(tags).filter(key => key.startsWith("id3v2_priv."))).toEqual([]);
        }
      }
    });
  }
}
