import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const reverse of [false, true]) {
  for (const filter of ["amerge", "amerge=2", "amerge=inputs=2", "amerge=inputs=2,volume=0.5"]) {
    it(`${filter} preserves every mono input sample (reversed=${reverse})`, async () => {
      const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
      const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
      const volume = Volume.fromJSON({});
      for (const [name, samples] of [["a", a], ["b", b]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      }
      const result = await run(volume, ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}${filter}[mix]`,
        "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const wav = volume.readFileSync("/out.wav") as Buffer;
      assert.equal(wav.readUInt16LE(wav.indexOf("fmt ") + 8), 1);
      const audio = parseWav(wav).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => channel.length), [4096, 4096]);
      const expected = reverse ? [b, a] : [a, b];
      const gain = filter.includes("volume") ? 0.5 : 1;
      for (let i = 0; i < 4096; i++) {
        assert.deepEqual(audio.channelData.map(channel => Math.round(channel[i]! * 32768)),
          expected.map(channel => channel[i]! * gain), `frame ${i}`);
      }
    });
  }
}

for (const graph of ["[0:a]amerge=inputs=2[out]", "[0:a][1:a]amerge=inputs=3[out]",
  "[0:a][1:a]amerge=inputs=0[out]", "[0:a][1:a]amerge=unknown=2[out]",
  "[0:a]volume=0.5[a];[a][1:a]amerge[out]"]) {
  it(`rejects unsupported merge without overwriting output: ${graph}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "keep" });
    for (const name of ["a", "b"]) volume.writeFileSync(`/${name}.wav`,
      encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25, 0.5])] }));
    const result = await run(volume, ["-y", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", graph, "-map", "[out]", "/out.wav"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
  });
}

async function run(volume: Volume, args: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
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
