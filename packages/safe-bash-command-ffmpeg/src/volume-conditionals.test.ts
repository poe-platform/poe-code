import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output at each 512-sample WAV frame boundary.
for (const [expression, expected] of [
  ["if(n,0.5)", [0, 6000, 6000, 6000, 6000, 6000, 6000, 6000]],
  ["ifnot(n,0.5)", [6000, 0, 0, 0, 0, 0, 0, 0]],
  ["ifnot(n,0,1)", [0, 12000, 12000, 12000, 12000, 12000, 12000, 12000]],
  ["if(n,0.25,1)", [12000, 3000, 3000, 3000, 3000, 3000, 3000, 3000]],
  ["0.5", [6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000]]
] as const) {
  it(`matches native conditional volume for ${expression}`, async () => {
    const { result, fs, stderr } = await run(expression);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 8192);
    for (let i = 0; i < 4096; i++) {
      assert.equal(output.readInt16LE(i * 2), expected[Math.floor(i / 512)], `sample ${i}`);
    }
  });
}

for (const expression of ["if(n)", "ifnot(n)", "if(n,0.5,1,2)", "ifnot(n,0.5,1,2)", "if(n,)", "ifnot(n,)", "if(n,0.5,)", "ifnot(n,0.5,)", "if(n,unknown)", "ifnot(n,unknown)"]) {
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
