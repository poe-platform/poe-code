import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [100, 200, 300, 400, 500, 600];
const right = [-1100, -1200, -1300, -1400];

// Native FFmpeg 7 integer AVOptions validate each assignment, then round ties to even.
for (const options of ["2", "inputs=2", "inputs=1+1", "inputs=1.5", "inputs=2.5",
  "inputs=0x2", "inputs=2e0", "inputs=PI-1", "inputs=min+1", "inputs=max/32",
  "inputs=default", "inputs=PHI", "inputs=E-1", "inputs=sqrt(4)", "inputs=2 : inputs = 2",
  "inputs=2:inputs=2", "1:inputs=2", "3:inputs=2", "inputs=64:inputs=2", "inputs=2:"]) {
  it(`amerge accepts native input-count options: ${options}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "KEEP" });
    for (const [name, samples] of [["a", left], ["b", right]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    }
    const result = await run(volume, ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", `[0:a][1:a]amerge=${options}[out]`, "-map", "[out]",
      "-c:a", "pcm_s16le", "/out.wav"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelMask ?? 3, 3);
    assert.deepEqual(audio.channelData.map(samples => Array.from(samples, sample => Math.round(sample * 32768))),
      [left.slice(0, right.length), right]);
  });
}

for (const options of ["inputs=0b10", "inputs=0o2", "inputs=0", "inputs=0:inputs=2",
  "inputs=65:inputs=2", "inputs=0.9:inputs=2", "inputs=64.1:inputs=2",
  "inputs=0b10:inputs=2", "inputs=2:inputs=0", "inputs=", "inputs=1/0",
  "inputs=2:2", "2:2", "inputs=2::inputs=2", "inputs=2::", "unknown=2", "inputs=2.51"]) {
  it(`amerge rejects invalid input-count options without replacing output: ${options}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "KEEP" });
    for (const name of ["a", "b"]) volume.writeFileSync(`/${name}.wav`,
      encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25, 0.5])] }));
    const result = await run(volume, ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav",
      "-filter_complex", `[0:a][1:a]amerge=${options}[out]`, "-map", "[out]",
      "-c:a", "pcm_s16le", "/out.wav"]);
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
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
