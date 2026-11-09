import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  return Volume.fromJSON({ "/ramp.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, frame) => frame / 32768)] })) });
}

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_list", "/list.csv", ...options, "/part%02d.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

for (const codec of ["copy", "pcm_s16le"]) {
  for (const mode of [undefined, "1", "0"]) {
    it(`writes segmented WAV headers with ${codec}, individual_header_trailer=${mode ?? "default"}`, async () => {
      const volume = source();
      const result = await run(volume, ["-c:a", codec, ...(mode === undefined ? [] : ["-individual_header_trailer", mode])]);
      assert.equal(result.exitCode, 0, result.stderr);
      const first = volume.readFileSync("/part00.wav") as Buffer;
      const second = volume.readFileSync("/part01.wav") as Buffer;
      assert.equal(first.toString("ascii", 0, 4), "RIFF");
      const firstPcm = parseWav(first).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(firstPcm.length, 16384);
      const secondPcm = mode === "0"
        ? Array.from({ length: second.length / 2 }, (_, index) => second.readInt16LE(index * 2) / 32768)
        : Array.from(parseWav(second).tracks[0]!.decodedAudio!.channelData[0]!);
      if (mode === "0") assert.equal(second.readInt16LE(0), 16384);
      else assert.equal(second.toString("ascii", 0, 4), "RIFF");
      assert.deepEqual([...firstPcm, ...secondPcm], Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer)
        .tracks[0]!.decodedAudio!.channelData[0]!));
      assert.equal(volume.readFileSync("/list.csv", "utf8"),
        "part00.wav,0.000000,2.048000\npart01.wav,2.048000,3.000000\n");
    });
  }

}

it("rejects invalid individual_header_trailer before overwriting output", async () => {
  const volume = source();
  volume.writeFileSync("/part00.wav", "keep");
  const before = volume.toJSON();
  const result = await run(volume, ["-individual_header_trailer", "invalid"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
});
