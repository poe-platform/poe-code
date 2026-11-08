import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe results for 15 bytes of aligned ADPCM codewords.
for (const [encoding, codec, frames] of [
  [23, "adpcm_g726le", 30], [24, "adpcm_g722", 30],
  [25, "adpcm_g726le", 40], [26, "adpcm_g726le", 24]
] as const) {
  for (const size of [15, 30]) {
    it(`probes AU encoding ${encoding} with declared size ${size}`, async () => {
      const bytes = Buffer.from("2e736e64000000200000000f0000000300001f4000000001000000000000000012345678abcdef0112345678abcdef", "hex");
      bytes.writeUInt32BE(encoding, 12);
      bytes.writeUInt32BE(size, 8);
      const duration = frames * size / 15;
      const expected = { programs: [], stream_groups: [], streams: [{ codec_name: codec, duration_ts: duration }] };
      const args = ["-v", "error", "-show_entries", "stream=codec_name,duration_ts", "-of", "json"];
      expect(auAst().parse(bytes, { decodeAudio: false }).tracks[0]!.decodedAudio).toBeUndefined();
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toEqual(expected);
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
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}
