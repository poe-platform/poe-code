import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/stereowiden-commands.wav", import.meta.url));

for (const graph of [false, true]) {
  // Complete nonzero PCM16 samples from native FFmpeg 7.0.2 with the same WAV.
  for (const [filter, impulses] of [
    ["asendcmd=c='0.064 stereowiden@x feedback 0.25',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0:enable=gte(t\\,0.128)", [[0, 16000, 0], [2, 0, -8000], [510, 16000, 0], [512, 16000, 0], [514, 0, -8000], [1022, 16000, 0], [1030, 0, -4000], [1032, 0, -4000], [1034, 2000, 0]]],
    ["stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0], [1030, 0, -8000], [1032, 0, -8000], [1034, 4000, 0]]],
    ["stereowiden@x=delay=1:feedback=0:crossfeed=0:drymix=0", []],
    ["asendcmd=c='0.064 stereowiden@x feedback 0',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0]]],
    ["asendcmd=c='0.064 stereowiden@y feedback 0',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0], [1030, 0, -8000], [1032, 0, -8000], [1034, 4000, 0]]],
    ["asendcmd=c='0.064 stereowiden feedback 0',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0]]],
    ["asendcmd=c='0.064 stereowiden@x feedback 0',stereowiden@y=feedback=0:crossfeed=0:drymix=1,stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0]]],
    ["asendcmd=c='0.064 stereowiden feedback 0',stereowiden@y=feedback=0:crossfeed=0:drymix=1,stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0], [1030, 0, -8000], [1032, 0, -8000], [1034, 4000, 0]]],
    ["asendcmd=c='0.065 stereowiden@x feedback 0',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0]]],
    ["asetnsamples=200:p=0,asendcmd=c='0.064 stereowiden@x feedback 0',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0]]],
    ["asetpts=PTS+8000,asendcmd=commands='1.064 [enter] stereowiden@x feedback 0;1.128 stereowiden@x feedback 1/2',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [1030, 0, -8000], [1032, 0, -8000], [1034, 4000, 0]]],
    ["asendcmd=c='0 stereowiden@x feedback 0;0.064 stereowiden@x feedback 0.5',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[518, 0, -8000], [520, 0, -8000], [522, 4000, 0], [1030, 0, -8000], [1032, 0, -8000], [1034, 4000, 0]]],
    ["asendcmd=c='0.064 stereowiden@x feedback 1;0.064 stereowiden@x feedback invalid;0.128 stereowiden@x feedback 0.25',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0", [[8, 0, -8000], [10, 4000, 0], [518, 0, -8000], [520, 0, -8000], [522, 4000, 0], [1030, 0, -4000], [1032, 0, -4000], [1034, 2000, 0]]],
    ["asendcmd=c='0.064 stereowiden@x feedback 0.25;0.128 volume@v volume 0.5',stereowiden@x=delay=1:feedback=0.5:crossfeed=0:drymix=0,volume@v=1", [[8, 0, -8000], [10, 4000, 0], [518, 0, -4000], [520, 0, -4000], [522, 2000, 0], [1030, 0, -2000], [1032, 0, -2000], [1034, 1000, 0]]]
  ] as const) {
    it(`applies stereowiden feedback commands for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/in.wav": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(1536 * 4);
      for (const [frame, left, right] of impulses) {
        expected.writeInt16LE(left, frame * 4);
        expected.writeInt16LE(right, frame * 4 + 2);
      }
      assert.deepEqual(fs.readFileSync("/out.pcm"), expected);
    });
  }
}
