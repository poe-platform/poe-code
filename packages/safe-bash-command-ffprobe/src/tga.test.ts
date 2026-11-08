import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const type of [2, 10]) {
  for (const top of [false, true]) {
    it.each([24, 32])(`probes type ${type}, top origin ${top}, %i-bit Targa headers`, async depth => {
      const stride = depth / 8;
      const bytes = new Uint8Array(18 + (type === 10 ? 1 + stride : 36 * stride));
      const header = new DataView(bytes.buffer);
      bytes[2] = type;
      header.setUint16(12, 12, true);
      header.setUint16(14, 3, true);
      bytes[16] = depth;
      bytes[17] = (top ? 32 : 0) | (depth === 32 ? 8 : 0);
      if (type === 10) bytes[18] = 128 | 35;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.tga", bytes);
      const args = ["-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", "/input.tga"];
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      const expected = { streams: [{ codec_name: "targa", width: 12, height: 3, pix_fmt: depth === 32 ? "bgra" : "bgr24" }] };
      expect(JSON.parse(output)).toMatchObject(expected);
      expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)).toMatchObject(expected);
    });
  }
}
