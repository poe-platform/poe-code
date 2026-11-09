import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [sampleRate, hop, length] of [[8000, 512, 4096], [50000, 512, 1025], [96000, 1024, 8192], [100000, 1024, 2051], [192000, 2048, 4099]] as const) {
  for (const complex of [false, true]) {
    it(`preserves dialogue hop boundaries at ${sampleRate} Hz (${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: sampleRate, channels: [new Float64Array(length), new Float64Array(length)] }));
      for (const selection of ["", ",aselect=not(n)", ",aselect=n"]) {
        let stderr = "";
        const chain = `asetpts=PTS+17,dialoguenhance,ashowinfo${selection}`;
        const filters = complex ? ["-filter_complex", `[0:a]${chain}[s]`, "-map", "[s]"] : ["-af", chain];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/in.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, 3);
        assert.equal(audio.sampleRate, sampleRate);
        assert.equal(audio.channelData[0]!.length, selection === "" ? length : selection === ",aselect=n" ? length - hop : hop);
        const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
        assert.equal(frames.length, Math.ceil(length / hop));
        for (const [n, frame] of frames.entries()) {
          assert.ok(frame.includes(`n:${n} pts:${17 + n * hop} `), frame);
          assert.ok(frame.includes(`nb_samples:${Math.min(hop, length - n * hop)} `), frame);
        }
      }
    });
  }
}
