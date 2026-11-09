import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [filter, applied] of [
  ["extrastereo=m=0", [4000, 4000]],
  ["stereotools=muter=1", [12000, 0]]
] as const) {
  for (const complex of [false, true]) {
    for (const enable of [undefined, "0", "n", "gte(t,0.064)", "lt(n,1)", "invalid"]) {
      it(`${filter} enable=${enable} (${complex ? "graph" : "simple"}) uses audio frames`, async () => {
        const volume = Volume.fromJSON({ "/out.wav": "existing" });
        volume.writeFileSync("/in.wav", encodeWav({
          sampleRate: 8000,
          channels: [12000, -4000].map(value => new Float64Array(1536).fill(value / 32768))
        }));
        const expression = filter + (enable === undefined ? "" : `:enable='${enable}'`);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${expression}[s]`, "-map", "[s]"] : ["-af", expression]),
            "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (enable === "invalid") {
          assert.equal(result.exitCode, 1);
          assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channelData[0]!.length, 1536);
        for (let i = 0; i < 1536; i++) {
          const enabled = enable === undefined || (enable === "lt(n,1)" ? i < 512 : enable !== "0" && i >= 512);
          assert.deepEqual(audio.channelData.map(channel => channel[i]! * 32768),
            enabled ? applied : [12000, -4000], `sample pair ${i}`);
        }
      });
    }
  }
}
