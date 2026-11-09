import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// AU headers carry a channel count, but no speaker layout.
for (const encoding of [1, 3, 6]) {
  for (const channels of [1, 2, 6]) {
    it(`does not infer an AU speaker layout for encoding ${encoding} and ${channels} channels`, async () => {
      const bytes = Buffer.alloc(32 + 192);
      [0x2e736e64, 32, 192, encoding, 8000, channels].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
      const args = ["-v", "error", "-show_entries", "stream=channels,channel_layout", "-of", "json"];
      const expected = [{ channels }];
      const stream = auAst().probe(bytes).streams[0]!;
      expect(stream.channels).toBe(channels);
      expect(stream.channel_layout).toBeUndefined();
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!).streams).toEqual(expected);

      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.au", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments([...args, "/in.au"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output).streams).toEqual(expected);
    });
  }
}
