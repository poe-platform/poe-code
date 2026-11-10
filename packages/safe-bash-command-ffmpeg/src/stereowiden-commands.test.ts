import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

// Native FFmpeg 7.0.2 PCM16 hashes for the same 72-frame stereo input.
for (const graph of [false, true]) {
  const cases = [
    ["asendcmd=c='0 stereowiden@w drymix 0',stereowiden@w=delay=1", "a8cb60f09a20e19c403f7b610cc58e8e565932c54c79af2b42af0b1d14e20b30"],
    ["asendcmd=c='0.003 stereowiden@w drymix 0',stereowiden@w=delay=1", "ccabb74a713103e4be3d1b0b0b704a464c5c34edc9f28c1b08b7ffd5778ddcb6"],
    ["asendcmd=c='0 stereowiden@w crossfeed 0',stereowiden@w=delay=1", "a52e1317f89bec38cf638716b52c13ed24fb57dc7214dfc86a9d39367605f841"],
    ["asendcmd=c='0.003 stereowiden@w crossfeed 0',stereowiden@w=delay=1", "d8b7b3d7b69ba9a511f1b47cab913e0423511edd71c4239c437e66b5a58f1999"],
    ["stereowiden=delay=1:drymix=0", "a8cb60f09a20e19c403f7b610cc58e8e565932c54c79af2b42af0b1d14e20b30"],
    ["stereowiden=delay=1:crossfeed=0", "a52e1317f89bec38cf638716b52c13ed24fb57dc7214dfc86a9d39367605f841"],
    ["asendcmd=c='0.003 stereowiden@w feedback 0',stereowiden@w=delay=1", "198282803241413793a70ba562a2924d58ed7c16865ed78a51cd7f8c3c1ea188"]
  ];
  for (const [action, hash, invalid] of [
    ["drymix", "a8cb60f09a20e19c403f7b610cc58e8e565932c54c79af2b42af0b1d14e20b30", "1.1"],
    ["crossfeed", "a52e1317f89bec38cf638716b52c13ed24fb57dc7214dfc86a9d39367605f841", "0.9"]
  ] as const) {
    cases.push(
      [`asendcmd=c='0 stereowiden ${action} 0',stereowiden@w=delay=1`, hash],
      [`asendcmd=c='0 stereowiden@w ${action} 0',stereowiden@other=feedback=0:crossfeed=0:drymix=1,stereowiden@w=delay=1`, hash],
      [`asendcmd=c='0 stereowiden@missing ${action} 1',stereowiden@w=delay=1:${action}=0`, hash],
      [`asendcmd=c='0 stereowiden@w ${action} 0;0.001 stereowiden@w ${action} -1;0.002 stereowiden@w ${action} ${invalid};0.003 stereowiden@w ${action} invalid',stereowiden@w=delay=1`, hash]
    );
  }
  for (const [filter, hash] of cases) {
    it(`matches native stereowiden gains for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const pcm = Buffer.alloc(72 * 4);
      for (let i = 0; i < 72; i++) {
        pcm.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
        pcm.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": pcm, "/out": "KEEP" });
      let stderr = "";
      const chain = `asetnsamples=n=8:p=0,${filter}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"]
          : ["-af", chain]), "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out");
      assert.equal(output.length, 288);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
