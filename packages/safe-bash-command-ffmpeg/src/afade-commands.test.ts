import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [filter, changes] of [
    ["afade@intro=ns=4", []],
    ["asendcmd=c='0.256 afade@intro unity 0.25',afade@intro=ns=4", [[2048, 4000]]],
    ["asendcmd=c='0.257 afade@intro unity 0.25',afade@intro=ns=4", [[2560, 4000]]],
    ["asendcmd=c='0.256 afade@other unity 0.25',afade@intro=ns=4", []],
    ["asendcmd=c='0.256 afade unity 0.25',afade@intro=ns=4,afade@other=ns=1", [[2048, 4000]]],
    ["asendcmd=c='0.256 afade@intro unity 0.25',afade@other=ns=1,afade@intro=ns=4", [[2048, 4000]]],
    ["asendcmd=commands='0 [enter] afade@intro unity 1/2;0.256 afade@intro unity 1/4;0.512 afade@intro unity 1',afade@intro=ns=4", [[0, 8000], [2048, 4000], [4096, 16000]]],
    ["asendcmd=c='0.256 afade@intro unity 0.25;0.384 afade@intro unity invalid;0.512 afade@intro unity 2;0.64 afade@intro unity -1;0.768 afade@intro unity 0',afade@intro=ns=4", [[2048, 4000], [6144, 0]]],
    ["asetnsamples=200:p=0,asendcmd=c='0.256 afade@intro unity 0.25',afade@intro=ns=4", [[2200, 4000]]],
    ["asetpts=PTS+8000,asendcmd=c='1.256 afade@intro unity 0.25',afade@intro=ss=8000:ns=4", [[2048, 4000]]],
    ["asendcmd=c='0.256 afade@intro unity 0.25;0.512 volume@v volume 0.5',afade@intro=ns=4,volume@v=1", [[2048, 4000], [4096, 2000]]],
    ["asendcmd=c='0.256 afade@intro unity 0.25',afade@intro=ns=4:enable=lt(t\\,0.128)+gte(t\\,0.512)", [[4096, 4000]]]
  ] as const) {
    it(`scheduled afade unity: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(8192).fill(16000 / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.s16"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.s16") as Buffer;
      assert.equal(output.length, 8192 * 2);
      let gain = 16000;
      for (let i = 0; i < 8192; i++) {
        for (const [sample, value] of changes) if (i === sample) gain = value;
        assert.equal(output.readInt16LE(i * 2), gain * Math.min(1, i / 4), `sample ${i}`);
      }
    });
  }
}
