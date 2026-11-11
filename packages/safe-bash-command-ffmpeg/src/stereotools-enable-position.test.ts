import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { parseFilterExpression } from "./filter-expression.js";

// Native FFmpeg 7.0.2: stereo PCM16 packets contain 512 sample pairs.
// Regrouped frames retain the byte position of their first input packet.
for (const [frames, prefix, enable, muteStart, muteEnd, trim] of [
  [16, "asetnsamples=n=4:p=0,", "eq(w,0)", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,", "eq(h,0)", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,", "eq(pos,0)", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,", "1", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,asendcmd=c='0 stereotools enable not(w)',", "0", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,asendcmd=c='0 stereotools enable not(h)',", "0", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,asendcmd=c='0 stereotools enable not(pos)',", "0", 0, 16, 0],
  [16, "asetnsamples=n=4:p=0,", "isnan(w)+isnan(h)", 0, 0, 0],
  [2300, "", "eq(pos,0)", 0, 512, 0],
  [2300, "", "gte(pos,2048)", 512, 2300, 0],
  [2300, "asetnsamples=n=4:p=0,", "eq(pos,0)", 0, 512, 0],
  [2300, "asetnsamples=n=4:p=0,", "gte(pos,2048)", 512, 2300, 0],
  [2300, "asetnsamples=n=300:p=0,", "eq(pos,0)", 0, 600, 0],
  [2300, "asetnsamples=n=300:p=0,", "gte(pos,2048)", 600, 2300, 0],
  [2300, "asetnsamples=n=4:p=0,atrim=start_sample=600,", "eq(pos,0)", 0, 0, 600],
  [2300, "asetnsamples=n=4:p=0,atrim=start_sample=600,", "gte(pos,2048)", 600, 2300, 600]
] as const) {
  for (const graph of [false, true]) it(`stereotools ${prefix}enable=${enable} (${graph ? "graph" : "simple"}) exposes native frame properties`, async () => {
    const fs = Volume.fromJSON({});
    const input = Buffer.alloc(frames * 4);
    for (let i = 0; i < frames * 2; i++) {
      const sample = i % 32;
      input.writeInt16LE(sample % 2 === 0 ? 1000 + sample * 231 : -300 - sample * 111, i * 2);
    }
    fs.writeFileSync("/in.raw", input);
    const filter = `${prefix}stereotools=mutel=1:enable='${enable}'`;
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expected = Buffer.from(input.subarray(trim * 4));
    for (let i = Math.max(trim, muteStart); i < muteEnd; i++) expected.writeInt16LE(0, (i - trim) * 4);
    assert.deepEqual(Buffer.concat(output), expected);
  });
}

for (const [expression, expected] of [["isnan(pos)", 1], ["not(pos)", 0], ["pos", NaN]] as const) {
  it(`stereotools enable ${expression} accepts unavailable packet positions`, () => {
    assert.equal(parseFilterExpression(expression, "stereotools enable", { n: 0, t: 0, w: 0, h: 0, pos: NaN }), expected);
  });
}
