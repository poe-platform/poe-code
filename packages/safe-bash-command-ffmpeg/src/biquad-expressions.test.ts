import assert from "node:assert/strict";
import { it } from "node:test";
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { passAudio } from "./audio-pass.js";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [12000, -1000, 0, 0, 1000, 2000, -5000, 9000, 0, -12000, 15000, 0];
// FFmpeg 7.0.2, signed 16-bit PCM at 8000 Hz, mono.
for (const [filter, expected] of [
  ...["lowpass=f=500", "lowpass=f=250*2", "lowpass=frequency=250*2", "lowpass=250*2"].map(filter =>
    [filter, [359, 1211, 1855, 1972, 1833, 1653, 1352, 1047, 1136, 961, 475, 679]] as const),
  ...["bandpass=f=800:t=q:w=0.5", "bandpass=f=800:t=q:w=1/2", "bandpass=f=800:t=q:width=1/2"].map(filter =>
    [filter, [4442, 4156, -1359, -2094, -1411, -153, -2011, 581, 2965, -4902, -213, 5497]] as const),
  ...["bass=f=300:g=6", "bass=f=300:g=3+3", "bass=f=300:gain=3+3"].map(filter =>
    [filter, [12708, 366, 1295, 1239, 2213, 3287, -4003, 10103, 1510, -11319, 15709, 1467]] as const),
  ...["lowpass=f=0-1", "lowpass=f=1000000+1", "bandpass=w=0-1", "bandpass=w=100000+1",
    "bass=g=900+1", "bass=g=-900-1", "lowpass=f=1/0", "bandpass=w=0/0", "bass=g=3+",
    "lowpass=f=unknown", "lowpass=f=0b10", "bandpass=w=0o1"].map(filter => [filter, null] as const)
] as const) for (const graph of [false, true]) {
  it(`matches native ${filter} status and destination (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
    const output = expected === null ? Buffer.from("KEEP") : Buffer.alloc(expected.length * 2);
    expected?.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
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
    if (expected === null) assert.notEqual(result.exitCode, 0, stderr);
    else { assert.equal(result.exitCode, 0, stderr); assert.equal(stderr, ""); }
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}


// All filters using the shared parser keep their own native coefficient curves.
for (const name of ["highpass", "lowpass", "bandpass", "bass", "lowshelf", "treble", "highshelf"]) {
  it(`evaluates numeric options for ${name}`, async () => {
    const channels = [Float64Array.from(samples, value => value / 32768)];
    const gain = ["bass", "lowshelf", "treble", "highshelf"].includes(name);
    const literal = await passAudio(channels, 8000,
      `${name}=frequency=500:width=0.5${gain ? ":gain=6" : ""}`, "s16", new MediaBudgetTracker());
    const expression = await passAudio(channels, 8000,
      `${name}=frequency=250*2:width=1/2${gain ? ":gain=3+3" : ""}`, "s16", new MediaBudgetTracker());
    assert.deepEqual(expression, literal);
  });
}
