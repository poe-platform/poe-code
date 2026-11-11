import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, valid] of [
    ["", true], ["threads=1", true], ["thread_type=slice", true], ["extra_hw_frames=1", true],
    ["threads=1:thread_type=slice:extra_hw_frames=1", true],
    ["threads=0:thread_type=0:extra_hw_frames=-1", true],
    ["threads=2147483647:extra_hw_frames=2147483647", true],
    ["threads=default:extra_hw_frames=min", true],
    ["threads=1+1:extra_hw_frames=2-1", true],
    ["thread_type=+slice", true], ["thread_type=-slice", true],
    ["thread_type=all-slice", true], ["thread_type=none+slice", true],
    ["thread_type=4294967295", true],
    ["threads=-1", false], ["threads=2147483648", false],
    ["threads=", false], ["threads=bogus", false],
    ["thread_type=", false], ["thread_type=bogus", false],
    ["thread_type=slice+", false], ["thread_type=0.5", false],
    ["thread_type=4294967296", false],
    ["extra_hw_frames=-2", false], ["extra_hw_frames=2147483648", false],
    ["extra_hw_frames=bogus", false], ["unknown=1", false]
  ] as const) {
    it(`astats ${option || "defaults"} (${graph ? "graph" : "simple"}) preserves PCM and statistics or rejects invalid options`, async () => {
      // Native FFmpeg 7.0.2: 2000 silent samples followed by 400 samples at 16384.
      const input = Buffer.from(encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 2400 }, (_, i) => i < 2000 ? 0 : 0.5)] }));
      const volume = Volume.fromJSON({ "/in.wav": input });
      const filter = `astats${option ? `=${option}` : ""}`;
      let stderr = "";
      const stdout: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const pcm = Buffer.concat(stdout);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(pcm.length, 4800);
        assert.equal(createHash("sha256").update(pcm).digest("hex"),
          "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
        const overall = stderr.split("Overall\n")[1]!;
        assert.ok(overall.includes("Abs Peak count: 400.000000\n"), stderr);
        assert.ok(overall.includes("Bit depth: 1/1/2/1\n"), stderr);
        assert.ok(overall.includes("Number of samples: 2400\n"), stderr);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.equal(pcm.length, 0);
        assert.ok(stderr.includes("astats:"), stderr);
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
    });
  }
}
