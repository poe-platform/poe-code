import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const duration of [undefined, 0.001, 0.002]) {
  for (const mode of ["pcm", "trim", "framecrc", "copy"] as const) {
    it(`concat outpoint retains packet payload and positions the next packet: ${mode}, duration ${duration}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\noutpoint 0.001\n${duration === undefined ? "" : `duration ${duration}\n`}file b.wav\n`
      });
      for (const [name, base] of [["a", 100], ["b", 200]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 16 }, (_, i) => (base + i) / 32768)] }));
      }
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-bitexact",
          ...(mode === "trim" ? ["-af", "atrim=start_pts=16:end_pts=32"] : []),
          ...(mode === "copy" ? ["-c", "copy"] : []),
          "-f", mode === "framecrc" || mode === "copy" ? "framecrc" : "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      const nextPts = duration === 0.002 ? 16 : 8;
      if (mode === "framecrc" || mode === "copy") {
        const rows = output.toString().trim().split("\n").filter(line => !line.startsWith("#"));
        assert.deepEqual(rows.map(line => line.split(",").map(field => field.trim())), [
          ["0", "0", "0", "16", "32", "0x6f9006b8"],
          ["0", String(nextPts), String(nextPts), "16", "32", "0xd9d00cf8"]
        ]);
      } else {
        const samples = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
        assert.deepEqual(samples, mode === "trim"
          ? Array.from({ length: nextPts }, (_, i) => 216 - nextPts + i)
          : [...Array.from({ length: 16 }, (_, i) => 100 + i), ...Array.from({ length: 16 }, (_, i) => 200 + i)]);
      }
    });
  }
}
