import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  { length: 23 }, (_, i) => 1000 * (i + 1) * (-1) ** i / 32768)] });

// Complete PCM16 reference streams from native FFmpeg (issue cases: 7.0.2).
const bass = [1099, -2001, 3089, -4015, 5074, -6030, 7061, -8041, 9052, -10047, 11048, -12050, 13046, -14051, 15046, -16050, 17047, -18050, 19047, -20049, 21048, -22049, 23048];
const normalizedBass = [550, -1003, 1548, -2012, 2543, -3022, 3538, -4030, 4537, -5035, 5537, -6039, 6538, -7042, 7541, -8044, 8543, -9046, 9546, -10048, 10549, -11050, 11551];
for (const [filter, expected] of [
  ["bass=f=500:g=6", bass],
  ["bass=f=500:g=6:n=0", bass],
  ["bass=f=500:g=6:normalize=false", bass],
  ["bass=f=500:g=6:n=1", normalizedBass],
  ["bass=f=500:g=6:normalize=true", normalizedBass],
  ["lowpass=f=500:n=1", [29, 43, 46, 42, 34, 26, 18, 11, 6, 2, 0, -1, -2, -2, -1, -1, -1, 0, 0, 0, 0, 0, 0]]
,
  ["lowshelf=f=500:g=6:n=1", [562, -1016, 1553, -2027, 2549, -3035, 3547, -4040, 4547, -5044, 5549, -6047, 6550, -7050, 7552, -8053, 8555, -9055, 9557, -10058, 10559, -11060, 11561]],
  ["bass=f=500:g=-6:n=1:r=f64", [1815, -3955, 5847, -7907, 9868, -11877, 13872, -15860, 17865, -19851, 21854, -23844, 25842, -27836, 29832, -31827, 32767, -32768, 32767, -32768, 32767, -32768, 32767]],
  ["bass=f=500:g=6:p=1:n=1", [562, -1017, 1553, -2028, 2549, -3035, 3548, -4040, 4548, -5044, 5549, -6048, 6551, -7051, 7553, -8053, 8555, -9056, 9557, -10058, 10560, -11061, 11562]],
  ["treble=f=500:g=6:n=1:r=f64", [1815, -3955, 5847, -7907, 9868, -11877, 13872, -15860, 17865, -19851, 21854, -23844, 25842, -27836, 29832, -31827, 32767, -32768, 32767, -32768, 32767, -32768, 32767]],
  ["highshelf=f=500:g=6:normalize=true", [1778, -3897, 5822, -7857, 9830, -11838, 13826, -15825, 17818, -19815, 21809, -23805, 25800, -27795, 29791, -31786, 32767, -32768, 32767, -32768, 32767, -32768, 32767]],
  ["highpass=f=500:n=1", [757, -1927, 2819, -3878, 4854, -5855, 6867, -7849, 8869, -9850, 10865, -11854, 12862, -13857, 14860, -15859, 16859, -17859, 18858, -19859, 20858, -21859, 22859]],
  ["bandpass=f=500:n=1", [276, -183, 184, -224, 170, -225, 176, -217, 184, -209, 190, -205, 194, -202, 196, -200, 197, -199, 198, -199, 198, -199, 198]],
  ["lowpass=f=500:p=1:n=1", [324, -430, 683, -837, 1058, -1233, 1440, -1625, 1825, -2015, 2211, -2403, 2598, -2791, 2986, -3179, 3373, -3567, 3761, -3955, 4149, -4343, 4537]]
] as const) {
  for (const graph of [false, true]) it(`matches native normalization for ${filter} (graph=${graph})`, async () => {
    const { result, stderr, samples } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(samples, expected);
  });
}

for (const name of ["bass", "lowshelf", "treble", "highshelf", "lowpass", "highpass", "bandpass"]) {
  for (const option of ["n=2", "normalize=maybe"]) it(`rejects ${name}=${option} without overwriting output`, async () => {
    const { fs, result, stderr, samples } = await run(`${name}=${option}`, false, "/out.wav");
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes(`${name}: invalid normalize`), stderr);
    assert.deepEqual(samples, []);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph = false, output = "pipe:1") {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", bytes);
  let stderr = "";
  const chunks: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  const pcm = Buffer.concat(chunks);
  const samples = Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  return { fs, result, stderr, samples };
}
