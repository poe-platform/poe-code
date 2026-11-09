import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [encoding, codec, bits, sampleFormat] of [
  [1, "pcm_mulaw", 8, "s16"], [27, "pcm_alaw", 8, "s16"], [2, "pcm_s8", 8, "u8"],
  [3, "pcm_s16be", 16, "s16"], [6, "pcm_f32be", 32, "flt"]
] as const) {
  it(`reports decoded stream and frame formats for AU encoding ${encoding}`, async () => {
    const bytes = Buffer.alloc(32 + 97 * 2 * bits / 8);
    [0x2e736e64, 32, bytes.length - 32, encoding, 8000, 2]
      .forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    const expected = {
      streams: [{ codec_name: codec, sample_fmt: sampleFormat, bits_per_sample: bits }],
      frames: [{ sample_fmt: sampleFormat, nb_samples: 97 }]
    };
    const args = ["-v", "error", "-show_entries",
      "stream=codec_name,sample_fmt,bits_per_sample:frame=sample_fmt,nb_samples", "-of", "json"];
    expect(auAst().probe(bytes, { showFrames: true })).toMatchObject(expected);
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    for (const input of ["/in.au", "pipe:0"]) {
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments([...args, input]), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (input === "pipe:0") yield bytes; })(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output)).toMatchObject(expected);
    }
  });
}
