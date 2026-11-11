import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports linear only for QOI colorspace 1, for RGB and RGBA.
for (const filename of ["/input.qoi", "/input.bin", "-"]) {
  for (const channels of [3, 4]) {
    it.each([0, 1])(`reports QOI transfer metadata for ${channels} channels from ${filename}, colorspace %i`, async colorspace => {
      const bytes = Buffer.from("716f696600000001000000010301fe8040200000000000000001", "hex");
      bytes[12] = channels;
      bytes[13] = colorspace;
      const fs = new MemoryFileSystem();
      if (filename !== "-") await fs.writeFile(filename, bytes);
      const args = ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,color_transfer", "-of", "json", filename];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (filename === "-") yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output).streams).toEqual([{
        codec_name: "qoi",
        pix_fmt: channels === 4 ? "rgba" : "rgb24",
        ...(colorspace === 1 ? { color_transfer: "linear" } : {})
      }]);
      expect(evalSyncFfprobe(filename === "-" ? bytes : undefined, args, () => bytes)).toBe(output);
    });
  }
}
