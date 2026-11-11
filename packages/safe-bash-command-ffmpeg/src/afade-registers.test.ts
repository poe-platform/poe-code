import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 output for eight mono samples of 16000 at 8 kHz.
// Native asendcmd additionally requires escaping commas in command arguments.
for (const [filter, hex] of [
  ["afade=ns=4:unity=st(0\\,0.5)", "0000d007a00f7017401f401f401f401f"],
  ["afade=ns=4:unity='st(0,0.25)+ld(0)'", "0000d007a00f7017401f401f401f401f"],
  ["afade=ns=4:silence=st(0\\,0.5):unity=ld(0)", "401f7017a00fd0070000000000000000"],
  ["afade=ns=4:enable=ld(0)", "803e803e803e803e803e803e803e803e"],
  ["asetnsamples=n=2:p=0,afade=ns=4:enable='lte(st(0,ld(0)+1),2)'", "0000a00f803e803e803e803e803e803e"],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.00025 afade enable lte(st(0,ld(0)+1),2)',afade=ns=4:enable='lte(st(0,ld(0)+1),2)'", "0000a00f401fe02e803e803e803e803e"],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.00025 afade enable st(0,99)+invalid',afade=ns=4:enable='lte(st(0,ld(0)+1),4)'", "0000a00f401fe02e803e803e803e803e"],
  ["asetnsamples=n=2:p=0,asendcmd=c='0.00025 afade unity st(0,0.5)',afade=ns=4:enable='lte(st(0,ld(0)+1),4)'", "0000a00fa00f7017803e803e803e803e"]
] as const) {
  for (const graph of [false, true]) {
    it(`afade registers match native PCM (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const fs = Volume.fromJSON({ "/in.raw": Buffer.from("803e".repeat(8), "hex") });
        let stderr = "";
        const result = await command.execute({
          args: ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
        assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), hex);
      }
    });
  }
}
