import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reads through EOF unless downstream output reaches the limit.
for (const graph of [false, true]) {
  for (const [tail, length, limit, bytes, end] of [
    ["aselect=0", 12, ["-t", "0.005"], 0, "0.012"],
    ["aselect=not(n)", 12, ["-t", "0.005"], 12, "0.012"],
    ["atempo=2", 12, ["-t", "0.005"], 0, "0.012"],
    ["aselect=0", 12, [], 0, "0.012"],
    ["aselect=1", 12, ["-t", "0.005"], 20, "0.009"],
    ["aselect=lte(n\\,1)", 12, ["-to", "0.005"], 20, "0.012"],
    ["aselect=not(mod(n\\,2))", 12, ["-t", "0.005"], 12, "0.009"],
    ["aselect=eq(st(0\\,ld(0)+1)\\,1)", 12, ["-t", "0.005"], 12, "0.012"],
    ["atempo=2", 128, ["-t", "0.005"], 20, "0.128"],
    ["atempo=0.5", 128, ["-to", "0.005"], 20, "0.081"],
    ["atempo=2", 128, ["-t", "0.005", "-frames:a", "1"], 8, "0.128"]
  ] as const) {
    it(`silencedetect follows downstream demand (${tail}, length=${length}, ${limit.join(" ") || "unbounded"}, graph=${graph})`, async () => {
      const input = Buffer.alloc(length * 4);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=3:p=0,silencedetect=n=0.01:d=2ms,${tail}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...limit, "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), Buffer.alloc(bytes));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_"))
        .map(line => line.slice(line.indexOf("] ") + 2)), [
        "silence_start: 0", `silence_end: ${end} | silence_duration: ${end}`
      ]);
    });
  }
}
