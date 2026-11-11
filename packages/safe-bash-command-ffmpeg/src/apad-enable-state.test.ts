import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight mono PCM16 samples at 8 kHz, capped at 8 ms.
for (const [filter, padding] of [
  ...([
    ["1", 3],
    ["st(0,1);ld(0)", 3],
    ["gte(random(0),0)", 3],
    ["gte(randomi(0,1,2),1)", 3],
    // Disabled apad preserves input; native 7.0.2 aborts after emitting it.
    ["st(0,0);ld(0)", 0],
    ["lt(random(0),0)", 0],
    ["lt(randomi(0,1,2),1)", 0],
    ["st(0)", null],
    ["ld(0,1)", null],
    ["random(0,1)", null],
    ["randomi(0,1)", null]
  ] as const).map(([expression, padding]) => [`apad=pad_len=3:enable='${expression}'`, padding] as const),
  ["apad=pad_len=3:enable='st(0,ld(0)+1);eq(ld(0),1)'", 3],
  ["asetnsamples=n=3:p=0,apad=pad_len=3:enable='st(0,ld(0)+1);eq(ld(0),3)'", 3],
  ["asetnsamples=n=3:p=0,apad=pad_len=3:enable='between(random(0),0.07167,0.07168)'", 3],
  ["asetnsamples=n=3:p=0,apad=pad_len=3:enable='between(randomi(0,1,2),1.07167,1.07168)'", 3],
  ["asetnsamples=n=3:p=0,apad=pad_len=3:enable='st(0,0);between(random(0),0.22973,0.22974)'", 3],
  ["apad=pad_len=0:enable='st(0,1)',apad=pad_len=3:enable='eq(ld(0),0)'", 3],
  ["apad=pad_len=0:enable='gte(random(0),0)',apad=pad_len=3:enable='between(random(0),0.22973,0.22974)'", 3]
] as const) {
  for (const graph of [false, true]) {
    it(`apad stateful ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("6400c8002c019001f4015802bc022003", "hex");
      const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", "0.008", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (padding === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("apad enable: invalid or unsupported expression"), stderr);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(volume.readFileSync("/out.pcm"), Buffer.concat([input, Buffer.alloc(padding * 2)]));
      }
    });
  }
}
