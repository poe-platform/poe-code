import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/alimiter-commands.wav", import.meta.url));
async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  // Complete PCM16 references from native FFmpeg 7.0.2 using the same WAV.
  for (const [filter, hash] of [
    ["alimiter@cap=limit=1:level=0", "47db0a0fb828947aef9d83196c24e36ecc85eba5f23c2c08d865399165d6f968"],
    ["alimiter@cap=limit=0.25:level=0", "4632ba179d9453d760b2593069b396cc362cb0879e073979ef6bd3e0d6fc9dce"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0", "f65fac31452881ae71d5d7e26fa1542bf22e94a41387efb360e8190addf8b8f8"],
    ["asendcmd=c='0.065 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0", "79ef85431422e30f75d6cd7a03bf01333bbe04a9a04c79e921658e1809e8139c"],
    ["asetnsamples=200:p=0,asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0", "ba153e267f667d6f392d8ae16c0fa422bb7a971c461ea0edd51d82176b58d2a9"],
    ["asetpts=PTS+8000,asendcmd=commands='1.064 [enter] alimiter@cap limit 1/4;1.128 alimiter@cap limit 0.5',alimiter@cap=limit=1:level=0", "5b0a62fab0dafcbee086a240818b8112e815c5b1b16c00365a666c036242f192"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1", "23578991052fcbaba5d98edbb356d5a0996bf66bc5545404bcac9ed7a27f7024"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0:latency=1", "c25df135114816fcb4b965a484ce79dc05e16cd2f3d40d8ea7191458a07a5fc3"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0:enable=gte(t\\,0.128)", "86db2683a588640d173a64e2c844eded1855c2079be3633b906994ec6cafeb0a"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@other=limit=1:level=0", "47db0a0fb828947aef9d83196c24e36ecc85eba5f23c2c08d865399165d6f968"],
    ["asendcmd=c='0.064 alimiter limit 0.25',alimiter@cap=limit=1:level=0,alimiter@other=limit=1:level=0", "f0875430be0eba443f2d595fa7d5687bd7d7cd6cd5366a9afcaf0a38c1e6965a"],
    ["asendcmd=c='0.064 alimiter@cap limit 0.25;0.128 volume@v volume 0.5',alimiter@cap=limit=1:level=0,volume@v=1", "d074d7459016a0aff0459e2656f5808be163c26047eaea86bca8130ddbf0885a"],
    ["asendcmd=c='0.064 alimiter@cap limit 0;0.128 alimiter@cap limit invalid;0.192 alimiter@cap limit 0.5',alimiter@cap=limit=1:level=0", "2fded4a398dc96261c1458c0c5f4ecc391320c9c7829b5f5fe638c8629819f16"],
    ["asendcmd=c='0.192 alimiter@cap limit 0.5;0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0", "996c96b6747c6299832389e6c80c2eaa2b3f1dcb4f0ffb939e02499dedff1e71"]
  ] as const) {
    it(`preserves native limiter state for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 2048 * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "asendcmd=c='0.064 alimiter@cap limit 0.25',alimiter@cap=limit=1:level=0") {
        const control = await run("alimiter@cap=limit=1:level=0", graph);
        assert.equal(control.result.exitCode, 0, control.stderr);
        assert.deepEqual(output.subarray(0, 512 * 2), control.output.subarray(0, 512 * 2));
        assert.deepEqual([512, 1000].map(i => output.readInt16LE(i * 2)), [8192, 93]);
        assert.deepEqual([512, 1000].map(i => control.output.readInt16LE(i * 2)), [18000, 330]);
      }
    });
  }
}
