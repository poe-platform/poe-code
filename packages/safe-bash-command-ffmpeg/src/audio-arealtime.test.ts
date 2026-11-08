import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, signal = new AbortController().signal) {
  const volume = Volume.fromJSON({});
  const samples = Float64Array.from({ length: 4000 }, (_, i) => (i % 8 - 4) / 32768);
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, volume, samples };
}

for (const [filter, elapsed] of [
  ["arealtime", 450],
  ["arealtime=speed=1000", 0.45],
  ["arealtime=2:2", 225],
  ["arealtime=limit=10ms", 0],
  ["asetpts=PTS+10/TB,arealtime", 450],
  ["asetpts=2*PTS,arealtime", 900]
] as const) {
  it(`paces ${filter} without changing PCM samples`, async (t) => {
    let now = 0;
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "setTimeout", (callback: () => void, delay = 0) => {
      now += delay;
      queueMicrotask(callback);
      return 0;
    });
    const result = await run(`asetnsamples=n=400:p=0,${filter}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(Math.abs(now - elapsed) < 0.00001, `waited ${now} ms; expected ${elapsed}`);
    const actual = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual), Array.from(result.samples));
  });
}

for (const option of ["speed=0", "speed=-1", "speed=NaN", "speed=Infinity", "speed=", "unknown=1", "limit=bad"]) {
  it(`rejects arealtime ${option} before writing output`, async () => {
    const result = await run(`arealtime=${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.existsSync("/out.wav"), false);
  });
}

it("cancels an arealtime wait without writing output", async (t) => {
  const controller = new AbortController();
  const reason = new Error("cancel pacing");
  t.mock.method(globalThis, "setTimeout", (callback: () => void, delay = 0) => {
    queueMicrotask(() => delay > 0 ? controller.abort(reason) : callback());
    return 0;
  });
  await assert.rejects(run("asetnsamples=n=400:p=0,arealtime", controller.signal), reason);
});
