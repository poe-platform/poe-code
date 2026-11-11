import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 32 }, (_, i) => i % 2 ? -300 - i * 111 : 1000 + i * 231);

// Stereo PCM16 at 8 kHz, with four samples per frame. Indices identify muted frames.
const cases: [string, readonly number[]][] = [
  ["asendcmd=c='0.0005 stereotools enable ld(0)',stereotools=mutel=1:enable=st(0\\,1)", [0]],
  ["asendcmd=c='0.0005 stereotools enable 0',stereotools=mutel=1", [0]],
  ["stereotools=mutel=1:enable=lt(n\\,1)", [0]],
  ["asendcmd=c='0.0006 stereotools enable 0',stereotools=mutel=1", [0, 1]],
  ["asendcmd=c='0.0005 stereotools enable 1',stereotools=mutel=1:enable=0", [1, 2, 3]],
  ["asendcmd=c='0.0005 stereotools enable 0;0.0015 stereotools enable 1',stereotools=mutel=1", [0, 3]],
  ["asendcmd=c=0.0005 stereotools enable not(n-2),stereotools=mutel=1", [0, 2]],
  ["asendcmd=c=0.0005 stereotools enable not(t-0.001),stereotools=mutel=1", [0, 2]],
  ["asendcmd=c='0.0005 stereotools enable invalid',stereotools=mutel=1:enable=lt(n\\,2)", [0, 1]],
  ["asendcmd=c='0.0005 stereotools enable 0;0.001 stereotools enable invalid',stereotools=mutel=1", [0]],
  ["asendcmd=c='0.0005 stereotools@mix enable 0',stereotools@mix=mutel=1", [0]],
  ["asendcmd=c='0.0005 stereotools@other enable 0',stereotools@mix=mutel=1", [0, 1, 2, 3]],
  ["asendcmd=c='0.0005 stereotools@mix enable 0',stereotools@other,stereotools@mix=mutel=1", [0]],
  ["asendcmd=c='0.0005 stereotools enable 0',stereotools@first,stereotools@second=mutel=1", [0, 1, 2, 3]],
  ["stereotools=mutel=1,asendcmd=c='0.0005 stereotools enable 0'", [0, 1]]
];

for (const [filter, mutedFrames] of cases) {
  for (const graph of [false, true]) {
    it(`stereotools runtime enable (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=n=4:p=0,${filter}`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        samples.map((sample, i) => i % 2 === 0 && mutedFrames.includes(Math.floor(i / 8)) ? 0 : sample));
    });
  }
}
