import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from FFmpeg 7.0.2 for twelve samples of 1000 at 8 kHz.
for (const [filter, expected] of [
  ["aemphasis=enable='random(0)'", [577, 1122, 1000, 1000, 1000, 1000, 1028, 1055, 1048, 1045, 1000, 1000]],
  ["aemphasis=enable='randomi(0,0,1)'", [577, 1122, 1000, 1000, 1000, 1000, 1028, 1055, 1048, 1045, 1000, 1000]],
  ["asendcmd=c='0.0005 aemphasis@x enable random(0)',aemphasis@x", [577, 1122, 1028, 1055, 1048, 1045, 1000, 1000, 1000, 1000, 1054, 1041]],
  ["asendcmd=c='0.0005 aemphasis@x enable randomi(0,0,1)',aemphasis@x", [577, 1122, 1028, 1055, 1048, 1045, 1000, 1000, 1000, 1000, 1054, 1041]],
  // Command replacement and rejection outputs also verified against FFmpeg 9.0.1.
  ["asendcmd=c='0.0005 aemphasis@x enable random(0)',aemphasis@x=enable='random(0)'", [577, 1122, 1000, 1000, 1028, 1055, 1000, 1000, 1000, 1000, 1048, 1045]],
  ["asendcmd=c='0.0005 aemphasis@x enable invalid',aemphasis@x=enable='random(0)'", [577, 1122, 1000, 1000, 1000, 1000, 1028, 1055, 1048, 1045, 1000, 1000]],
  ["aemphasis=enable=0", Array(12).fill(1000)],
  ["aemphasis=enable=1", [577, 1122, 1028, 1055, 1048, 1045, 1054, 1041, 1055, 1042, 1054, 1044]]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves native random timeline: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from("e803".repeat(12), "hex") });
      const chunks: Buffer[] = [];
      let stderr = "";
      const chain = `asetnsamples=n=2:p=0,${filter}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
