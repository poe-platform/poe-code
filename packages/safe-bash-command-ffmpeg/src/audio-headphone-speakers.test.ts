import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8000 Hz signed 16-bit PCM and one stereo HRIR per speaker.
for (const [layout, map, bytes, hash] of [
  ["quad", "FL|FR|BL|BR", 240, "cd82e23e582a35978a4defcbf63d49e925b3bc3fc87720c06dc1b397195f946b"],
  ["quad", "BR|BL|FR|FL", 240, "bdaf8219e579d3a17b74e10b8d7ef0e1a889ace719a15a00e4d3c31a493e9904"],
  ["2.1", "FL|FR|LFE", 320, "71eb397a2736fa788f4309cb4fefaf8e33c438065720827e7e6538a5d5406c2e"],
  ["stereo", "FL|FR", 480, "c8cab7e248ff92cc2e2421658a896f91e6cc2564ebb4c5422f5a644a0e5dddc2"],
  ["mono", "FC", 960, "9d6f22defbbd836b8884b1a082cc232d8c66cb8e74913e0794de77a7ce93858b"]
] as const) {
  it(`headphone routes ${layout} speakers with map=${map} like native`, async () => {
    const volume = Volume.fromJSON({});
    const inputs = Array.from({ length: map.split("|").length + 1 }, (_, j) => {
      const raw = Buffer.alloc((j === 0 ? 240 : 16) * 2);
      for (let i = 0; i < raw.length / 2; i++) {
        raw.writeInt16LE(j === 0 ? i * 437 % 8001 - 4000 : i === j ? 8192 : i === j + 1 ? 4096 : 0, i * 2);
      }
      volume.writeFileSync(`/${j}.raw`, raw);
      return ["-f", "s16le", "-ar", "8000", "-ch_layout", j === 0 ? layout : "stereo", "-i", `/${j}.raw`];
    });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...inputs.flat(), "-filter_complex",
        `${inputs.map((_, index) => `[${index}:a]`).join("")}headphone=map=${map}:type=time[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { output.push(data); } },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, bytes);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
