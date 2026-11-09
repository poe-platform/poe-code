import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const copy of [true, false]) {
  for (const duration of [undefined, "1.25"]) {
    it(`reports the actual final packet end and preserves samples (${copy ? "copy" : "encode"}, ${duration ?? "full"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/audio.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/audio.wav", ...(copy ? ["-c", "copy"] : []),
          ...(duration === undefined ? [] : ["-t", duration]),
          "-f", "segment", "-segment_time", "1", "-segment_list", "/list.csv", "/part%02d.wav"],
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
      const names = volume.readdirSync("/").map(String).filter(name => name.startsWith("part"));
      const samples = names.map(name =>
        parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
      const lengths = duration === undefined ? [8192, 8192, 7616] : [8192, copy ? 2048 : 1808];
      assert.deepEqual(samples.map(channel => channel.length), lengths);
      assert.deepEqual(samples.flatMap(channel => Array.from(channel, value => value * 32768)),
        Array.from({ length: lengths.reduce((sum, length) => sum + length, 0) }, (_, i) => i));
      assert.equal(volume.readFileSync("/list.csv", "utf8"), duration === undefined
        ? "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"
        : `part00.wav,0.000000,1.024000\npart01.wav,1.024000,${copy ? "1.280000" : "1.250000"}\n`);
    });
  }
}
