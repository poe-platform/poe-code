import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM16 gains for hexadecimal integer expressions and the decimal control.
for (const [expression, expected] of [
  ["0x01", 12000],
  ["0x2/4", 6000],
  ["0.5", 6000],
  ["0Xf/0x1E", 6000],
  ["-0x2/4", -6000],
  ["0x0", 0],
  ["(0xA+0xa)/40", 6000]
] as const) {
  it(`applies volume gain curve for ${expression}`, async () => {
    const { result, fs, stderr } = await run(expression);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 8192);
    for (let i = 0; i < 4096; i++) {
      assert.equal(output.readInt16LE(i * 2), expected, `sample ${i}`);
    }
  });
}

for (const expression of ["0x", "0X", "0xg", "0x1g", "0x1.8p1"]) {
  it(`rejects ${expression} without overwriting output`, async () => {
    const { result, fs } = await run(expression);
    assert.equal(result.exitCode, 234);
    assert.equal(fs.readFileSync("/out.raw", "utf8"), "keep");
  });
}

async function run(expression: string) {
  const fs = Volume.fromJSON({ "/out.raw": "keep" });
  fs.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096).fill(12000 / 32768)] }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/tone.wav", "-af", `volume='${expression}':eval=frame`, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, stderr: Buffer.concat(errors).toString() };
}
