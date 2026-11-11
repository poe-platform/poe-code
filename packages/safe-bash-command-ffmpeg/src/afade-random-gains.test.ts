import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 hashes for 8192 mono samples at 8 kHz.
// Native asendcmd additionally requires escaping commas in command arguments.
for (const [filter, hash] of [
  ["afade=ns=8000:unity=0", "4fe7b59af6de3b665b67788cc2f99892ab827efae3a467342b3bb4e3bc8e5bfe"],
  ["afade=ns=8000:unity=1", "b95c7a5e2ba75c31d864cb8f276123d78a09ee4fbcc905811ab7e6f6773d43bc"],
  ["afade=ns=8000:unity=random(0)", "5bc00a684da499175347655e9249daf55e1c0d1dd63acb459bdc68b22904cfa3"],
  ["afade=ns=8000:unity='randomi(0,0,1)'", "5bc00a684da499175347655e9249daf55e1c0d1dd63acb459bdc68b22904cfa3"],
  ["asendcmd=c='0.25 afade@a unity random(0)',afade@a=ns=8192", "29085733864e349e856604044a197f33b87e16e9f32c8439229ceff71158694a"],
  ["asendcmd=c='0.25 afade@a unity randomi(0,0,1)',afade@a=ns=8192", "29085733864e349e856604044a197f33b87e16e9f32c8439229ceff71158694a"],
  ["afade=ns=8000:silence=random(0)", "2319c15e36a77c4b4930f281f4a2368bd7e900ebdb44b6341d1e6f454d3ab45f"],
  ["afade=ns=8000:silence='randomi(0,0,1)'", "2319c15e36a77c4b4930f281f4a2368bd7e900ebdb44b6341d1e6f454d3ab45f"],
  ["asendcmd=c='0.25 afade@a silence random(0)',afade@a=ns=8192", "1384f3a7f7f0a9e3f11fc22ee02d8035c60c69a8609a0b6f60c04b244c3972c2"]
] as const) {
  for (const graph of [false, true]) {
    it(`afade random gain matches native (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const input = Buffer.alloc(8192 * 2);
      for (let i = 0; i < 8192; i++) input.writeInt16LE(12001 + i % 100, i * 2);
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const fs = Volume.fromJSON({ "/in.pcm": input });
        let stderr = "";
        const result = await command.execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
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
        assert.equal(stderr, "");
        const output = fs.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, 16384);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }
}
