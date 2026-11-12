import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, signed 16-bit raw inputs at 8000 Hz.
for (const [layout, map, exitCode, length, hash] of [
  ["stereo", "FL", 234, 0, ""],
  ["stereo", "FR", 234, 0, ""],
  ["stereo", "FL|FR", 0, 480, "c8cab7e248ff92cc2e2421658a896f91e6cc2564ebb4c5422f5a644a0e5dddc2"],
  ["mono", "FC", 0, 960, "9d6f22defbbd836b8884b1a082cc232d8c66cb8e74913e0794de77a7ce93858b"]
] as const) {
  it(`headphone matches native response configuration for ${layout} map=${map}`, async () => {
    const volume = Volume.fromJSON({});
    const inputs = ["a", ...map.split("|").map((_, index) => ["b", "c"][index]!)];
    for (const [index, name] of inputs.entries()) {
      const pcm = Buffer.alloc((index === 0 ? 240 : 16) * 2);
      for (let sample = 0; sample < pcm.length / 2; sample++) {
        pcm.writeInt16LE(index === 0 ? sample * 437 % 8001 - 4000
          : sample === index ? 8192 : sample === index + 1 ? 4096 : 0, sample * 2);
      }
      volume.writeFileSync(`/${name}.raw`, pcm);
    }
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...inputs.flatMap((name, index) => [
        "-f", "s16le", "-ar", "8000", "-ch_layout", index === 0 ? layout : "stereo", "-i", `/${name}.raw`
      ]), "-filter_complex", `${inputs.map((_, index) => `[${index}:a]`).join("")}headphone=map=${map}:type=time[o]`,
      "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    const stdout = Buffer.concat(chunks);
    assert.equal(stdout.length, length);
    if (exitCode === 0) {
      assert.equal(stderr, "");
      assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
    } else {
      assert.ok(stderr.includes("Number of HRIRs must be >= 2"), stderr);
    }
  });
}
