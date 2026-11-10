import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [type, hash] of [
  ["cubic", "9386a7daf312d30a"],
  ["0", "9386a7daf312d30a"],
  ["blackman_nuttall", "acab4f434071484c"],
  ["kaiser", "231db293e4f8c0c6"],
  ["invalid", undefined],
  ["", undefined],
  ["kaiser=extra", undefined]
] as const) {
  for (const route of ["output", "simple", "graph"]) {
    it(`aresample selects ${type || "empty"} window (${route})`, async () => {
      const samples = new Float64Array(512);
      samples[128] = 24000 / 32768;
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const filter = `aresample=4000:filter_type=${type}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(route === "output" ? ["-ar", "4000", "-filter_type", type] : route === "graph"
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (hash === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("filter_type must be"), stderr);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, 512);
      assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), hash);
    });
  }
}
