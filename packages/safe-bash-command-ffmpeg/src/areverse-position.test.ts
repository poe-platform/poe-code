import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reference: three PCM16 packets at byte positions 0, 1024 and 2048.
for (const graph of [false, true]) {
  for (const [filter, hash, timestamps] of [
    ["areverse,asetpts=POS,volume=t*8:eval=frame", "3fad7237ce40c5b009884919f561e7da63e9643e775cd3abfb09ca1c1a4179f9", undefined],
    ["areverse,asetpts=POS,ashowinfo", "db5ca31ccba09abe2f8eb61b8fe97547539777cb893de6ce788d9a9c66fa1837", [[2048, 0.256], [1024, 0.128], [0, 0]]],
    ["asetpts=POS,ashowinfo", undefined, [[0, 0], [1024, 0.128], [2048, 0.256]]],
    ["asetpts=POS,volume=t*8:eval=frame", "ff9c2393be5159d38faa00b95efeaef28ac699a49feb9098c13dceafee96c8c5", undefined],
    ["areverse", "db5ca31ccba09abe2f8eb61b8fe97547539777cb893de6ce788d9a9c66fa1837", undefined],
    ["areverse,areverse,asetpts=POS,ashowinfo", undefined, [[0, 0], [1024, 0.128], [2048, 0.256]]]
  ] as const) {
    it(`retains packet positions through ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(2400);
      for (let i = 0; i < 1200; i++) input.writeInt16LE(101 + (13 * i) % 7000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", timestamps ? "info" : "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.dat"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.dat") as Buffer;
      assert.equal(output.length, input.length);
      if (hash) assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      else assert.deepEqual(output, input);
      if (timestamps) {
        const actual = stderr.split("\n").filter(line => line.includes("[ashowinfo]")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("pts_time:"))!.slice(9))];
        });
        assert.deepEqual(actual, timestamps);
      }
    });
  }
}
