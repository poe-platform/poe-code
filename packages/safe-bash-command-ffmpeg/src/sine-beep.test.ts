import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function render(spec: string): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "lavfi", "-i", spec, "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(errors).length, 0);
  return Buffer.concat(output);
}

// Native FFmpeg 7.0.2 PCM16 samples. The floating-point source allows a few
// quantization steps of difference from FFmpeg's integer sine lookup table.
for (const option of ["beep_factor=2", "b=2"]) {
  it(`mixes the sine source beep with ${option}`, async () => {
    const pcm = await render(`sine=r=8000:d=0.25:f=400:${option}`);
    assert.equal(pcm.length, 4000);
    const expected = [0, 6077, 10196, 11103, 8709, 4095, -917, -4477];
    for (const [i, sample] of expected.entries()) {
      assert.ok(Math.abs(pcm.readInt16LE(i * 2) - sample) <= 6, `sample ${i}`);
    }
    const plain = await render("sine=r=8000:d=0.25:f=400");
    assert.notDeepEqual(pcm.subarray(0, 640), plain.subarray(0, 640));
    assert.deepEqual(pcm.subarray(640), plain.subarray(640));
  });
}

for (const [rate, windows] of [
  [8000, [
    [317, [2425, 5800, 8097, 514, -883, -2178, -3218, -3882]],
    [7997, [-3510, -2595, -1378, 8044, 9135, 8055, 5258, 1595]],
    [8317, [11439, 11052, 8225, 514, -883, -2178, -3218, -3882]],
    [15997, [-3510, -2595, -1378, 3016, 254, -2377, -4022, -4125]]
  ]],
  [11027, [
    [438, [5071, 7118, 8370, 595, -422, -1413, -2317, -3078]],
    [11024, [-2783, -1957, -1009, 7995, 9101, 9030, 7860, 5821]],
    [11465, [11379, 10042, 7508, 595, -422, -1413, -2317, -3078]],
    [22051, [-2783, -1957, -1009, 3463, 1527, -544, -2390, -3697]]
  ]]
] as const) {
  it(`repeats a 40ms beep each second and pauses its phase between bursts at ${rate} Hz`, async () => {
    const pcm = await render(`sine=r=${rate}:d=2.05:f=437:b=1.5`);
    assert.equal(pcm.length, Math.round(rate * 2.05) * 2);
    for (const [start, samples] of windows) {
      for (const [offset, sample] of samples.entries()) {
        const actual = pcm.readInt16LE((start + offset) * 2);
        assert.ok(Math.abs(actual - sample) <= 6, `sample ${start + offset}: ${actual} vs ${sample}`);
      }
    }
    const plain = await render(`sine=r=${rate}:d=2.05:f=437`);
    for (let second = 0; second < 2; second++) {
      const start = (second * rate + Math.floor(rate / 25)) * 2;
      const end = (second + 1) * rate * 2;
      assert.deepEqual(pcm.subarray(start, end), plain.subarray(start, end));
    }
  });
}

it("keeps the default tone unchanged when either beep alias is zero", async () => {
  const plain = await render("sine=r=8000:d=0.25:f=400");
  for (const option of ["b=0", "beep_factor=0"]) {
    assert.deepEqual(await render(`sine=r=8000:d=0.25:f=400:${option}`), plain);
  }
});

it("keeps a zero-frequency sine silent when the beep is enabled", async () => {
  const pcm = await render("sine=r=8000:d=0.25:f=0:b=2");
  assert.equal(pcm.length, 4000);
  assert.ok(pcm.every(byte => byte === 0));
});
