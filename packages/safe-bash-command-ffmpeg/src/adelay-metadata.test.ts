import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM and metadata match native FFmpeg 7.0.2, including unconditional common silence.
for (const graph of [false, true]) {
  for (const filter of ["adelay=2S|3S", "adelay=2S|3S:enable=0", "adelay=0S|3S", "anull"]) {
    it(`preserves source frame tags through ${filter} (graph ${graph})`, async () => {
      const input = Buffer.alloc(40);
      for (let i = 0; i < 10; i++) {
        input.writeInt16LE(1000 * (i + 1), i * 4);
        input.writeInt16LE(-500 * (i + 1), i * 4 + 2);
      }
      const fs = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,ametadata=mode=add:key=k:value=v,${filter},ametadata=mode=print:file=/tags`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.raw"],
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
      const common = filter.startsWith("adelay=2") ? 2 : 0;
      const bypass = filter.endsWith("enable=0");
      const delays = filter === "anull" ? [0, 0] : bypass ? [2, 2] : [common, 3];
      const expected = Buffer.alloc((filter === "anull" ? 10 : 13) * 4);
      for (let i = 0; i < 10; i++) {
        expected.writeInt16LE(1000 * (i + 1), (i + delays[0]!) * 4);
        expected.writeInt16LE(-500 * (i + 1), (i + delays[1]!) * 4 + 2);
      }
      assert.deepEqual(fs.readFileSync("/out.raw"), expected);
      const report = [0, 3, 6, 9].map((start, n) => {
        const pts = start + (bypass ? 0 : common);
        return `frame:${String(n + (common ? 1 : 0)).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${pts / 1000}\nk=v\n`;
      }).join("");
      assert.equal(fs.readFileSync("/tags", "utf8"), report);
    });
  }
}
