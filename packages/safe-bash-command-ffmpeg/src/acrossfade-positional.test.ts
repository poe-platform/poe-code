import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 1000 mono PCM16 samples per input at 8000 Hz.
for (const [options, transition] of [
  ["ns=1", [0]],
  ["ns=4", [9000, 5000, 1000, -3000]],
  ["4:0:1:0", [9000, 5000, 1000, -3000]],
  ["ns=4:0:1:0:0", [9000, 5000, 1000, -3000]],
  ["4:overlap=1:1", [0]],
  ["4:o=1:1", [0]],
  ["4:0:overlap=1:2", [6000, -2000]],
  ["4:overlap=1:2:0:1:0:0", [6000, -2000]],
  ["4:overlap=1:2:curve1=tri:3", [8000, 2666, -2666]],
  ["4:0:1:0:curve1=tri:2", [6000, -2000]],
  ["4:0:1:0:0:overlap=1:2", [6000, -2000]],
  ["overlap=1:ns=4:2", [6000, -2000]],
  ["overlap=1:0.0005", [9000, 5000, 1000, -3000]],
  ["ns=4:d=0:o=1:0.00025", [6000, -2000]],
  ["4:overlap=1:0", null],
  ["4:overlap=1:2:0:1:0:0:1", null]
] as const) {
  it(`acrossfade follows native positional assignment for ${options}`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
    for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(1000).fill(value / 32768)] }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (transition === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("acrossfade:"), stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, value => Math.round(value * 32768)), [
      ...new Array(1000 - transition.length).fill(12000),
      ...transition,
      ...new Array(1000 - transition.length).fill(-4000)
    ]);
  });
}
