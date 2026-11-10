import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for six interleaved stereo float64 frames.
const input = "70be0d000088e33f810c92ffff6fc7bf5862ebffff69f8bfe07c1b00009af03f185c2200004cfd3f503b29000046fe3f78e5cfffff3fffbf4006c9ff3f4cfdbf7b8fdd030000b03fbfe012010038d53f31d168ff7f1ce8bfa076520000e8f63f";
for (const [filter, expected] of [
  ["pan=mono|c0=0.2*c0+0.7*c1", "004001f5ffff78bf60755d0000f4da3ff0bb2300000dfb3f44b29ccc2cc2fabf642f4a68664ecf3f0a492b9a193feb3f"],
  ["pan=mono|c0<0.2*c0+0.7*c1", "809c8f651cc77bbf6a8212abaaf2dd3f282644c7710efe3f6a1bae384ebbfdbfc73629c87164d13fd1fb68721c46ee3f"],
  ["anull", input]
]) {
  for (const complex of [false, true]) {
    it(`preserves float64 pan precision (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "f64le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "f64le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
