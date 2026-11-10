import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 full-output references for mixed options and named controls.
for (const complex of [false, true]) {
  for (const [options, sha256] of [
    ["delay=1:feedback=0.5:crossfeed=0.2:0.1", "b0c727154702b8479eb214fb9c5357777e9ebb22bb27c250fb8d2b0264adaae6"],
    ["delay=1:feedback=0.1:crossfeed=0.2", "b0c727154702b8479eb214fb9c5357777e9ebb22bb27c250fb8d2b0264adaae6"],
    ["feedback=0.5:drymix=1:5", "c920cd8726f85a92377df57fd3b343b7750e4b5a22938d8642758859f87433ce"],
    ["feedback=0.5:drymix=1:delay=5", "c920cd8726f85a92377df57fd3b343b7750e4b5a22938d8642758859f87433ce"]
  ] as const) {
    it(`binds stereowiden=${options} like native (${complex ? "graph" : "simple"})`, async () => {
      const channels = [new Float64Array(48), new Float64Array(48)];
      for (let i = 0; i < 48; i++) {
        channels[0]![i] = (i % 8 === 0 ? 10000 : 100) / 32768;
        channels[1]![i] = (i % 8 === 4 ? -8000 : -200) / 32768;
      }
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
      const filter = `stereowiden=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      assert.equal(output.length, 192);
      assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
    });
  }
}
