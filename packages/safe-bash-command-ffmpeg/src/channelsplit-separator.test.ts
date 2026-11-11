import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const options of ["stereo:FR", "channels=FR", "channel_layout=stereo:channels=FR"]) {
  for (const suffix of ["", ":", "::"]) {
    for (const complex of [false, true]) {
      it(`channelsplit separators: ${options}${suffix} (${complex ? "complex" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [1000, 2000].map(sample => Float64Array.of(sample / 32768, -sample / 32768)) }));
        const filter = `channelsplit=${options}${suffix}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, suffix === "::" ? 234 : 0, stderr);
        assert.equal(volume.readFileSync("/out.raw").toString("hex"), suffix === "::" ? "4b454550" : "d00730f8");
      });
    }
  }
}
