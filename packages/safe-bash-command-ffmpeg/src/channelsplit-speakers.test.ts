import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const surround = Buffer.from("UklGRoQAAABXQVZFZm10IBAAAAABAAYAQB8AAAB3AQAMABAAZGF0YWAAAADQB8z3mAgE92AJPPbaB8L3ogj69moJMvbkB7j3rAjw9nQJKPbuB673tgjm9n4JHvb4B6T3wAjc9ogJFPYCCJr3ygjS9pIJCvYMCJD31AjI9pwJAPYWCIb33gi+9qYJ9vU=", "base64");
const mono = Buffer.from("UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAC4C8ILzAvWC+AL6gv0C/4L", "base64");

for (const [layout, speaker, first] of [
  ["mono", "FC", 3000], ["5.1", "FC", 2200], ["5.1", "LFE", -2300],
  ["5.1", "BR", -2500], ["mono", "FR", 0], ["5.1", "SL", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`extracts ${layout}:${speaker} samples through ${graph ? "graph" : "simple filter"}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      volume.writeFileSync("/in.wav", layout === "mono" ? mono : surround);
      const filter = `channelsplit=${layout}:${speaker}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (first === 0) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const bytes = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(bytes.length, 16);
      assert.deepEqual(Array.from({ length: 8 }, (_, i) => bytes.readInt16LE(i * 2)),
        Array.from({ length: 8 }, (_, i) => first + Math.sign(first) * i * 10));
    });
  }
}
