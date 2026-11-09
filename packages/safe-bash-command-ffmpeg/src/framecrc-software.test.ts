import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const target of ["-", "/out.txt"]) {
  for (const codec of ["copy", "pcm_s16le"]) {
    for (const flags of [[], ["-bitexact"], ["-fflags", "bitexact"], ["-fflags", "+bitexact"]]) {
      it(`writes the framecrc software header unless bitexact: ${codec}, ${target}, ${JSON.stringify(flags)}`, async () => {
        const volume = Volume.fromJSON({
          "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(1200)] }))
        });
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...flags, "-c:a", codec, "-f", "framecrc", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "-" ? stdout : volume.readFileSync(target, "utf8");
        // Match the Lavf version already emulated by the WAV and FFmetadata muxers.
        assert.equal(output, (flags.length ? "" : "#software: Lavf61.7.100\n") + `#tb 0: 1/8000
#media_type 0: audio
#codec_id 0: pcm_s16le
#sample_rate 0: 8000
#channel_layout_name 0: mono
0,          0,          0,      512,     1024, 0x00000000
0,        512,        512,      512,     1024, 0x00000000
0,       1024,       1024,      176,      352, 0x00000000
`);
      });
    }
  }
}
