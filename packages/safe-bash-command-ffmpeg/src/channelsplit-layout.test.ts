import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const left = Array.from({ length: 8 }, (_, i) => 100 + i * 10);
const right = left.map(sample => -sample - 100);

for (const layout of ["stereo", "0x3", "FL+FR", "2c"]) {
  for (const channels of ["FR", "0x2", "stereo", "0x3", "LFE"]) {
    it(`channelsplit accepts equivalent layouts: ${layout}:${channels}`, async () => {
      const volume = Volume.fromJSON({ "/first.raw": "keep", "/second.raw": "keep" });
      volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      const multiple = channels === "stereo" || channels === "0x3";
      const filter = `channelsplit=${layout}:${channels}`;
      const args = multiple
        ? ["-filter_complex", `[0:a]${filter}[A][B]`, "-map", "[A]", "-c:a", "pcm_s16le", "-f", "s16le", "/first.raw", "-map", "[B]"]
        : ["-af", filter];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/a.wav", ...args, "-c:a", "pcm_s16le", "-f", "s16le", multiple ? "/second.raw" : "/first.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (channels === "LFE") {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/first.raw", "utf8"), "keep");
        assert.equal(volume.readFileSync("/second.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      for (const [path, expected] of multiple ? [["/first.raw", left], ["/second.raw", right]] as const : [["/first.raw", right]] as const) {
        const bytes = volume.readFileSync(path) as Buffer;
        assert.equal(bytes.length, expected.length * 2);
        assert.deepEqual(expected.map((_, i) => bytes.readInt16LE(i * 2)), expected);
      }
    });
  }
}
